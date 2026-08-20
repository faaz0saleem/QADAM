# What is built

A plain list of what exists in Qadam today, what is proven by a test, and what is
deliberately not built. Everything below is on the branch this was developed on.

**Verification in one command:** `npm run check` — 491 database assertions across
19 pgTAP files, 9 concurrency checks in real parallel sessions, 18 Edge Function
tests, 39 app tests, and the §9 design rules.

```
migrations  31        pgTAP files  19        edge functions  8
app screens 15        assertions   491       languages       2 (en, ur)
catalogue   57 SKUs   categories   8         brands          6
```

All four of §10's phases are built. That overrides §10's sequencing, which says
Phase 1 ships with no store and stops for four weeks with real users first — a
deliberate instruction, and the four-week test is still worth running before the
shop is switched on. `store_feed` over an empty catalogue is a perfectly good way
to ship Phase 1 out of this same codebase.

---

## The rule everything else hangs off (§0)

| | |
|---|---|
| ✅ | The margin cap is a **database constraint**, not application code. `max_coin_discount_pkr(price, cost)` is immutable; `order_items.discount_within_margin` calls it per line × qty. |
| ✅ | The line's price/cost snapshot must match the product and cannot be edited afterwards, so an understated cost cannot forge a wider cap. |
| ✅ | The order header is validated against the sum of its lines, so a discount cannot be moved off the lines onto the header. |
| ✅ | **Every** checkout path is under it — solo orders and team baskets alike, through the same `line_discount_cap()` and the same CHECK. |
| ✅ | Proven over a grid from a PKR 50 sachet to a PKR 500,000 laptop at margins from 1% to 90%: at least 80% of gross margin always survives. |

Real numbers from the seeded catalogue — no special-casing anywhere:

| Item | Price | Max coin discount | % of price |
|---|---|---|---|
| Kohl pencil | 900 | 90 | 10.0% |
| Lawn kurta, navy | 3,200 | 260 | 8.1% |
| Wireless earbuds | 6,900 | 340 | 4.9% |
| Leather tote | 8,900 | 740 | 8.3% |
| Smartphone 128GB | 94,000 | 1,000 | **1.1%** |

## Coins

- ✅ **Append-only ledger.** UPDATE and DELETE raise. There is no balance column anywhere, and a test asserts none exists.
- ✅ **Exact expiry.** Every debit names the batch it draws from, so a spend-then-lapse cannot double-subtract into a negative balance. No cron in the correctness path.
- ✅ **FIFO by soonest expiry** — the coins you are about to lose are the ones you spend first.
- ✅ Wallet grouped by expiry batch, so "2,400 coins expiring in 11 days" is a dated thing and not a surprise.
- ✅ Seven-day redemption hold on new accounts, stated in the wallet with the date.
- ✅ **Coins cannot move between users.** No transfer, no gift, no cash-out. A trigger refuses a debit that draws on someone else's batch; a test asserts no such function exists; and after a three-person team basket, a test asserts every debit came out of a batch belonging to the person debited and no positive delta was written anywhere.

## Steps and anti-fraud (§6.1)

- ✅ **Live counter on the home screen**, the way Sweatcoin does it: 1.5s while the number is moving, opening out to 10s when it stops, back to fast on foreground. Display only — coins still come from the server.
- ✅ A five-pixel dot says the health read is alive, because "you stopped walking" and "the read is failing" are otherwise the same still number.
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
- ✅ Teams: create, join by 6-character code, roster, hand over captaincy, leave. `qadam://join/<code>` survives the trip through sign-in. **Capped at five.**
- ✅ Friends, using the same code people already share for referrals.
- ✅ Live challenge shown on the board. No join button — entry is free and nothing is at stake, and the schema has nowhere to put a fee.

## Team baskets

One basket, one team, everybody says yes.

- ✅ A member opens a basket; **every other member has to agree**. Unanimous, no quorum, one no ends it.
- ✅ On the last yes the order is placed and each approving member's coins are debited **from their own ledger, against their own batches**, for their own share. No coin changes owner (§13.3).
- ✅ The RPC takes two booleans and an id — no pledge, no share, no coin count (§13.2). The server decides who funds what, from balances and a rate no client can read.
- ✅ Allocation is water-filling across the approvers, smallest purse first, so someone with 40 rupees of reach is asked for 40 rather than skipped.
- ✅ "Agree, but keep my coins" is a first-class choice: permission and funding are separate.
- ✅ Expires in 48 hours, one open basket per team, and a weekly ceiling on funding other people's baskets.
- ✅ Cancelling a placed team basket returns every contributor their own coins, **with the original expiry**.

