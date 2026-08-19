# Running Qadam locally

Nothing here needs docker, a Supabase account, or a phone. The database and its
tests run on a local Postgres; the app typechecks and unit-tests without a
simulator. What you cannot do without the accounts in `HUMAN_TASKS.md` is see
the app on a screen.

## One command

```sh
npm run check
```

Rebuilds a scratch database from every migration, runs the pgTAP suite, runs the
concurrency checks in real parallel sessions, typechecks and tests the Edge
Functions under Deno, typechecks and tests the app, and runs the design rules.
This must be green before any commit.

## What you need installed

| For | Install |
|---|---|
| the database and its tests | `postgresql-16`, `postgresql-16-pgtap` |
| the Edge Functions | `deno` (`npm i -g deno` works) |
| the app | `node >= 20` |

On Ubuntu:

```sh
sudo apt-get install -y postgresql-16 postgresql-16-pgtap
npm i -g deno
npm --prefix mobile ci
```

macOS: `brew install postgresql@16 pgtap deno`.

## The database

```sh
./scripts/db.sh start     # a cluster in .pgdata on port 5433, no docker
./scripts/test.sh         # fresh db → every migration → every pgTAP file
./scripts/test.sh margin  # just the files matching "margin"
./scripts/seed.sh         # a week of plausible data to look at
./scripts/db.sh psql qadam_test
./scripts/db.sh stop
```

`scripts/test.sh` builds the database from scratch every run, so a migration that
only works against a database that already exists fails here rather than in
production.

Point any of it at a real project with `DATABASE_URL=postgres://…`.

### Looking at the seeded data

```sh
./scripts/test.sh >/dev/null && ./scripts/seed.sh
./scripts/db.sh psql qadam_test -c "
  select title, price_pkr, public.max_coin_discount_pkr(price_pkr, cost_pkr) as max_discount
    from public.products order by price_pkr;"
```

That last query is §0 in one line: the PKR 94,000 phone caps at PKR 1,000 — about
1% — while a lawn kurta gets 8%, and nothing in the code special-cases either.

## The app

```sh
npm --prefix mobile run typecheck
npm --prefix mobile test
```

Running it on a device needs an Expo dev build, not Expo Go — the health
libraries are native modules. That, and the Supabase keys, are the P1 items in
`HUMAN_TASKS.md`.

```sh
cp .env.example .env.local     # fill in EXPO_PUBLIC_SUPABASE_*
npm --prefix mobile run start
```

## The Edge Functions

```sh
deno test supabase/functions/_shared/
deno check supabase/functions/*/index.ts
deno lint supabase/functions
```

Deploying needs the Supabase CLI and a project: `supabase functions deploy
ingest-steps`. The secrets each one needs are listed in
`supabase/functions/README.md`.

## Adding things

- **A migration.** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, forward-only,
  never edit one that has been applied. New table → `enable row level security`
  in the same migration even with no policy. New function → `revoke all on
  function … from public`, or Postgres leaves it world-callable.
- **A test.** `supabase/tests/NN_name_test.sql`, wrapped in `begin` / `rollback`,
  with an explicit `plan(n)` — the harness fails on a plan mismatch, which is how
  a silently-skipped assertion gets caught.
- **A screen.** Colour comes from `src/theme` only, brass only through
  `src/components/Coin.tsx`, every string in both `en.ts` and `ur.ts`, every
  Pressable labelled. `scripts/check-design.py` enforces all four.

`ARCHITECTURE.md` explains why the boundaries are where they are.
`DEFINITION_OF_DONE.md` says what is actually proven.
