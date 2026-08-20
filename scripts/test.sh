#!/usr/bin/env bash
# Rebuild a scratch database from scratch, apply every migration in order, then run
# every pgTAP file in supabase/tests. This is the gate: it must be green before any
# commit that touches supabase/.
#
#   ./scripts/test.sh                  # all tests
#   ./scripts/test.sh margin           # only test files matching "margin"
#
# Targets $DATABASE_URL when set (CI, a Supabase branch); otherwise the local
# cluster from scripts/db.sh, which it will start for you.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FILTER="${1:-}"
TESTDB="${QADAM_TESTDB:-qadam_test}"

if [ -n "${DATABASE_URL:-}" ]; then
  ADMIN_URL="$DATABASE_URL"
  TEST_URL="$DATABASE_URL"
  MANAGED=0
else
  ./scripts/db.sh start >/dev/null
  ADMIN_URL="$(./scripts/db.sh url postgres)"
  TEST_URL="$(./scripts/db.sh url "$TESTDB")"
  MANAGED=1
fi

psql_q() { psql -X -q --no-psqlrc -v ON_ERROR_STOP=1 --pset pager=off "$@"; }

if [ "$MANAGED" = "1" ]; then
  psql_q "$ADMIN_URL" -c "drop database if exists $TESTDB with (force);" >/dev/null
  psql_q "$ADMIN_URL" -c "create database $TESTDB;" >/dev/null
fi

echo "── bootstrap ────────────────────────────────────────────"
psql_q "$TEST_URL" -f supabase/tests/_bootstrap.sql >/dev/null
echo "   supabase shims + pgtap installed"

echo "── migrations ───────────────────────────────────────────"
shopt -s nullglob
for m in supabase/migrations/*.sql; do
  printf '   %-58s' "$(basename "$m")"
  if psql_q "$TEST_URL" -f "$m" >/tmp/qadam-migrate.log 2>&1; then
    echo "ok"
  else
    echo "FAILED"; sed 's/^/      /' /tmp/qadam-migrate.log; exit 1
  fi
done

if [ -f supabase/tests/_fixtures.sql ]; then
  psql_q "$TEST_URL" -f supabase/tests/_fixtures.sql >/dev/null
  echo "   fixtures loaded"
fi

echo "── tests ────────────────────────────────────────────────"
fail=0; files=0; assertions=0
for t in supabase/tests/[0-9]*.sql; do
  [ -n "$FILTER" ] && [[ "$(basename "$t")" != *"$FILTER"* ]] && continue
  files=$((files+1))
  name="$(basename "$t")"
  # A file that never calls finish() gets its plan checked by nobody: pgTAP only
  # reports "you planned N but ran M" from there. Silently running four more
  # assertions than you planned is how an under-planned file looks green.
  if ! grep -q 'finish()' "$t"; then
    fail=$((fail+1))
    printf '   %-58s FAILED\n' "$name"
    printf '      # no select * from finish(); — the plan in this file is unchecked\n'
    continue
  fi
  out="$(psql -X -q --no-psqlrc -t -A --pset pager=off "$TEST_URL" -f "$t" 2>&1)" || true
  bad="$(printf '%s\n' "$out" | grep -c '^not ok' || true)"
  good="$(printf '%s\n' "$out" | grep -c '^ok ' || true)"
  assertions=$((assertions+good+bad))
  if [ "$bad" -gt 0 ] \
     || printf '%s\n' "$out" | grep -qiE '^(psql:|ERROR:)' \
     || printf '%s\n' "$out" | grep -qi '^# Looks like you planned'; then
    fail=$((fail+1))
    printf '   %-58s FAILED\n' "$name"
    printf '%s\n' "$out" | grep -E '^(not ok|#|psql:|ERROR:|DETAIL:|CONTEXT:)' | sed 's/^/      /'
  else
    printf '   %-58s %s ok\n' "$name" "$good"
  fi
done

echo "─────────────────────────────────────────────────────────"
if [ "$fail" -gt 0 ]; then
  echo "   $fail/$files test files FAILED  ($assertions assertions run)"; exit 1
fi
if [ "$files" = "0" ]; then echo "   no test files matched '$FILTER'"; exit 1; fi
echo "   $files test files passed, $assertions assertions"