## The store, and where the catalogue comes from

- ✅ Browse with a category rail and four sorts, paged rather than infinite-scrolled, with skeletons sized like the cards that are coming.
- ✅ Every card shows the saving **this** user can make today — rupees, never a rate (§4).
- ✅ COD checkout, cash-on-delivery risk scoring, WhatsApp confirmation above the threshold, one courier interface.
- ✅ Coins burn on refusal and come back only on cancellation, which is the whole COD mechanism.
- ✅ **`supplier_feeds`** — every bulk-imported product traces to a named source with a licence on record. A feed with no licence cannot be imported from.
- ✅ **`import_feed_rows()`** — idempotent on (feed_id, sku), so a nightly refresh updates prices and stock instead of duplicating the catalogue. Every rejection names the row and the reason.
- ✅ **`price_benchmarks`** (§8.1) — what the market charges, in `private`, never republished. `pricing_report()` puts our price beside the market median and beside what §0 leaves us to discount.
- ✅ **`brand_outreach`** (§8.2) — the Lahore prospect list, ranked by reach among the ones we can actually contact.
- ✅ **An affiliate listing cannot be ordered.** A trigger on `order_items` refuses it, because we do not stock it and cannot ship it (§8). The interface says the same thing before anyone reaches a basket.

## Earning extras

- ✅ Rewarded video: 30 coins, 3/day, counted server-side. A replayed AdMob callback pays once.
- ✅ **No ad can be recorded in the shopping flow** — the placement constraint has no value that could name one.
- ✅ Referrals pay both sides on the referee's first **delivered** order, never on install.

## The app

