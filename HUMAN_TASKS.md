# What I need from you

README §11. Everything here is something I cannot do myself — an account, a
credential, a decision, or a real-world action. Priority first, blocking flag where
the work genuinely stops without it.

I keep this current. Finished items move to **Done** at the bottom rather than being
deleted, so you can see what has already been handled.

---

## Blocking now

- [ ] **P1 · BLOCKING for CI** — Turn on GitHub Actions for this repository
      Why: every CI run so far has died in about two seconds with no runner
      assigned and no step output at all — not a failing test, a job that never
      started. The workflow YAML parses, and the full suite passes locally
      (`./scripts/test.sh`, `mobile: npx tsc --noEmit`, `scripts/check-design.py`).
      I removed the one third-party action so the workflow now depends on nothing
      but `actions/checkout`, and the next run failed the same way, which rules
      out an action-permissions policy on marketplace actions.
      What is left is a repository or account setting only you can reach:
      Settings → Actions → General → check "Allow all actions and reusable
      workflows" is selected and that Actions is enabled for this repo. If it is
      already on, check github.com/settings/billing for a spending limit or a
      payment issue — this is a public repo so standard runners should be free,
      but a blocked account still stops jobs before they start.
      Until this is sorted, the checks run locally and I run them before every
      commit; nothing has been pushed without them passing.

- [ ] **P1 · BLOCKING** — Create the Supabase project, paste the URL and anon key into `.env.local`
      Why: nothing runs against a real database without it. The schema and its tests
      run locally today (`./scripts/test.sh`, no docker needed), but no app can talk
      to anything until this exists.
      How: supabase.com → New project → region Singapore or Mumbai, whichever pings
      better from Lahore → Settings → API → copy `Project URL` and `anon public`.
      Also copy `service_role` — it goes in `.env.local` only, never near the app bundle.

- [ ] **P1 · BLOCKING** — Decide the name
      Why: it lands in the bundle id, the Supabase project, the domain and both store
      listings, and changing it after the first store submission is genuinely painful.
      Qadam is a working name. Keep it or replace it, but decide before Phase 1 ships.

- [ ] **P1 · BLOCKING** — Apple Developer Program enrolment (~USD 99/yr)
      Why: no TestFlight build, no HealthKit entitlement, no App Attest without it.
      Enrolment can take several days if Apple asks for business verification, so
      start it now even though we do not need it until Phase 1 ships.
      How: developer.apple.com/programs → enrol as an individual or as a company
      (a company needs a D-U-N-S number, which adds a week or two).

- [ ] **P1 · BLOCKING** — Google Play Console account (USD 25, one-off)
      Why: internal testing track, and the Health Connect declaration below.
      How: play.google.com/console → pay → identity verification.

- [ ] **P1 · BLOCKING** — Expo account and an EAS project
      Why: we need a dev build, not Expo Go — the health libraries are native modules.
      How: expo.dev → sign up → `eas init` once the app scaffold lands.

## Needed for Phase 1 (the earning app)

- [ ] **P1** — SMS provider for phone OTP, with Pakistan delivery you have actually tested
      Why: phone is the identity in this market and Supabase Auth needs a provider
      behind it. Delivery rates to Pakistani numbers vary a lot between providers —
      test with a real Jazz, Zong and Telenor number before committing.
      How: Supabase → Authentication → Providers → Phone → Twilio / Vonage / MessageBird.

- [ ] **P1** — Google Cloud project with the Play Integrity API enabled
      Why: §6.1 requires attestation on every step submission. Without it, the
      ingestion path has to run with attestation off, and the economy is farmable.
      How: console.cloud.google.com → new project → enable Play Integrity API → link
      it to the Play Console app → put the project number in
      `GOOGLE_PLAY_INTEGRITY_PROJECT_NUMBER`.

- [ ] **P1 · BLOCKING for iOS earning** — Apple App Attest / DeviceCheck key
      Why: the iOS half of the same control, and right now **iOS submissions earn
      zero coins** because App Attest verification is not implemented. That is the
      correct failure direction — attestation fails closed rather than waving
      submissions through — but it does mean iOS cannot ship until it is finished,
      and finishing it needs the team id and bundle id from this step.
      The remaining work is mine, not yours; `supabase/functions/_shared/attest.ts`
      lists the five steps. Android is complete and verified against Play Integrity.
      How: developer.apple.com → Certificates, Identifiers & Profiles → Keys → new key
      with DeviceCheck enabled. Download the `.p8` once — Apple will not show it again.

