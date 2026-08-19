## What changed

<!-- One or two sentences. -->

## Does this touch the money rules?

- [ ] No — nothing in `supabase/migrations/` that affects `order_items`,
      `orders`, `coin_ledger`, `app_config`, or the RLS grants
- [ ] Yes — and `db/test/margin_rule.test.mjs` still passes unchanged

§0 is the rule the business rests on: a coin discount can never exceed 20% of
gross margin or 10% of price, whichever is lower. If this PR relaxes a
constraint, weakens a CHECK, or adds a write path to `coin_ledger`, say so
explicitly here.

## Checks

- [ ] `npm run check` passes locally
- [ ] `HUMAN_TASKS.md` updated if this needs an account, a key or a decision
