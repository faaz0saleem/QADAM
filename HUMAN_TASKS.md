# What I need from you

Things I cannot do myself: accounts, credentials, money, signatures, and
decisions that are yours to make. Ordered by when they block work, not by size.

Priorities: **P0** stops everything · **P1** blocks the next phase · **P2** needed
before launch · **P3** needed before it matters at scale.

Finished items move to [Done](#done) rather than being deleted.

---

## Blocking right now

- [ ] **P0 · BLOCKING** — Create the Supabase project and put its keys in `.env.local`
      Why: the schema, the coin ledger and every test currently run only against a
      local Postgres. Nothing reaches a phone until there is a hosted database.
      How: supabase.com → New project (region **Singapore** — closest to Pakistan,
      ~60ms vs ~180ms from Frankfurt) → Settings → API. Copy `URL`, `anon` key and
      `service_role` key into `.env.local` (see `.env.example`).
      Then: `supabase link --project-ref <ref> && supabase db push`
      ⚠️ The `service_role` key bypasses every RLS policy in `20260818001000_rls.sql`.
      It belongs in Edge Function secrets and nowhere else — never in the app bundle.

- [ ] **P1 · BLOCKING** — Decide the name
      Why: it fixes the bundle identifier, the domain, the store listing and the
      app icon, and changing it after the first store submission is genuinely
      painful.
      Qadam (قدم) is the working name and I think it holds up: two syllables,
      reads correctly in both scripts, and means the thing the app is about. The
      brief says rename freely — if you want to, now is nearly free and in three
      weeks it is not.

- [ ] **P1** — Confirm the streak bar: how many steps make a day "count"?
      Why: §4 sets `STREAK_MULTIPLIER_MAX` but never says what earns a streak day.
      I defaulted to **5,000 credited steps** (`app_config.STREAK_QUALIFYING_STEPS`).
      Judgement: 5,000 is roughly a normal day's incidental walking in a Pakistani
      city, so most engaged users keep a streak without changing their behaviour,
      and the multiplier rewards consistency rather than athleticism. Raise it to
      7,500 if streaks feel too easy to hold once there is real data.

---

## Accounts and credentials

- [ ] **P1** — Apple Developer Program — USD 99/year
      Why: no TestFlight build, no Phase 1 ship. Enrolment can take days if Apple
      asks for a D-U-N-S number, so start it before you need it.
      How: developer.apple.com/programs. An **Organization** enrolment needs a
      D-U-N-S number (free, ~1–2 weeks); an **Individual** enrolment does not and
      can be switched later.

- [ ] **P1** — Google Play Console — USD 25 one-off
      Why: same, for internal testing on Android — which is the platform that
      actually matters here.
      How: play.google.com/console. New personal/organisation accounts now face an
      identity check and, for personal accounts, a 12-tester/14-day closed-test
      requirement before production. Budget for it; it does not block internal
      testing.

- [ ] **P1** — Expo / EAS account
      Why: §2 calls for a dev build, not Expo Go, because the health libraries are
      native modules. EAS Build is the path of least resistance.
      How: expo.dev → sign up → `eas login`. The free tier is enough to start.

- [ ] **P2** — AdMob account and two rewarded-video ad unit IDs (iOS + Android)
      Why: §7.8's rewarded video is half the revenue model.
      How: admob.google.com → add both apps → create one **rewarded** unit each.
      Not interstitial, not banner — §7.8 and §13.5 forbid ads anywhere in the
      shopping flow, and the code should have no unit ID that could land there.
      Needs an AdSense-linked payment profile before it pays out.

- [ ] **P2** — WhatsApp Business API access (or Twilio as the fallback)
      Why: §7.5's pre-dispatch confirmation is the single cheapest lever on the
      18–20% RTO rate. The database already refuses to dispatch an unconfirmed COD
      order above PKR 3,000, so without this, orders will pile up unshipped.
      How: Meta Business Manager → WhatsApp → or a BSP (360dialog and Twilio are
      both straightforward in Pakistan). You will need a verified business and a
      dedicated number. Utility templates must be submitted and approved before
      first send — allow a week.

- [ ] **P2** — A courier account: TCS, Leopards or M&P
      Why: nothing ships without one. §2 says whichever gives us an account
      first — the integration sits behind one interface either way.
      How: all three want a business bank account and an NTN. Ask each for: COD
      remittance cycle (weekly vs fortnightly — this is working capital), RTO
      charge on a failed delivery, and whether they give an API on a small volume
      account or only a dashboard.
      ⚠️ Get the RTO charge in writing. At 18–20% national RTO it is the number
      that decides whether the unit economics work.

- [ ] **P2** — Domain + a privacy policy at a stable URL
      Why: both stores refuse a submission without a reachable privacy policy URL,
      and Health Connect's declaration form asks for it specifically.
      How: a `.pk` needs local documentation; a `.com` or `.app` takes minutes.
      I can draft the policy text — it has to state plainly that step data is read
      from the OS health store, never sold, never used for advertising, and never
      leaves the app except as an aggregate step count.

---

## Decisions only you can make

- [ ] **P1** — The first ten SKUs, and what we pay for them
      Why: `products.cost_pkr` is not decoration — it is the input to §0. A guessed
      cost produces a guessed discount ceiling and a real loss.
      What I need per product: title, our buying price, our selling price, stock on
      hand, and photos we are licensed to use. The CSV importer in Phase 2 takes
      exactly this.

- [ ] **P2** — Consignment vs owned stock, and the commission split
      Why: `brands.commission_pct` and `products.source` exist for this, and the
      answer changes the working-capital picture completely. Consignment means we
      hold no cash in inventory but carry the fulfilment risk.

- [ ] **P2** — Who answers the WhatsApp confirmations, and when
      Why: §7.5's flow is automated but not autonomous — a customer who replies
      "can you deliver Friday instead" needs a human. An unanswered confirmation
      is an RTO.

- [ ] **P3** — Shipping charge policy
      Why: `orders.shipping_pkr` is in the schema and currently always 0. Free
      shipping above a threshold is the usual play here, and the threshold
      interacts with `MIN_ORDER_FOR_COINS_PKR`.

---

## Before the first store submission (Phase 4)

- [ ] **P2** — Google Health Connect declaration form
      Why: reading step data without an approved declaration gets the app removed.
      How: Play Console → App content → Health apps declaration. State read-only
      access to Steps, the in-app use, and confirm no advertising use. Review takes
      days to weeks — file it as soon as there is a build, not when you are ready
      to launch.

- [ ] **P2** — Apple health data disclosure + App Privacy labels
      Why: HealthKit apps get an extra review pass. Apple rejects apps that read
      health data without a clear in-app explanation of why.
      ⚠️ Apple's HealthKit terms forbid using health data for advertising or
      selling it to data brokers. Our rewarded video shows an ad *next to* a step
      count; it must never *target* on one. Keep AdMob's user-data signals off.

- [ ] **P2** — A cheap real Android phone for testing
      Why: §9.7 and §12 both call for it. A three-year-old mid-range device is what
      this market runs, and it is the only way to find out that the mint animation
      janks or that Nastaliq wraps wrongly.
      Suggested: anything in the PKR 25–35k bracket with 3–4 GB of RAM. A simulator
      will not surface either problem.

- [ ] **P3** — Urdu proofread by a native reader
      Why: §12 requires Urdu to render correctly RTL on every screen. I can produce
      the strings and the layout; I cannot judge whether the register is right.
      Machine-translated Urdu in a consumer app reads as foreign immediately.

---

## Operational, once there are users

- [ ] **P2** — Schedule the two cron jobs in Supabase
      Why: leaderboards go stale and expiry notifications never fire without them.
      How: Supabase Dashboard → Database → Cron (pg_cron), or the SQL in
      `supabase/cron.sql`:
      - `select refresh_leaderboards();` every 15 minutes (§7.3)
      - the expiry-notification sweep daily at 09:00 PKT (§4, §7.2)

- [ ] **P1** — Play Integrity and DeviceCheck credentials
      Why: **nobody earns a single coin on a hosted project until these exist.**
      The `ingest-steps` Edge Function verifies every submission and fails
      closed, so an unverifiable token earns zero — which is what §6 asks for,
      and also means a fresh Supabase project looks broken until this is done.
      How, Android: Google Cloud → the project linked to Play Console → enable
      the Play Integrity API → create a service account → download the JSON key.
      Set `ANDROID_PACKAGE_NAME`, `GOOGLE_SA_CLIENT_EMAIL`, `GOOGLE_SA_PRIVATE_KEY`.
      How, iOS: Apple Developer → Certificates, Identifiers & Profiles → Keys →
      new key with DeviceCheck enabled → download the `.p8` (once only).
      Set `APPLE_TEAM_ID`, `APPLE_DEVICECHECK_KEY_ID`, `APPLE_DEVICECHECK_PRIVATE_KEY`.
      Then: `supabase functions deploy ingest-steps` and `supabase secrets set ...`
      — see `supabase/functions/README.md`.

- [ ] **P1** — Choose and wire the client-side integrity library
      Why: the server side is finished; the app currently sends no token, so it
      mints nothing. `src/lib/attest/index.ts` is the boundary — implement
      `IntegrityProvider` against whichever library you pick and call
      `setIntegrityProvider` at startup.
      Why I did not pick one: this needs a native module in a dev build, and
      choosing between the options without being able to run one on a device
      would be guessing. Worth ten minutes with the dev build in front of you.

- [ ] **P2 · SECURITY** — Confirm `ALLOW_UNATTESTED` is unset on production
      Why: it is a development escape hatch in `ingest-steps` that treats every
      submission as attested. Without it nothing can be built against a hosted
      project before the keys above exist; with it, the economy is farmable.
      It is a server secret, so no client can turn it on, and every use writes a
      `fraud_events` row marked `dev_bypass: true` — so you can check with:
      `select count(*) from fraud_events where detail->>'dev_bypass' = 'true';`
      ⚠️ Set it on the dev project only. Delete it the day the real keys land.

- [ ] **P3** — A payment gateway, if you ever want prepaid orders
      Why: §7.5's `cod_risk_score` is designed to push repeat refusers to
      prepayment, and there is currently nothing to push them to.
      Options here: JazzCash and Easypaisa cover the most wallets; Safepay handles
      cards. Not urgent while COD is 80%+ of the market.

---

## Done

_Nothing yet — this file was seeded when the schema landed._
