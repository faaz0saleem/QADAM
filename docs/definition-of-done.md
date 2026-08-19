# §12 — where v0 actually stands

The brief's ship criteria, with evidence for each. "Proven" means a test asserts
it and the test passes; "built, unverified" means the code exists and typechecks
but nothing has run on a phone.

Regenerate the evidence with `npm run check` (197 tests, typecheck clean).

---

### ✅ A violating discount is rejected by the database, proven by a passing test

**Proven.** `db/test/margin_rule.test.mjs`, 17 tests.

The rule is a CHECK constraint, so the tests write straight to the tables as the
table owner with no checkout code in the path, and the database still refuses.
Covered: exactly at the ceiling accepted, one rupee over rejected, an UPDATE past
the ceiling rejected, quantity scaling, a fabricated price/cost snapshot, an
ineligible category, and 500 random price/cost pairs against both arms of the
formula.

Also proven at order level: the header cannot be used to route around the item
check, a discount must be backed by real coins at the snapshotted rate, and
`order_economics.gross_profit_pkr` stays non-negative across 300 random orders
each discounted to its maximum.

### ⚠️ Steps sync on both platforms, survive app restart, and queue while offline

**Built, unverified.** `src/lib/health/`, `src/data/AppState.tsx`.

The offline queue is written and drops submissions past §6.1's 48-hour backfill
window rather than retrying them forever. Foreground sync is wired to
`AppState`. None of it has run against a real Health Connect or HealthKit store,
because that needs a dev build on a device — `HUMAN_TASKS.md`.

### ✅ A rooted emulator submitting 500,000 steps earns zero coins

**Proven for the database half.** `db/test/steps.test.mjs`.

The exact case is a test: 500,000 steps, unattested, flagged emulator and rooted
→ zero coins, zero balance, raw steps still recorded so the user sees their own
total, and three fraud events written. Also proven: the daily cap, the day-window
rate ceiling, the backfill window, and that a rejected attempt is indistinguishable
from an honest zero.

**The attestation half is built but cannot mint until keys exist.** The Edge
Function fails closed, which is why nothing at all mints on a fresh project.
`HUMAN_TASKS.md`, P1.

### ✅ The leaderboard shows correct ranks across all four scopes and refreshes on schedule

**Proven.** `db/test/leaderboard.test.mjs`.

City, team, friends and all-Pakistan; Monday 00:00 PKT weekly reset plus all-time;
unattested steps excluded from ranking but still shown in the user's own total;
suspended accounts off the board; the pinned self-rank with percentile framing;
and an idempotent refresh, since the cron runs every 15 minutes.

**The cron itself is written, not scheduled** — `supabase/cron.sql` runs against a
hosted project once one exists.

### ⚠️ Coins expire correctly and the 7-days-out push notification fires

**Expiry is proven; delivery is built, unverified.**

`db/test/coin_ledger.test.mjs` proves FIFO allocation across expiry batches, that
expired coins fall out of the balance with no sweep job, and that spent coins stop
counting toward a batch. `db/test/notifications.test.mjs` proves the warning is
queued inside the window, not queued outside it, queued exactly once across
repeated daily sweeps, and counts only what is left after a spend.

`send-notifications` delivers through Expo Push and has not run — it needs a
deployed project and a real device token.

### ⚠️ The full UI matches §9 — dark earning half, light shop half, tabular figures throughout

**Built, and the mechanical parts are enforced.** `src/theme/tokens.test.mjs`
asserts brass never fills a non-coin surface, no hex escapes the palette, every
numeric style sets tabular figures, and every font named in a style is bundled.

What a test cannot judge is whether it looks right. That needs eyes on a device.

### ⚠️ Urdu renders correctly RTL on every screen

**Strings and RTL wiring are done and checked; rendering is not.**
`src/i18n/copy.test.mjs` proves key parity between the languages, that every
`{{placeholder}}` survives translation, that no string was left in English, and
that the §9.6 banned vocabulary appears nowhere.

The Urdu is a working draft. Nastaliq is unforgiving about line height and needs
a native reader for register — `HUMAN_TASKS.md`, P3.

### ❌ It runs acceptably on a mid-range Android from three years ago

**Not verified, and cannot be from here.** This is the criterion most likely to
surface real problems: the mint animation, Nastaliq line breaking, and the
leaderboard list are all plausible offenders. `HUMAN_TASKS.md` tracks buying a
PKR 25–35k handset for exactly this.

### ✅ `HUMAN_TASKS.md` is current

Updated as each blocker was found rather than at the end.

---

## What is finished beyond §12

The brief's phases run to week 10; the server side of all of them is in.

| | |
|---|---|
| Phase 0 | Schema, the §0 constraints, the tests that prove them |
| Phase 1 | Steps, coins, anti-fraud, streaks, four leaderboard scopes, teams, expiry notifications, the §9 design system |
| Phase 2 | Catalogue, CSV importer, checkout with the margin cap, COD flow with WhatsApp confirmation and coin burn on refusal, courier integration, the admin report |
| Phase 3 | Referrals on first purchase, rewarded video, shareable team codes |
| Phase 4 | Not started — store submission needs the accounts in `HUMAN_TASKS.md` |

## The one thing to know before deploying

**A fresh Supabase project mints nothing.** Attestation fails closed by design
(§6.1), so until the Play Integrity and DeviceCheck credentials exist, every step
submission is treated as unattested and earns zero coins. That is the correct
behaviour — it means the economy cannot be farmed before anti-fraud is real — but
it looks like a broken app if you are not expecting it.

`ALLOW_UNATTESTED=true` is the development escape hatch. It is a server secret no
client can set, and every use writes an auditable `fraud_events` row. It must
never be set on production.
