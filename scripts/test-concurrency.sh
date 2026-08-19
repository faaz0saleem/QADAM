#!/usr/bin/env bash
# Concurrency checks that a single-session test framework cannot express.
#
# pgTAP runs everything in one transaction, which is exactly the wrong shape for
# testing what two phones syncing at the same moment do to one wallet. These
# checks open real concurrent sessions instead.
#
#   ./scripts/test-concurrency.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
TESTDB="${QADAM_CONCURRENCY_DB:-qadam_concurrency}"

./scripts/db.sh start >/dev/null
ADMIN="$(./scripts/db.sh url postgres)"
URL="$(./scripts/db.sh url "$TESTDB")"

q() { PGOPTIONS='-c client_min_messages=warning' \
      psql -X -q --no-psqlrc -v ON_ERROR_STOP=1 --pset pager=off -t -A "$@"; }

echo "── building a scratch database ──────────────────────────"
q "$ADMIN" -c "drop database if exists $TESTDB with (force);" >/dev/null
q "$ADMIN" -c "create database $TESTDB;" >/dev/null
q "$URL" -f supabase/tests/_bootstrap.sql >/dev/null
for m in supabase/migrations/*.sql; do q "$URL" -f "$m" >/dev/null; done
q "$URL" -f supabase/tests/_fixtures.sql >/dev/null

fails=0
check() { # check <description> <expected> <actual>
  if [ "$2" = "$3" ]; then
    printf '   ok    %s\n' "$1"
  else
    printf '   FAIL  %s (expected %s, got %s)\n' "$1" "$2" "$3"
    fails=$((fails + 1))
  fi
}

echo "── two phones syncing the same day at the same moment ───"
USER_ID="$(q "$URL" -c "select tests.new_user(p_created_at => now() - interval '90 days');")"
DAY="$(q "$URL" -c "select public.pkt_date(now()) - 1;")"

# Both sessions submit the same 10,000 steps for the same day, at the same time.
# A wallet that ends on 200 coins instead of 100 is a wallet that can be farmed
# by installing the app on two phones.
SUBMIT="select public.submit_steps('$USER_ID',
          jsonb_build_array(jsonb_build_object('date', '$DAY', 'raw_steps', 10000)),
          'health_connect', 'device-1', true, '{}'::jsonb);"

q "$URL" -c "$SUBMIT" >/dev/null &
PID1=$!
q "$URL" -c "$SUBMIT" >/dev/null &
PID2=$!
wait $PID1 $PID2

BALANCE="$(q "$URL" -c "select public.coin_balance('$USER_ID');")"
check "concurrent identical syncs mint 100 coins, not 200" "100" "$BALANCE"

ROWS="$(q "$URL" -c "select count(*) from public.daily_steps where user_id = '$USER_ID';")"
check "and leave exactly one step row for the day" "1" "$ROWS"

AWARDED="$(q "$URL" -c "select coins_awarded from public.daily_steps where user_id = '$USER_ID';")"
check "with coins_awarded agreeing with the ledger" "100" "$AWARDED"

echo "── two checkouts spending the same coins ────────────────"
SPENDER="$(q "$URL" -c "select tests.new_user(p_created_at => now() - interval '90 days');")"
q "$URL" -c "select private.mint_coins('$SPENDER', 100, 'adjustment_credit');" >/dev/null

# 60 + 60 against a balance of 100. Exactly one must fail.
SPEND="select private.spend_coins('$SPENDER', 60, 'adjustment_debit');"
q "$URL" -c "$SPEND" >/dev/null 2>&1 && echo ok > /tmp/qadam-spend-a || echo no > /tmp/qadam-spend-a &
PID1=$!
q "$URL" -c "$SPEND" >/dev/null 2>&1 && echo ok > /tmp/qadam-spend-b || echo no > /tmp/qadam-spend-b &
PID2=$!
wait $PID1 $PID2

SPENT_BALANCE="$(q "$URL" -c "select public.coin_balance('$SPENDER');")"
check "a batch cannot be overdrawn by two concurrent spends" "40" "$SPENT_BALANCE"

# grep exits 1 when it matches nothing, which under `set -e` would end the
# script on the very outcome being measured.
SUCCEEDED=0
grep -qx ok /tmp/qadam-spend-a && SUCCEEDED=$((SUCCEEDED + 1)) || true
grep -qx ok /tmp/qadam-spend-b && SUCCEEDED=$((SUCCEEDED + 1)) || true
check "exactly one of the two spends succeeded" "1" "$SUCCEEDED"

NEGATIVE="$(q "$URL" -c "select count(*) from (select public.coin_balance(id) as b from public.users) x where b < 0;")"
check "no user anywhere ends with a negative balance" "0" "$NEGATIVE"

echo "── five checkouts against one wallet ────────────────────"
# Two sessions can serialise by luck. Five spends of 30 against a balance of 100
# must let exactly three through, and the survivor of a race that lets four
# through is a wallet with minus twenty coins in it.
CROWD="$(q "$URL" -c "select tests.new_user(p_created_at => now() - interval '90 days');")"
q "$URL" -c "select private.mint_coins('$CROWD', 100, 'adjustment_credit');" >/dev/null

rm -f /tmp/qadam-crowd-*
for i in 1 2 3 4 5; do
  ( q "$URL" -c "select private.spend_coins('$CROWD', 30, 'adjustment_debit');" >/dev/null 2>&1 \
      && echo ok > "/tmp/qadam-crowd-$i" || echo no > "/tmp/qadam-crowd-$i" ) &
done
wait

CROWD_OK=0
for i in 1 2 3 4 5; do
  grep -qx ok "/tmp/qadam-crowd-$i" && CROWD_OK=$((CROWD_OK + 1)) || true
done
check "exactly three of five concurrent spends succeeded" "3" "$CROWD_OK"
check "leaving 10 coins, not a negative balance" "10" "$(q "$URL" -c "select public.coin_balance('$CROWD');")"
rm -f /tmp/qadam-crowd-*

echo "── two callbacks for the same rewarded video ────────────"
WATCHER="$(q "$URL" -c "select tests.new_user(p_created_at => now() - interval '90 days');")"
CREDIT="select private.credit_rewarded_ad('$WATCHER', 'ssv-replay-1');"
q "$URL" -c "$CREDIT" >/dev/null 2>&1 &
PID1=$!
q "$URL" -c "$CREDIT" >/dev/null 2>&1 &
PID2=$!
wait $PID1 $PID2

AD_BALANCE="$(q "$URL" -c "select public.coin_balance('$WATCHER');")"
check "a replayed AdMob callback pays once, not twice" "30" "$AD_BALANCE"

rm -f /tmp/qadam-spend-a /tmp/qadam-spend-b
q "$ADMIN" -c "drop database if exists $TESTDB with (force);" >/dev/null

echo "─────────────────────────────────────────────────────────"
if [ "$fails" -gt 0 ]; then
  echo "   $fails concurrency check(s) FAILED"; exit 1
fi
echo "   all concurrency checks passed"
