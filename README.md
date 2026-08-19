# Qadam

Walk, mint coins, spend them as a discount. Pakistan, iOS + Android.

The full brief is in [`CLAUDE.md`](./CLAUDE.md). What follows is how to run what
exists.

## The one rule

A coin discount can never exceed **20% of gross margin** on an item, or **10% of
its price** — whichever is lower.

```
max_discount_pkr = MIN(0.20 * (price - cost), 0.10 * price)
```

It is a database constraint, not application logic, so no admin panel, promo
code, checkout path or future bug can write an order that violates it. See
`supabase/migrations/20260818000500_orders.sql` and the tests that prove it in
`db/test/margin_rule.test.mjs`.

A discount funded out of realised margin cannot produce a loss. One funded out of
price can, and will, on anything low-margin — a flat 10% off a phone loses money
on every unit sold.

## Running the tests

The suite rebuilds a throwaway database from `supabase/migrations/` on every run,
so it always tests the SQL that actually ships.

```bash
npm install
npm test
```

It needs a Postgres 15+ you can create databases on. Either works:

```bash
# a local install
sudo service postgresql start
export ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres

# or the Supabase CLI's
supabase start
export ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres
```

```bash
npm run test:keep   # leave the database up afterwards to poke at
npm run db:apply    # build it and stop
```

## Applying to a real Supabase project

```bash
supabase link --project-ref <ref>
supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql   # dev data, optional
psql "$SUPABASE_DB_URL" -f supabase/cron.sql   # the two scheduled jobs
```

The first migration (`..._bootstrap_local_parity.sql`) creates the Supabase
roles, `auth.users` and `auth.uid()` **only if they are absent**. On a hosted
project every statement in it is a no-op; locally it is what lets the same
migration set run under plain Postgres.

## Layout

```
CLAUDE.md               the brief — read this first
HUMAN_TASKS.md          accounts, credentials and decisions I need from you
supabase/migrations/    the schema, in order
supabase/cron.sql       pg_cron schedules (leaderboards, expiry warnings)
supabase/seed.sql       a small dev catalogue
db/test/                the suite, run against a rebuilt database
app/theme/              §9 design tokens, the single source for colour and type
```

## Where the money rules live

| Rule | Enforced by |
|---|---|
| §0 discount ceiling, per item | `order_items.discount_within_margin` CHECK |
| §0 at order level | `assert_order_invariants()` deferred constraint trigger |
| A discount is backed by real coins | `orders.discount_is_coin_backed` CHECK |
| The ledger is append-only | `coin_ledger_append_only()` trigger on UPDATE and DELETE |
| No wallet or batch goes negative | `coin_ledger_no_overdraft()` trigger |
| Coins never transfer or cash out | no such function exists, and a test asserts it |
| Prizes are never cash or user-funded | `challenges` CHECK constraints |
| Steps are priced server-side only | `award_steps()`, and no client grant on it |
| `cost_pkr` never reaches a client | column-level GRANTs in the RLS migration |
| The coin rate never reaches a client | `app_config` has RLS on and no policy |

## Conventions

- **Money is integer PKR.** No floats, no decimals, no minor units. Columns carry
  a `_pkr` suffix so a unitless integer never lands in a money context.
- **Dates are Pakistan dates.** `pkt_date()` and `pkt_week_start()`; the weekly
  board resets Monday 00:00 PKT.
- **The client reports raw step counts and nothing else.** It never computes
  coins, never sends a coin value, never sends a balance.

## Status

Phase 0 and the Phase 1 server are in: schema, the §0 constraint, the coin ledger,
step ingestion with the §6.1 anti-fraud rules, all four leaderboard scopes, teams,
expiry notifications, and the Phase 2 commerce path with the COD lifecycle.

109 tests pass. The app itself is next — see `HUMAN_TASKS.md` for what it needs
before it can run on a phone.
