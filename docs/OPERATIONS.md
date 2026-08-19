# OPERATIONS — the half that isn't code

Everything in the other documents assumes the app can ship, take money, and be supported. None of that is automatic. This file covers the parts that will block a launch at the last minute if nobody starts them early.

Read §1 before writing any iOS code.

---

## 1. THE APP STORE RISK THAT COULD BLOCK THE iOS LAUNCH

This is the most serious non-technical risk in the project, and it is not hypothetical.

Apple rejects apps under **Guideline 5.1.2(i)** with this exact wording:

> *The primary purpose of the app is to encourage users to perform digital tasks in exchange for compensation, watch ads and/or perform other marketing-oriented tasks, which is not appropriate.*

Read that against what we're building. Walk → mint coins → watch rewarded video for more coins → redeem for shopping discounts. Described badly, that is precisely the pattern in the rejection notice, and the rewarded video is the single most incriminating element.

There are two further guidelines pointing the same direction:

- **5.1.3(i)** prohibits using health, fitness and motion data — HealthKit and the Motion & Fitness APIs both named explicitly — for advertising, marketing, or use-based data mining purposes other than improving health management. A discount programme driven by step data is arguable either way, and "arguable" means it depends which reviewer we get.
- **2.5.1** rejects apps that use HealthKit without clearly identifying the HealthKit functionality in the interface. Developers report bouncing off this repeatedly even after adding permission prompts and onboarding copy.

Apps like this do exist on the App Store, so it is clearly passable. But passing depends almost entirely on framing.

### 1.1 Recommendation: ship Android only for v1

Pakistan's smartphone market is overwhelmingly Android. Building iOS in v1 buys us a few percent of the market in exchange for the entire risk described above, plus HealthKit work, plus a review process that could take weeks of round-trips.

**Ship Android first. Add iOS after the model is proven and we can afford a proper health-first rebuild of the framing.**

Keep React Native so iOS stays cheap later, but do not write HealthKit code, do not open an Apple Developer account, and do not spend a single day on iOS review until Phase 2 has real orders. If we accept this, update `CLAUDE.md` §2 and §10 Phase 4 accordingly.

### 1.2 If and when we do submit to iOS

- **Make it a genuine fitness app with a rewards feature, not a rewards app wearing fitness as a costume.** Real weekly trends, real goals, real activity insights. This must be true in the product, not just in the App Store description, because the reviewer opens the app.
- **Drop rewarded video on iOS, or bury it.** "Watch ads for compensation" is the exact phrase in the rejection. The revenue it earns is not worth the review risk.
- **Identify HealthKit functionality visibly in the UI**, per 2.5.1.
- **Evaluate Core Motion (`CMPedometer`) instead of HealthKit.** It reads step counts without HealthKit's additional UI obligations. Still covered by 5.1.3's Motion & Fitness clause, so it doesn't remove the framing risk, but it removes the 2.5.1 one.
- **In-app account deletion is mandatory** for any app with account creation. Build it in Phase 1 regardless of platform — Google requires it too.
- Describe every feature specifically in the Notes for Review. Generic descriptions get rejected on their own.

### 1.3 Google Play

Reading step data via Health Connect requires a **declaration form and approval**, separate from normal review. It can be rejected, and it takes time. **Start this in week one**, before the app is finished. It is the single most likely thing to be sitting unapproved when everything else is ready.

---

## 2. THE MONEY PLUMBING

Cash on delivery means **the courier collects the cash and remits it to us**, typically weekly, minus their fee and any COD handling charge. This has consequences the code cannot solve.

- **Couriers require a registered business.** TCS, Leopards and M&P will not open a merchant account for an individual with a personal bank account.
- So we need, in this order: a registered sole proprietorship (or company), an **NTN** from FBR, and a **current account in the business name**.
- This takes weeks and involves offices. **Start it now, in parallel with Phase 1** — not when the store is ready. It is the classic thing that blocks a finished product for a month.
- Check whether e-commerce sales tax registration applies at our expected volume. Ask an accountant once, early, rather than guessing and correcting later.

Add each of these to `HUMAN_TASKS.md` as **P1 · BLOCKING for Phase 2** the moment this file is read.

---

## 3. BRAND AGREEMENTS

Every consignment brand needs a signed one-page agreement before their products go in the catalogue. Not for the lawsuit — for the argument in month three about who eats a parcel the courier lost.

It must state:

- **Who owns the stock** (they do, until it's delivered)
- **Who bears loss in transit** (agree this explicitly; usually shared or insured)
- **Payment terms** — e.g. remitted within 7 days of confirmed delivery
- **Who sets the retail price** (we do, within a floor they set)
- **What `cost_pkr` is**, and that it's confidential
- **Returns handling** — who receives, who refunds, who pays return shipping
- **No exclusivity in either direction**
- **Either side can exit with 30 days' notice**

Keep it to one page in plain language. A signed one-pager beats an unsigned five-pager, and beats a handshake by a very large margin.

---

## 4. SUPPORT

Nobody has planned for this and it will consume real hours.

At 100 orders a month, expect roughly 30 support conversations. Three issues will be almost all of them:

1. **"Where is my parcel?"** — solved mostly by proactive status pushes
2. **"Why didn't my coins apply?"** — solved by the wallet screen being genuinely readable, and by `coins_insufficient_shown` telling us where the confusion is
3. **"I want to return this"** — needs a written policy before the first order ships, not after the first request

One WhatsApp Business number, saved replies for the top ten questions, and a response-time commitment we can actually keep. A returns policy published in the app, in both languages, before Phase 2 launches.

---

## 5. BACKUPS AND SECURITY

Unglamorous and non-negotiable once real coin balances exist:

- **Daily automated database backups, with a restore you have actually tested.** An untested backup is a hope, not a backup.
- **No secrets in git, ever.** `.env` in `.gitignore` from the first commit, and check it's there before the first push rather than after.
- Service-role keys never ship in the client bundle. RLS on every table by default; open specific policies deliberately.
- Two-factor on the Supabase account, the Play Console, the domain registrar, and the business bank account.
- A written note of every credential's location, kept somewhere that isn't only in one person's head.

---

## 6. THE HONEST PART

This project is four businesses stacked on top of each other: a fitness app, an e-commerce store, a fulfilment operation, and a B2B sales job signing brands. Each of those is normally somebody's full-time role.

That isn't an argument against doing it. It is an argument for the sequencing already in `CLAUDE.md` §10, and for treating that sequencing as protection rather than delay:

- **Phase 1 is one business.** A step app. Nothing else.
- **The Phase 1 gates in `docs/METRICS.md` are the only thing standing between a focused product and four simultaneous half-built ones.** If they come back red, the correct response is to fix the loop, not to add commerce on top of a loop that doesn't hold people.
- **Do not sign a single brand or buy a single unit of stock before Phase 1 passes.** Sales conversations and inventory are the point where this stops being reversible.

The most likely failure mode here is not a bug and not a bad idea. It's building all four at once, running out of energy at 60% on each, and having nothing shippable. The gates exist to prevent exactly that, which is why the number that matters most in this entire project is a retention figure measured on an app that doesn't sell anything yet.
