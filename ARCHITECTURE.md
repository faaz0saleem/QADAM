# How Qadam is put together

`README.md` is the brief and the source of truth. This file is for the person who
has read it and now has to change something without breaking it.

---

## The shape of the thing

```
device                    Edge Function              Postgres
──────                    ─────────────              ────────
Health Connect  ──raw──▶  ingest-steps  ──service──▶ submit_steps()
HealthKit         steps   verifies attestation  role   caps, rates, mints
                          burns the nonce
AdMob SSV       ─────▶    admob-ssv     ────────▶ credit_rewarded_ad()
                          verifies Google's
                          signature
pg_cron         ─────▶    expire-coins-notify  ──▶ Expo push
                          streak-notify
```

The device holds the **anon key** and nothing else. It can read its own rows and
call a handful of first-person functions. It cannot reach the coin economy at
all: `submit_steps` and `credit_rewarded_ad` are granted to `service_role` alone,
and only the Edge Functions hold that key.

## Three boundaries, and why each exists

**1. The client never sends a number that becomes money.**
The request body is a date, a raw step count, and a device hash. Coins are
computed server-side from `daily_steps` and `app_config`. If an RPC signature
ever grows a `coins`, `balance` or `discount` parameter, that is a P0 bug — and
`03_step_ingestion_test.sql` fails if one appears.

**2. `private` is not exposed to PostgREST.**
`supabase/config.toml` lists `public` only. That is what keeps `COIN_VALUE_PKR`
off every device regardless of what a future RLS policy says. The consequence
catches everyone once: **an Edge Function cannot call `private.*` over RPC
either.** The fix is never to expose the schema — add a thin `security definer`
wrapper in `public`, granted to `service_role` alone.
`20260819011100_service_rpc_surface.sql` is the pattern.

**3. Postgres grants `EXECUTE` on every new function to `PUBLIC`.**
Revoking from `anon` and `authenticated` does nothing on its own, because they
inherit the `PUBLIC` grant. Every new function needs
`revoke all on function ... from public` or it is world-callable. This was a real
bug here before `04_rls_test.sql` pinned it: any signed-in user could read anyone
else's balance and call `submit_steps` directly, bypassing attestation.

## Where the invariants actually live

| Rule | Enforced by | Proven by |
|---|---|---|
| §0 margin cap | `order_items.discount_within_margin` CHECK | `01_margin_cap_test.sql` |
| Line snapshot is real, and immutable | `order_item_snapshot_guard` trigger | same file |
| Header discount ≤ sum of lines | `orders_validate_discount` trigger | same file |
| Ledger is append-only | `coin_ledger_is_append_only` trigger | `02_coin_ledger_test.sql` |
| No balance column exists | — | `02_coin_ledger_test.sql` asserts it |
| Coins never move between users | `coin_debit_guard` trigger | `02`, `06` |
| Daily cap, rate ceiling, backfill window | `submit_steps` | `03_step_ingestion_test.sql` |
| `cost_pkr` unreachable by a client | column-level GRANT | `04`, `12_privileges_test.sql` |
| Nothing else is reachable either | the full grant inventory | `12_privileges_test.sql` |
| Coin rate unreachable by a client | schema not exposed | `04_rls_test.sql` |
| No ad in the shopping flow | `ad_impressions.placement` CHECK | `06_ads_referrals_test.sql` |
| No user-funded prizes, no cash prizes | `challenges` CHECKs | `06_ads_referrals_test.sql` |
| Brass is for coins only | `scripts/check-design.py` | run in CI |
| No GPS anywhere | `scripts/check-design.py` + `app.json` blockedPermissions | run in CI |

The pattern is deliberate: **a rule that can be broken by forgetting is not
enforced.** Where a rule can be a constraint, it is one. Where it cannot — a
colour, a word, an import — a script fails the build instead.

## Coin expiry, the one piece that is not obvious

§5 says balance is `SUM(delta) WHERE expires_at > now()`. That is right in spirit
and wrong in arithmetic: once a batch lapses, a spend against it keeps
subtracting while the credit stops adding, and the user goes negative.

So every debit names the credit batch it draws from (`consumes_id`), one row per
batch touched, and a row counts toward the balance only while **its batch** is
live. Expiry is then exact and instantaneous, with no cron in the correctness
path. Spending is FIFO by soonest expiry, so the coins a user is closest to
losing are the ones they spend first.

If you add a way to spend coins, it goes through `private.spend_coins`. Do not
write debit rows by hand.

## The app

`mobile/` is Expo Router. Four tabs in Phase 1 — Steps, Board, Wallet, You —
because §10 ships the earning half with no store at all. Shop slots in between
Board and Wallet in Phase 2 and nothing else moves.

- `src/theme/` is the only source of colour. `COIN_BRASS` is not on either
  surface palette; it is reachable through `src/components/Coin.tsx` and the
  named notification-channel exception, and nowhere else.
- `src/i18n/` is typed so a missing translation key will not compile. Numbers stay
  in the monospace face in both languages — a tabular column that changes face
  between locales stops being a column.
- `src/lib/sync.ts` is the entire client contribution to the economy: read
  health, queue to disk, attest, post, drop only what the server acknowledged.

## Running everything

```sh
npm run check        # pgTAP + app typecheck + jest + design rules
./scripts/test.sh    # just the database
```

`./scripts/db.sh` runs a local Postgres 16 on port 5433. No docker.

## Adding a migration

Forward-only, `YYYYMMDDHHMMSS_short_name.sql`, never edit one that has been
applied. New table? `enable row level security` on it in the same migration, even
if it has no client-facing policy — default deny means a forgotten policy fails
closed. New function? Revoke from `public` explicitly.