- ✅ Phone OTP sign-in; the number is accepted in all six forms people actually write it.
- ✅ Five tabs: Steps · Board · Shop · Wallet · You.
- ✅ §9 design system: the two-temperature palette, brass **only** on coin values, tabular figures on every number, a ruled ledger line rather than a ring.
- ✅ **The transition between the two temperatures is animated** (§9.1's "most important moment"): the background travels from the temperature you were standing in over 240ms while the content arrives on a shorter, later curve.
- ✅ The minting moment: a struck-metal strike and settle with a haptic; reduced motion keeps the haptic.
- ✅ The ledger rule grows to its value rather than teleporting to it.
- ✅ Bilingual English/Urdu with RTL, typed so a missing translation will not compile.
- ✅ Loading, empty and error states on every screen; offline and "server refused" say different things.
- ✅ Accessibility: labels on every interactive element, grouped rows, reduced motion honoured everywhere, works at 320px.
- ✅ **In-app account deletion**, which both stores require. Everything goes — including coins, which have nowhere else to be.

## Building it

Three routes, in order of how little you have to install:

- ✅ **`.github/workflows/apk.yml`** — builds it on GitHub's runners, which already carry the Android SDK and NDK, and uploads the `.apk` under Artifacts. Nothing to install anywhere. Blocked only by GitHub Actions being dead on this account (see below).
- ✅ **`npm run apk`** — EAS Build in the cloud. Needs a free Expo account and one `eas login`.
- ✅ **`npm run apk:local`** — `scripts/build-apk.sh` on a machine with the Android SDK. Bundles the JS first, because Metro finds a broken import in ten seconds and Gradle finds the same one in eleven minutes.
- ✅ `mobile/eas.json` — the `preview` profile builds an **APK**; `production` builds the `.aab` Play requires, which cannot be installed by hand.
- ✅ Verified here: the app bundles to 3.8MB of Hermes bytecode and prebuild generates a clean Android project. The binary itself cannot be produced in the development container — its egress policy returns 403 for `dl.google.com`, so the Android SDK cannot be downloaded.
- ✅ A build with no Supabase project configured now says so on a designed screen rather than failing at the sign-in form.

## Infrastructure

- ✅ Eight Edge Functions: nonce issuing, step ingestion, AdMob signature verification, coin-expiry push, streak push, account deletion, order confirmation, courier webhook.
- ✅ Local Postgres test harness — **no docker needed**.
- ✅ Development seed: 8 users, a week of walking, a team, friendships, a live challenge, and a 57-SKU catalogue loaded **through the importer** rather than typed into `products`.
- ✅ `ARCHITECTURE.md`, `DEVELOPING.md`, `DEFINITION_OF_DONE.md`, `HUMAN_TASKS.md`.

## Bugs found and fixed along the way

These were real, and each is now pinned by a test or by a generated manifest:

1. **A margin leak.** `order_items.cost_pkr` was granted to signed-in users — every customer could read our cost on everything they had bought.
2. **A fraud bypass.** A rejected step submission still stored its raw count, so re-submitting one step higher collected the full capped payout.
3. **A launderable rate ceiling.** It measured increments, so a rejected figure could be resubmitted in slices.
4. **World-callable functions.** Postgres grants EXECUTE to PUBLIC by default; revoking from `anon` did nothing. Any signed-in user could read anyone's balance and call `submit_steps` directly.
5. **A signature parser that accepted malformed input** — it guards a public endpoint.
6. **Ties decided by UUID** on a leaderboard with prizes attached.
7. **A permission dialog on every app launch**, which is the fastest way to be denied forever.
8. **A dead deep link** — the team invite was lost during sign-in.
9. **The AdMob app id was missing from the manifest.** Not the ad unit — the app id. The Mobile Ads SDK throws on startup without it, so the app died at the splash screen on any real build.
10. **The Health Connect rationale was missing.** Android 14 will not grant a health permission without it and Play's health declaration requires it — so the earning half did not work on a modern phone.
11. **`SYSTEM_ALERT_WINDOW`** was being contributed by React Native's dev overlay. "Draw over other apps" is exactly the permission a Play reviewer stops at.
12. **An affiliate listing could be ordered**, and advertised a 10% discount out of a margin we never had, on a sale that was not ours.
13. **The product screen fetched the first 60 products and searched them** for the one it wanted — a bug that arrives at the 61st SKU, i.e. exactly when sourcing starts working.
14. **A test file with no `finish()`.** pgTAP reports nothing about the plan without it, and one file ran 43 assertions against a plan of 39 while showing green. `scripts/test.sh` now fails a file that omits it.

---

## Asked for, and deliberately not built

Two requests conflict with the brief. Both got the nearest thing that does not.

**"Their credits can be pooled."** §13.3: *"Never add coin transfer, coin gifting,
or cash-out. Ever."* Coins never move between users, and the ledger enforces it a
layer below any feature. What was built instead is co-payment: one shared basket,
unanimous approval, and every member who agrees spends **their own** coins on it.
The economic effect people want from pooling — a group reaching a discount none of
them could reach alone — arrives without a coin ever changing owner.

**"Scrape the whole Daraz."** §8: *"Don't lift catalogues and photos from other
retailers… competitor terms of service prohibit it, and affiliate accounts get
terminated for exactly this. Worse, it's operationally broken: if you scrape a
listing you don't stock and someone orders it, you have nothing to ship."* And
§7.4: *"We cannot out-catalogue Daraz and must not try."* What was built instead
is the four things §8 endorses — licensed supplier feeds, an idempotent bulk
importer, private price benchmarking, and the brand outreach list — which is the
road to a large catalogue we can actually post.

## Blocked on you

| | |
|---|---|
| 🔴 | **Supabase project** — nothing runs against a real database without it. |
| 🔴 | **An Expo/EAS account**, or a machine with the Android SDK. There is no route to an installable Qadam that skips a native build; the health libraries are native modules. |
| 🔴 | **AdMob app ids.** The config falls back to Google's published test ids so a build runs; shipping those means zero revenue. |
| 🔴 | **iOS App Attest.** Not implemented, so iOS earns zero coins today. Correct failure direction, but it blocks an iOS ship, and finishing it needs your Apple team id. Android attestation is complete. |
| 🔴 | **GitHub Actions is disabled at the account level.** Every run dies in two seconds with no runner. Checks run locally before every commit meanwhile. |
| 🟠 | Apple Developer + Play Console, Play Integrity project, SMS provider, privacy policy URL, WhatsApp template. |
| 🟠 | A cheap three-year-old Android to test on — §9.7 says that is the real hardware. |

Full detail, with how to do each, is in `HUMAN_TASKS.md`.

## Honest gaps

Everything enforceable by the database or a script is enforced and proven.
Everything that needs a phone is **unproven** — the Health Connect and HealthKit
bridges, Urdu rendering, push delivery, the APK itself, and performance on real
hardware. That is a wall rather than a gap: the next real progress on those needs
the accounts above. `DEFINITION_OF_DONE.md` walks §12 item by item and says which
is which.
