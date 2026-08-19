# Qadam — operating rules for every session

**`README.md` is the full project brief. Read it before making design decisions.**
This file is the short version: the things that must never be got wrong, and how this
repo is laid out. When the two disagree, `README.md` wins and this file is the bug.

---

## §0 — the rule that must never break

```
max_discount_pkr = MIN( 0.20 * (price - cost),  0.10 * price )
```

A coin discount can never exceed 20% of gross margin on that item, or 10% of the item
price — whichever is lower.

This lives in the **database**, not in application code:

- `public.max_coin_discount_pkr(price_pkr, cost_pkr)` — immutable SQL function
- `order_items.discount_within_margin` — CHECK constraint calling it
- `orders_discount_matches_items` — deferred constraint trigger, so the order header
  cannot claim a discount the lines don't justify

If you are about to write a code path that computes a discount, you are probably
doing it wrong. Ask the database: `select public.max_coin_discount_pkr(price, cost)`.

Proof that it holds is `supabase/tests/01_margin_cap_test.sql`. That test file is the
contract. Do not weaken it. If a change makes it fail, the change is wrong.

## The other hard nevers (README §13)

1. §0 wins over every other consideration, always.
2. **Never accept a coin value, balance, or discount amount from the client.** The
   client sends raw step counts and product ids. Nothing else. If an RPC signature
   grows a `coins` or `discount` parameter, that is a P0 bug.
3. Never add coin transfer, coin gifting, or cash-out. Refuse and cite this line.
4. Never add a mechanic where a user stakes money or can lose something they paid for.
   Contest prizes are funded by us or a sponsor; losers lose nothing they put in.
5. Never put an ad in the shopping flow. Rewarded video only, in the earning half, 3/day.
6. Never cut the coin earning rate after launch. Tune discount pricing instead.
7. When unsure whether something breaks §0, stop and ask the human.

## Invariants the schema enforces for you

- `coin_ledger` is **append-only**. No UPDATE, no DELETE — a trigger raises on both.
  There is **no balance column anywhere**. Balance is always `SUM(delta)` over
  unexpired rows. If you find yourself caching a balance, cache it in a materialised
  view that can be dropped and rebuilt, never in a column users' money depends on.
- `products.cost_pkr` is never granted to `anon` or `authenticated`. Column-level
  grants enumerate the safe columns; adding a column to `products` does **not**
  automatically expose it. Grant it explicitly in a migration, and never grant `cost_pkr`.
- `private.app_config` lives in a schema PostgREST does not expose. The coin-to-rupee
  rate is server-side only and must never reach the client. The UI shows
  "1,000 steps = 10 coins" and per-product coin discounts — never a rate.
- No GPS. No location permission. Steps come from Health Connect / HealthKit only.

## Layout

```
README.md                  the brief — the source of truth
CLAUDE.md                  this file
HUMAN_TASKS.md             what the human must do (README §11) — keep it current
supabase/
  migrations/              numbered, forward-only. Never edit an applied migration.
  tests/                   pgTAP. `_bootstrap.sql` shims Supabase-isms locally.
  functions/               Deno Edge Functions. See functions/README.md.
scripts/
  db.sh                    start/stop/reset a local Postgres 16 test cluster
  test.sh                  reset → migrate → run every pgTAP test file
.github/workflows/ci.yml   pgTAP suite + Deno typecheck, on every push
```

## Two rules about the schema boundary

- **PostgREST only sees `public`.** `private` is absent from `config.toml`, which is
  what keeps `COIN_VALUE_PKR` off every device. So an Edge Function cannot call
  `private.*` over RPC — and the fix is never to expose the schema. Add a thin
  `security definer` wrapper in `public`, granted to `service_role` alone
  (`20260819011100_service_rpc_surface.sql` is the pattern).
- **Postgres grants EXECUTE on every new function to `PUBLIC`.** Revoking from
  `anon` and `authenticated` does nothing on its own — they inherit it. Every new
  function needs `revoke all on function ... from public` or it is world-callable.

## Running the database tests

```sh
./scripts/db.sh start      # local cluster on port 5433, no docker needed
./scripts/test.sh          # applies migrations to a scratch db, runs pgTAP
./scripts/db.sh stop
```

`./scripts/test.sh` is the gate. It must be green before any commit that touches
`supabase/`.

## Conventions

- Money is **integer PKR**. Never a float, never paisa, never a decimal type.
  Coins are integers too. Rounding is always `floor` in the house's favour.
- Timestamps are `timestamptz`. The business day is **Asia/Karachi** — use
  `public.pkt_date(ts)` rather than casting to `date`, or the day rolls over at
  5am local and every streak breaks.
- Every table gets RLS enabled, even ones with no client-facing policy. Default deny.
- Functions that need to bypass RLS are `security definer` with a pinned
  `search_path` and live in `private`.
- Migration filenames: `YYYYMMDDHHMMSS_short_name.sql`, forward-only.

## Build order (README §10) — do not skip ahead

- **Phase 0** foundations: schema, §0 constraint, tests.
- **Phase 1** the earning app with **no store at all** — then ship and stop for four weeks.
- **Phase 2** commerce. **Phase 3** growth. **Phase 4** store submission.

The store tables exist from Phase 0 because §0 must be structural from day one, but no
store UI ships until Phase 1 has been in real users' hands.