- [ ] **P1** — Health Connect declaration form (Google Play)
      Why: Play rejects any app reading Health Connect data without an approved
      declaration, and the review round-trip is slow. Submit it early.
      How: Play Console → App content → Health apps declaration. Say plainly: we read
      step count and distance, we use it only to award in-app coins, we do not share
      it, we do not use it for advertising.

- [ ] **P1** — Privacy policy and terms, on a real URL
      Why: both stores require a reachable privacy policy URL before review, and the
      health data disclosure has to match what the app actually does.
      Must say: we read step count and distance from Health Connect / HealthKit; we
      never sell or share health data; we never use it for advertising; coins have no
      cash value and cannot be transferred or withdrawn.

- [ ] **P1** — Two database settings, once the project and functions exist
      Why: pg_cron reaches the notification Edge Functions through `private.notify()`,
      which needs to know where they live. Without these the coin-expiry push — §4's
      single best reactivation lever — silently never fires.
      How: in the Supabase SQL editor, once you have the project ref and service key:
      ```sql
      alter database postgres set app.functions_base_url = 'https://<ref>.supabase.co/functions/v1';
      alter database postgres set app.service_role_key   = '<service role key>';
      ```

- [ ] **P2** — Point AdMob's server-side verification at the callback
      Why: rewarded video only pays out through a signature Google signs. Until the
      SSV URL is set, watching an ad credits nothing.
      How: AdMob → the rewarded ad unit → Server-side verification →
      `https://<ref>.supabase.co/functions/v1/admob-ssv`.

- [ ] **P2** — Domain, for the privacy policy, deep links and the eventual site.

- [ ] **P2** — A cheap three-year-old Android handset for testing
      Why: §9.7 — that is the actual hardware this market runs. A simulator will not
      show you the jank.

- [ ] **P2** — Font licences: Familjen Grotesk or Bricolage Grotesque (display),
      Inter (body), JetBrains Mono or Roboto Mono (data), Noto Nastaliq Urdu (Urdu).
      All four are open-licensed today; confirm before shipping so nothing surprises
      us at submission.

- [ ] **P2** — A native Urdu speaker to review every string
      Why: §9.3 ships bilingual from day one, and machine-translated Urdu in a
      financial context reads as untrustworthy.

## Needed for Phase 2 (commerce) — start the slow ones now

- [ ] **P1** — Courier account: TCS, Leopards or M&P, whichever gives us an account first
      Why: onboarding is slow and involves a physical meeting. The integration is
      abstracted behind one interface, so it does not matter which lands first — but
      it does matter that one of them has started.

- [ ] **P1** — WhatsApp Business API access (Meta) or a Twilio WhatsApp sender
      Why: §7.5 — no COD order above PKR 3,000 is dispatched without an automated
      confirmation. Meta's approval process takes weeks and needs a verified business.

- [ ] **P2** — Business bank account and a COD reconciliation process with the courier
      Why: couriers remit collected cash on their own cycle; without a reconciliation
      routine the RTO number in the admin dashboard will not match the money.

- [ ] **P2** — First brands signed, with their own product photography and a
      `title, price, cost, stock, images[]` spreadsheet
      Why: §8 — this is where the real catalogue comes from. The CSV importer is
      Phase 2 work and is useless without a signed brand behind it.
      Twenty good SKUs beat five thousand dropshipped ones.

## Needed for Phase 3

- [ ] **P2** — AdMob account and rewarded-video ad units for both platforms
      Why: §7.8. Rewarded video only — if a mediation partner or an AdMob rep suggests
      an interstitial in the shopping flow, the answer is no. One abandoned PKR 2,500
      order wipes out months of ad revenue from that user.

## Decisions I need from you

- [ ] **P1** — Legal read on the coin design, from a Pakistani lawyer
      Why: the whole structure rests on coins never converting to cash, never
      transferring between users, and never leaving the app — which is what keeps us
      out of gambling law, money-transmitter licensing and securities questions at the
      same time. Worth one hour of a lawyer's time to confirm that reading before we
      have users. The schema enforces it: there is no transfer path, and a debit
      cannot draw on another user's batch.

