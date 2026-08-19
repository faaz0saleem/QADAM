# Definition of done for v0

README §12, walked item by item. The point of this file is to be honest about
the difference between *built* and *proven*, because those are not the same
thing and only one of them is worth trusting.

Legend: **proven** = a test or a check fails if it stops being true.
**built, unproven** = the code exists and typechecks, but nothing has exercised
it against the real world. **not started** = exactly that.

---

### ☑ A violating discount is rejected by the database, proven by a passing test

**Proven twice over.** `01_margin_cap_test.sql` (35 assertions) and
`11_margin_property_test.sql` (12).

The first covers the arithmetic at both boundaries, the PKR 94,000 phone that
caps at 1.1% of price, rejection one rupee over the cap, and the two routes
around the cap that matter: a forged cost on the order line, and a discount
moved off the lines onto the header.

The second sweeps a grid from a PKR 50 sachet to a PKR 500,000 laptop at margins
from 1% to 90%, and checks §3.3's claim holds on every point of it — not merely
that gross profit stays non-negative, but that at least 80% of margin always
survives. Sixty of those pairs then go through the real constraint as order
lines: accepted at the cap, rejected one rupee over.

### ☐ Steps sync on both platforms, survive app restart, and queue while offline

**Built; the queue is proven, the platform bridges are not.**

`mobile/src/lib/queue.ts` has seven tests including the merge rule that matters —
a day keeps its highest reading, so a reinstall reporting a lower figure cannot
delete someone's walk — and the corrupt-store path returns empty rather than
throwing into sync. Restart survival follows from the queue being on disk.

What is unproven is `mobile/src/lib/health.ts` against real Health Connect and
real HealthKit. Both are native modules; neither can run in CI or in a simulator
that has no step history. **This needs a device.**

### ☑ A rooted emulator submitting 500,000 steps earns zero coins

**Proven.** `03_step_ingestion_test.sql`, the last assertion in the file.

It earns zero by three independent routes: attestation fails, the rate ceiling
rejects 500,000 steps in a day, and the daily cap would hold it to 15,000 even
if both were bypassed. The device flags are recorded as fraud events rather than
triggering a ban, per §6.1.

Note the *client* half of attestation is unproven — `expo-app-integrity` needs a
real signed build and a Play Console entry to return anything.

### ☑ The leaderboard shows correct ranks across all four scopes and refreshes on schedule

**Proven for the ranking; the schedule is configured but has never fired.**

`05_teams_leaderboards_test.sql` and `08_social_test.sql` cover all four scopes,
that a flagged day is excluded from ranking while staying in the user's own
total, that a banned account leaves every board, and that the week starts Monday
PKT. `private.rebuild_leaderboards()` is scheduled at `*/15` via pg_cron in
`20260819011000_attestation_push_and_cron.sql`, which is a no-op on a local
cluster and has therefore never actually run.

### ☐ Coins expire correctly and the 7-days-out push notification fires

**Expiry is proven. The push has never been sent.**

`02_coin_ledger_test.sql` covers the case that breaks a naive ledger: a batch
spent while live and since lapsed contributes exactly zero rather than
double-subtracting into a negative balance. `coins_expiring_soon()` is tested in
`07_service_surface_test.sql`.

The Edge Function is written and typechecks. It has never reached Expo's push
service, because that needs an EAS project, a device token, and the two database
settings listed in HUMAN_TASKS.md.

### ◐ The full UI matches §9 — dark earning half, light shop half, tabular figures throughout

**The earning half is built. The shop half does not exist, deliberately.**

§10 ships Phase 1 with no store at all, so the light half is defined in
`src/theme/tokens.ts` and unused. That is on purpose: a light half bolted on in
Phase 2 would end up as the dark half with the colours inverted, which is not
the same thing.

Two of §9's rules are **proven** by `scripts/check-design.py`: brass appears in
exactly the token, `Coin.tsx`, and one named notification-channel exception, and
the four forbidden words never reach user-facing copy. Tabular figures are
structural — every number goes through a component that sets the monospace face.

What is unproven is that any of it looks right. Nothing has been rendered.

### ☐ Urdu renders correctly RTL on every screen

**Built, unproven, and the one I would expect to find problems in.**

Every string is translated and the dictionary is typed against the English one,
so a missing key will not compile. `I18nManager.forceRTL` is wired with an
honest restart prompt. But Nastaliq has a steep diagonal baseline that clips at
Latin line heights, mixed Latin-Urdu strings reorder in ways that only show up
on screen, and no amount of typechecking sees any of it. **This needs a device
and a native speaker**, both of which are in HUMAN_TASKS.md.

### ☐ It runs acceptably on a mid-range Android from three years ago

**Not started.** §9.7 is explicit that this is the actual hardware, not a
simulator. Nothing has been measured. The choices that should help — no
Reanimated, native-driver animations only, no parallax, snapshotted leaderboards
rather than ranking on read — are choices, not evidence.

### ☑ Nothing else is reachable either — three inventories

**Proven, and each found something.** This is not a §12 item; it is the thing
§12 assumes.

`12_privileges_test.sql` enumerates every table and column any client role can
read or write. It found `order_items.cost_pkr` granted to `authenticated` —
every customer could read our cost on everything they had ever bought.
`13_function_grants_test.sql` enumerates every callable function and found a
private trigger function left world-executable by Postgres's own default. The
policy assertions pin `using (true)` to the three tables where it belongs.

Spot-checks find what someone thought to check. These enumerate, so widening the
client surface means editing a list on purpose.

### ☑ It behaves under concurrency

**Proven.** `scripts/test-concurrency.sh`, nine checks in real parallel sessions
— which pgTAP cannot do, because it runs everything in one transaction.

Two phones syncing the same day mint 100 coins rather than 200. Five concurrent
spends of 30 against a balance of 100 let exactly three through, leaving 10 and
not minus 20. A replayed AdMob callback pays once. I had reasoned all of this
out from the row locks beforehand; the five-way race is the one that would have
caught me being wrong.

### ☑ `HUMAN_TASKS.md` is current

**Proven by being maintained.** It carries the blocking items, the slow-start
accounts, and the five judgement calls made along the way, each with the
reasoning so they can be overturned.

---

## The honest summary

Everything that can be enforced by the database or a script is enforced and
proven: 307 pgTAP assertions, 9 concurrency checks in real parallel sessions, 18
Deno tests over the signature parsing, 36 jest tests, and a design checker — all
run by `npm run check`.

Everything that needs a phone is unproven. That is not a gap in the work so much
as a wall: **the next real progress on this list needs a Supabase project, an
Apple Developer account, a Play Console entry and a cheap Android handset**, all
of which are P1 items in HUMAN_TASKS.md and none of which I can create.

The one item I would flag as genuinely at risk is iOS. App Attest verification
is not implemented, so iOS submissions currently earn zero coins — the correct
failure direction, but it means iOS cannot ship until it is finished, and
finishing it needs the Apple team id.
