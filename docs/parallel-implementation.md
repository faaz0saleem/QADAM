# The second branch, and why it is not merged

`claude/qadam-project-brief-7c9pup` is a **complete, independent implementation
of the same brief**, built in parallel. It is not a feature branch, and merging
it is not a merge.

## The blocking fact

The two branches have **no common ancestor** and both build the whole product:

| | this branch (`main`) | `qadam-project-brief-7c9pup` |
|---|---|---|
| app location | `mobile/` | repo root (`app/`, `src/`, `index.js`) |
| migrations | `20260819*` (16 files) | `20260818*` (22 files) |
| tables created | 19 | 23 |
| files | 129 | 117 |

**Fifteen tables are created by both**, under the same names:

```
brands  categories  challenges  coin_ledger  daily_steps  fraud_events
friendships  leaderboard_snap  order_items  orders  products
push_tokens  team_members  teams  users
```

Both migration sets in one repo means the suite runs `create table users` twice.
The second fails, and **the database does not build at all**. Git will merge the
trees — only 11 files conflict, all of them root config — but the result is a
repo with two Expo apps and a schema that cannot be applied. That is worse than
either branch alone, and it would look fine until someone ran the migrations.

So `main` is this implementation, and the other branch is kept intact rather
than merged over the top of it.

## Why this one is on main

It follows §10's build order exactly: Phase 0 foundations, then Phase 1 — the
earning app with **no store at all**, which §10 says to ship and then stop with
for four weeks. It is also the more heavily proven of the two: 307 database
assertions, 9 concurrency checks in real parallel sessions, 18 Edge Function
tests, 39 app tests, and design rules that fail the build, all behind
`npm run check`.

## What the other branch has that this one does not

Most of it is Phase 2 and 3 work, which §10 is explicit about not shipping until
Phase 1 has been in real users' hands. It is listed here so the decision is
deliberate rather than accidental — none of it is lost, and any of it can be
ported onto this schema.

**Phase 2 / 3 — deliberately not here yet**

- Cart and checkout, with §7.5's coin-burn warning above the button
- Fulfilment: WhatsApp order confirmation, a courier abstraction, dispatch
- The consignment catalogue importer (§8.4)
- Product page, and a locked shop with a notify-me list
- Admin economics report with a §3.3 alarm

**Worth porting sooner, in rough priority**

1. **In-app account deletion.** Both stores require it for any app with
   accounts, and it forces an early answer to what happens to an append-only
   coin ledger when a user leaves.
2. **Analytics event spec, with the Phase 1 gates computed in SQL.** Phase 1
   exists to answer one question — will people come back daily for a streak and
   a leaderboard? — and that is much easier to answer if the gates are defined
   before the four weeks start rather than after.
3. **Bundled fonts.** They cut the font payload from ~10 MB to ~1.5 MB. This
   branch loads the same four families through `@expo-google-fonts`; on the
   mid-range Android of §9.7, ten megabytes of typefaces is a real cost.
4. **OPERATIONS and METRICS docs.**

## If you want the other implementation instead

It is a legitimate choice — it is further along on commerce. Doing it cleanly
means resetting `main` to that branch rather than merging, and porting from this
one the things it does not have: the concurrency proofs, the three grant and
policy inventories that found a live margin leak, the property test over the §0
grid, and the design rules that fail the build.

Ask, and it can be done that way round.