- [ ] **P1** — Confirm `STREAK_MIN_STEPS = 5000`
      Why: the brief sets the daily earning cap at 15,000 but does not say what makes
      a day *count* toward a streak. I picked 5,000 credited steps — a real walk, but
      reachable on a bad day, and a streak that breaks too easily stops being a hook.
      It is one row in `private.app_config`, editable without a redeploy.

- [ ] **P2** — Confirm the §4 numbers survive contact with a spreadsheet
      A month of solid walking is ~3,000 coins ≈ PKR 90; ninety days is ~9,000 ≈ PKR 270.
      That is deliberate and I have implemented it as written. Worth sanity-checking
      against your own view of what a Lahore customer will find worth coming back for.

- [ ] **P2** — Target city and category for the first brand outreach push (§8.2)
      Why: the scraping automation that builds the outreach list is the single
      highest-value thing we can point a browser at, and it needs a target.

- [ ] **P3** — How visible should the per-product discount cap be?
      §7.4 wants "Save PKR 180 with your coins" on the product card, which is right.
      Note the consequence: where the number shown equals the §0 cap, our cost on that
      item is exactly derivable from it. It only bites for users whose balance exceeds
      the cap, and only on items they look at. I have implemented the §7.4 behaviour;
      flagging it so the trade is yours, not mine.

---

## Decisions I made, that you can overturn

These were needed to keep moving. None of them touch §0.

- **Rejected step submissions are not stored at all.** §6.1 says reject unattested
  submissions silently. Storing them anyway turned out to be exploitable: the stored
  `raw_steps` became the baseline, so re-submitting one step higher collected the full
  capped payout. Rejected samples now leave no trace except a `fraud_events` row.
- **The rate ceiling measures the day's cumulative total against the day's own elapsed
  time**, not the increment since the last sync. Measuring increments meant syncing
  twice in one minute tripped the ceiling, and a rejected figure could be laundered by
  resubmitting it in slices.
- **Money columns are all named `*_pkr` and are all integers.** §5 mixes `subtotal` and
  `total_pkr`; I normalised. No floats anywhere near money.
- **The coin ledger's expiry model.** §5 says balance is `SUM(delta) WHERE expires_at >
  now()`, which is right in spirit but double-subtracts a spend once its batch lapses.
  Every debit now names the batch it draws from, and a row counts only while its batch
  is live. Same idea, exact arithmetic, and no cron in the correctness path.
- **`private` schema for anything a client must never see**, and it is absent from
  PostgREST's exposed schemas in `supabase/config.toml`. That is what keeps
  `COIN_VALUE_PKR` off every device regardless of what a future policy says.

---

## Done

- [x] Repo scaffold, local Postgres test harness that needs no docker (`./scripts/test.sh`).
- [x] §0 margin cap enforced as a database constraint, with 35 assertions proving a
      violating insert is rejected — including the forged-cost and header-inflation
      routes around it.
- [x] Append-only coin ledger with exact expiry, and no balance column anywhere.
- [x] Step ingestion with the full §6.1 anti-fraud set, including §12's rooted-emulator case.
- [x] RLS on every table, `cost_pkr` and `app_config` unreachable from any client role.
- [x] Rewarded video (3/day, server-counted, replay-proof) and referrals paid on the
      referee's first *delivered* order.
- [x] Edge Functions: nonce-bound attestation, step ingestion, AdMob SSV signature
      verification, and the two push jobs. Android attestation is complete; iOS is not
      (see above).
- [x] CI on every push: the full pgTAP suite against a real PostgreSQL 16, plus a Deno
      typecheck and lint of the Edge Functions. (Written and green locally — the
      runner itself is blocked, see the P1 above.)
- [x] Phone OTP sign-in, with the referral code step after first sign-in.
- [x] Teams: create, join by code or deep link, roster, hand over, leave. Friends,
      using the same code people already share for referrals.
- [x] Push token registration (asked after the first coins are minted, not on first
      launch) and background step sync every four hours.
- [x] 30 jest tests over phone normalisation, the offline queue's merge rule, and
      the PKT business day. `npm run check` runs everything in one command.
- [x] ARCHITECTURE.md, for whoever picks this up next.
