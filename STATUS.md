# What is built

A plain list of what exists in Qadam today, what is proven by a test, and what is
deliberately not built yet. Everything below is on `main`.

**Verification in one command:** `npm run check` — 307 database assertions,
9 concurrency checks in real parallel sessions, 18 Edge Function tests,
39 app tests, and the §9 design rules.

---

## The rule everything else hangs off (§0)

| | |
|---|---|
| ✅ | The margin cap is a **database constraint**, not application code. `max_coin_discount_pkr(price, cost)` is immutable; `order_items.discount_within_margin` calls it per line × qty. |
| ✅ | The line's price/cost snapshot must match the product and cannot be edited afterwards, so an understated cost cannot forge a wider cap. |
| ✅ | The order header is validated against the sum of its lines, so a discount cannot be moved off the lines onto the header. |
| ✅ | Proven over a grid from a PKR 50 sachet to a PKR 500,000 laptop at margins from 1% to 90%: at least 80% of gross margin always survives. |

Real numbers from the seeded catalogue — no special-casing anywhere:

| Item | Price | Max coin discount | % of price |
|---|---|---|---|
| Lawn kurta | 3,200 | 260 | 8.1% |
| Embroidered shawl | 5,500 | 480 | 8.7% |
| Wireless earbuds | 6,900 | 340 | 4.9% |
| Smartphone 128GB | 94,000 | 1,000 | **1.1%** |

## Coins

- ✅ **Append-only ledger.** UPDATE and DELETE raise. There is no balance column anywhere, and a test asserts none exists.
- ✅ **Exact expiry.** Every debit names the batch it draws from, so a spend-then-lapse cannot double-subtract into a negative balance. No cron in the correctness path.
- ✅ **FIFO by soonest expiry** — the coins you are about to lose are the ones you spend first.
- ✅ Wallet grouped by expiry batch, so "2,400 coins expiring in 11 days" is a dated thing and not a surprise.
- ✅ Seven-day redemption hold on new accounts, stated in the wallet with the date.
- ✅ Coins cannot move between users. There is no transfer, gift or cash-out path, and a test asserts no such function exists.

## Steps and anti-fraud (§6.1)

- ✅ **Live counter on the home screen** — reads the phone every 3s and counts up, like Sweatcoin. Display only; coins still come from the server.
- ✅ Server-side daily cap (15,000), 200 steps/minute rate ceiling, 48-hour backfill window, future dates refused.
- ✅ Device attestation required; rejections are silent and shaped exactly like acceptances.
- ✅ One-account-per-device flagging (flags, never auto-bans — shared handsets are normal here).
- ✅ Offline queue on disk; a day keeps its highest reading, so a reinstall cannot delete a walk.
- ✅ Background sync every 4 hours, so a streak survives a day the app is never opened.
- ✅ **§12's test case passes:** a rooted emulator submitting 500,000 steps earns zero coins.

## Boards, teams, friends, challenges

- ✅ Four scopes — City · Team · Friends · All Pakistan — weekly resetting Monday 00:00 PKT, plus all-time.
- ✅ Your own rank pinned with a percentile ("4,382 — top 12%").
- ✅ Ties share a rank. They were being broken by account id, which is not a defensible way to lose a prize.
- ✅ Flagged days are excluded from ranking but stay in your own total — a false positive must not feel like theft.
- ✅ Teams: create, join by 6-character code, roster, hand over captaincy, leave. `qadam://join/<code>` survives the trip through sign-in.
- ✅ Friends, using the same code people already share for referrals.
- ✅ Live challenge shown on the board. No join button — entry is free and nothing is at stake, and the schema has nowhere to put a fee.

## Earning extras

- ✅ Rewarded video: 30 coins, 3/day, counted server-side. A replayed AdMob callback pays once.
- ✅ **No ad can be recorded in the shopping flow** — the placement constraint has no value that could name one.
- ✅ Referrals pay both sides on the referee's first **delivered** order, never on install.

## The app (Phase 1)

- ✅ Phone OTP sign-in; the number is accepted in all six forms people actually write it.
- ✅ Referral code step after first sign-in, asked once and never again.
- ✅ Four tabs: Steps · Board · Wallet · You.
- ✅ §9 design system: the two-temperature palette, brass **only** on coin values, tabular figures on every number, a ruled ledger line rather than a ring.
- ✅ The minting moment: a struck-metal strike and settle with a haptic; reduced motion keeps the haptic.
- ✅ Bilingual English/Urdu with RTL, typed so a missing translation will not compile.
- ✅ Loading, empty and error states on every screen; offline and "server refused" say different things.
- ✅ Accessibility: labels on every interactive element, grouped rows, works at 320px.
- ✅ **In-app account deletion**, which both stores require. Everything goes — including coins, which have nowhere else to be.

## Infrastructure

- ✅ Five Edge Functions: nonce issuing, step ingestion, AdMob signature verification, coin-expiry push, streak push.
- ✅ Local Postgres test harness — **no docker needed**.
- ✅ Development seed: 8 users, a week of walking, a team, friendships, a live challenge, a catalogue.
- ✅ `ARCHITECTURE.md`, `DEVELOPING.md`, `DEFINITION_OF_DONE.md`, `HUMAN_TASKS.md`.

## Bugs found and fixed along the way

These were real, and each is now pinned by a test:

1. **A margin leak.** `order_items.cost_pkr` was granted to signed-in users — every customer could read our cost on everything they had bought.
2. **A fraud bypass.** A rejected step submission still stored its raw count, so re-submitting one step higher collected the full capped payout.
3. **A launderable rate ceiling.** It measured increments, so a rejected figure could be resubmitted in slices.
4. **World-callable functions.** Postgres grants EXECUTE to PUBLIC by default; revoking from `anon` did nothing. Any signed-in user could read anyone's balance and call `submit_steps` directly.
5. **A signature parser that accepted malformed input** — it guards a public endpoint.
6. **Ties decided by UUID** on a leaderboard with prizes attached.
7. **A permission dialog on every app launch**, which is the fastest way to be denied forever.
8. **A dead deep link** — the team invite was lost during sign-in.

---

## Deliberately not built

- **The store.** §10 says Phase 1 ships with no store at all, then stops for four weeks with real users. The tables exist because §0 has to be structural from day one; no shop UI ships until that test has run.
- Sponsored challenge creation, the CSV importer, courier integration, the admin dashboard — all Phase 2/3.

## Blocked on you

| | |
|---|---|
| 🔴 | **Supabase project** — nothing runs against a real database without it. |
| 🔴 | **iOS App Attest.** Not implemented, so iOS earns zero coins today. Correct failure direction, but it blocks an iOS ship, and finishing it needs your Apple team id. Android attestation is complete. |
| 🔴 | **GitHub Actions is disabled at the account level.** Every run dies in two seconds with no runner. Checks run locally before every commit meanwhile. |
| 🟠 | Apple Developer + Play Console, Play Integrity project, SMS provider, privacy policy URL. |
| 🟠 | A cheap three-year-old Android to test on — §9.7 says that is the real hardware. |

Full detail, with how to do each, is in `HUMAN_TASKS.md`.

## Honest gaps

Everything enforceable by the database or a script is enforced and proven.
Everything that needs a phone is **unproven** — the Health Connect and HealthKit
bridges, Urdu rendering, push delivery, and performance on real hardware. That
is a wall rather than a gap: the next real progress on those needs the accounts
above. `DEFINITION_OF_DONE.md` walks §12 item by item and says which is which.
