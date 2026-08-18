[CLAUDE_CODE_BRIEF.md](https://github.com/user-attachments/files/31200520/CLAUDE_CODE_BRIEF.md)
# QADAM# QADAM — Project Brief for Claude Code

> Paste this whole file into Claude Code as your first message, or save it as `CLAUDE.md` at the repo root so it loads on every session.

Working name: **Qadam** (قدم — "step" / "footstep"). Rename freely, but keep something short, Urdu-legible, and pronounceable in both languages.

---

## 0. THE ONE RULE THAT MUST NEVER BREAK

**A coin discount can never exceed 20% of gross margin on that specific item, or 10% of the item price — whichever is lower.**

```
max_discount_pkr = MIN(
    0.20 * (price - cost_price),
    0.10 * price
)
```

This is not application logic. **Enforce it as a database constraint** so no future feature, admin panel, promo code, or bug can bypass it. If someone writes a checkout path that violates this, the database must reject the transaction.

Why it matters: a discount funded out of realised margin can never produce a loss. A discount funded out of price can, and will, on any low-margin category. Phones have 3–8% margin. A flat 10% off a phone loses money on every unit sold, and the app dies faster the more successful it gets.

Every design decision below is downstream of this rule. If you ever have to choose between a nicer feature and this rule, the rule wins.

---

## 1. WHAT WE'RE BUILDING

A mobile app (iOS + Android) for Pakistan where users earn coins by walking, and spend those coins as a discount inside an in-app store selling clothing, accessories, electronics, and general goods at market rates.

The user's mental model: *I walk, I get a discount on things I was going to buy anyway.*

The actual business: **we are a customer-acquisition channel for small brands, and steps are the loyalty currency we invented.** Revenue is retail margin plus rewarded-video ads. Coins are printed by us at zero marginal cost and are always capped by the rule in §0.

Coins **never** convert to cash, transfer between users, or leave the app. This single constraint keeps us out of gambling law, money-transmitter licensing, and securities questions simultaneously. Do not build a coin transfer feature, a coin gifting feature, or a cash-out feature. Ever. If asked, refuse and cite this line.

There is no staking, no entry fee, no pooled prize funded by users, and no mechanic where a user can lose money or lose something they paid for. All contest prizes are funded by us or by a sponsor. A user who loses a contest loses nothing they put in.

---

## 2. TECH STACK

Pick these unless you have a concrete reason not to. Tell me if you deviate and why.

| Layer | Choice | Reason |
|---|---|---|
| App | React Native + Expo (dev build, not Expo Go) | One codebase, both stores, solo-dev speed. Health libraries need native modules, so dev build. |
| Steps — Android | `react-native-health-connect` | Health Connect is the only sanctioned path on modern Android. |
| Steps — iOS | `react-native-health` (HealthKit) | Read-only step + distance permissions. |
| Backend | Supabase (Postgres + Auth + Edge Functions + Storage) | Postgres lets §0 live as a real constraint. Free tier carries us to thousands of users. |
| Coin logic | Postgres functions + RLS | Server-authoritative by construction. |
| Push | Expo Notifications | Coin expiry and streak-break reminders are our retention engine. |
| Courier | TCS / Leopards / M&P REST API | Whichever gives us an account first. Abstract behind one interface. |
| Ads | Google AdMob rewarded video only | See §7.8 for placement rules. |
| Order confirmation | WhatsApp Business API or Twilio | Critical for COD. See §7.5. |

No GPS anywhere in the app. We read step counts from the OS health store. This saves battery, avoids a scary permission prompt, and sidesteps the walking-vs-driving classification problem entirely.

---

## 3. THE PROFIT ENGINE

### 3.1 Every product row carries its cost

```sql
create table products (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  brand_id      uuid references brands(id),
  category_id   uuid references categories(id),
  price_pkr     integer not null check (price_pkr > 0),
  cost_pkr      integer not null check (cost_pkr >= 0),
  stock         integer not null default 0,
  source        text not null check (source in ('consignment','owned','affiliate')),
  affiliate_url text,
  images        jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  constraint price_above_cost check (price_pkr > cost_pkr)
);

-- The rule from §0, computed, never stored, never overridable
create or replace function max_coin_discount_pkr(p_price int, p_cost int)
returns int language sql immutable as $$
  select greatest(0, least(
    floor(0.20 * (p_price - p_cost))::int,
    floor(0.10 * p_price)::int
  ));
$$;
```

### 3.2 The constraint that makes it unbreakable

```sql
create table order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid not null references products(id),
  qty            integer not null check (qty > 0),
  price_pkr      integer not null,   -- snapshot at purchase
  cost_pkr       integer not null,   -- snapshot at purchase
  discount_pkr   integer not null default 0 check (discount_pkr >= 0),

  constraint discount_within_margin
    check (discount_pkr <= qty * max_coin_discount_pkr(price_pkr, cost_pkr))
);
```

Snapshot `price_pkr` and `cost_pkr` onto the order line at purchase time. If a supplier raises their price next month, historical margin reporting must not silently change.

### 3.3 Every order is provably profitable

```sql
create view order_economics as
select
  o.id,
  sum(oi.qty * oi.price_pkr)                              as revenue_pkr,
  sum(oi.qty * oi.cost_pkr)                               as cogs_pkr,
  sum(oi.discount_pkr)                                    as coin_discount_pkr,
  sum(oi.qty * (oi.price_pkr - oi.cost_pkr) - oi.discount_pkr) as gross_profit_pkr
from orders o join order_items oi on oi.order_id = o.id
group by o.id;
```

`gross_profit_pkr` is structurally incapable of going negative. Build an admin screen that shows this view. If it ever shows a negative number, something has bypassed the constraint and that is a P0 bug.

Note: gross profit is not net profit. Fulfilment eats 13–20% of order value in Pakistan even on a successful delivery, and every failed delivery is a pure loss. That's §7.5.

---

## 4. COIN ECONOMY — SINGLE CONFIG FILE

Put these in one server-side config table that I can edit without a redeploy. Never hardcode them, never let the client see the conversion rate.

```
STEPS_PER_COIN            = 100     # 1,000 steps = 10 coins
DAILY_STEP_CAP            = 15000   # hard ceiling, anti-fraud + budget control
COIN_VALUE_PKR            = 0.03    # 100 coins = PKR 3
COIN_EXPIRY_DAYS          = 90
MIN_ORDER_FOR_COINS_PKR   = 1500
REWARDED_AD_COINS         = 30
REWARDED_AD_DAILY_LIMIT   = 3
REFERRAL_COINS_REFERRER   = 500     # paid on referee's FIRST PURCHASE, not install
REFERRAL_COINS_REFEREE    = 500
STREAK_MULTIPLIER_MAX     = 1.5     # at 30 days
```

**What this produces, and why it's right:**

- A month of solid walking ≈ 3,000 coins ≈ PKR 90
- A full 90 days ≈ 9,000 coins ≈ PKR 270

A week of walking buys nothing. Three months buys a real discount. That is deliberate. The expiry window and the meaningful-discount window are the same window, which means the user who is about to lose their coins is exactly the user who finally has enough to want to spend them. That push notification is our single best reactivation lever — build it in Phase 1.

**Never publish a coin-to-rupee rate in the UI.** Show "1,000 steps = 10 coins" (a promise we keep forever) and show each product's coin discount in coins. Voucher and discount pricing is ours to tune weekly; the *earning* rate is not. Users forgive a discount getting pricier. They leave permanent one-star reviews when the earning rate is cut.

**Never make the coin economy more generous over time in reverse.** Launch stingier than feels good. Loosen as margin allows. Going that direction earns goodwill; the reverse is unrecoverable — it is exactly how the incumbent in this category earned its reputation.

---

## 5. DATA MODEL

```
users            id, phone, name, city, created_at, referred_by, device_hash, status
daily_steps      user_id, date, raw_steps, credited_steps, coins_awarded, source, flags
coin_ledger      id, user_id, delta, reason, expires_at, order_id, created_at
                 -- append-only. Balance is SUM(delta) WHERE expires_at > now().
                 -- Never store a balance column. Ever.
brands           id, name, contact, commission_pct, status
products         (see §3.1)
categories       id, name, parent_id, coin_eligible (bool)
orders           id, user_id, status, subtotal, discount_pkr, shipping_pkr, total_pkr,
                 payment_method, address, phone, confirmed_at, cod_risk_score
order_items      (see §3.2)
teams            id, name, city, captain_id, invite_code
team_members     team_id, user_id, joined_at
challenges       id, title, scope, starts_at, ends_at, prize_type, prize_funded_by
leaderboard_snap user_id, scope, period, steps, rank, computed_at
fraud_events     user_id, kind, detail, created_at
```

`coin_ledger` being append-only is non-negotiable. A balance column will drift, and a drifting balance in a system where coins have value is an exploit waiting to happen. Compute balance from the ledger, cache it in Redis or a materialised view if performance demands it, but the ledger is truth.

---

## 6. ANTI-FRAUD — BUILD THIS BEFORE THE STORE EXISTS

If the store ships before this, the economy is farmed within two weeks and the brands walk. There are two separate fraud problems.

### 6.1 Step fraud

- **Attestation on every step submission.** Play Integrity API (Android), DeviceCheck / App Attest (iOS). Reject unattested submissions silently — don't tell the attacker why.
- **One account per device.** Store a device hash. Flag any device seen on a second account.
- **Rate ceiling.** Reject any interval implying >200 steps/minute. Humans don't.
- **Daily cap.** `DAILY_STEP_CAP` is applied server-side, always.
- **Backfill limits.** Accept at most 48 hours of retroactive step data. Reject anything older.
- **Emulator and root detection.** Flag, don't hard-block — false positives on rooted-but-honest devices are common in this market.
- **New-account velocity.** No coin redemption in the first 7 days of an account's life. This alone kills most farming, because farms need throughput.
- **Server decides everything.** The client reports raw step counts and nothing else. The client never computes coins, never sends a coin value, never sends a balance. If the API accepts a coin amount from the client, that's a P0 bug.

### 6.2 Order fraud — see §7.5

---

## 7. FEATURES

### 7.1 Step tracking

Read from Health Connect / HealthKit on foreground, plus a background fetch every few hours. Show today's steps, today's coins, and the streak. Sync silently and often; never make the user press a "sync" button, but do show last-synced time so failures are visible.

Handle the permission denial path properly — an app that shows a blank screen when health permission is refused loses the user permanently. Show what they're missing and a one-tap route to settings.

### 7.2 Coins & wallet

A ledger view: every credit and debit, with reason and expiry date. Group by expiry batch so "2,400 coins expiring in 11 days" is a visible, dated thing and not a surprise.

### 7.3 Leaderboard

Four scopes, switchable with a segmented control: **City · Team · Friends · All Pakistan**.

Design decisions that matter:

- **Weekly, resetting Monday 00:00 PKT, plus an all-time board.** A permanent all-time-only board is dead to anyone who joins in month three. Weekly resets mean everyone is always seven days from a win.
- **Only attested steps count.** Steps flagged by §6.1 are excluded from ranking but still shown in the user's own total, so a false positive doesn't feel like theft.
- **Always show the user their own rank, pinned.** If they're 4,382nd, show "4,382 — top 12%." Percentile framing keeps mid-table users engaged; a bare rank number does not.
- **Prizes are funded by us or a sponsor. Entry is free. Losers lose nothing.** No pooled user money, ever. Prizes are coins or store vouchers, not cash.
- **Cache aggressively.** Recompute snapshots on a cron every 15 minutes, don't rank on read.

### 7.4 Store

The store must feel like a shop, not a rewards catalogue. This is the single biggest visual differentiator from everything else in this category — the "points catalogue" aesthetic is why incumbents feel cheap.

- Categories, search, filters, real product photography.
- On each product card, show the coin discount available **to this user right now**, given their balance. Not a hypothetical maximum. "Save PKR 180 with your coins" beats "up to 10% off" every time.
- Products in low-margin categories (phones, laptops, branded electronics) stay in the catalogue but §0 caps their discount at roughly 1%. This needs no special-casing and no policy copy — the formula handles it. Don't build a UI that apologises for it.
- Curate hard. Twenty good SKUs beat five thousand dropshipped ones. We cannot out-catalogue Daraz and must not try.

### 7.5 Checkout and the COD problem

This will decide whether the business makes money. Cash on delivery is over 80% of Pakistani e-commerce and isn't optional. The national return-to-origin rate is 18–20% — one parcel in five comes back undelivered, costing shipping both ways with zero revenue.

The industry's own diagnosis of the cause: *the customer has no skin in the game before the product arrives.*

**We have skin in the game. It's called coins.**

Build this rule and make it unmissable at checkout:

> **Spend coins on an order and refuse the delivery, and the coins are gone.**

The user has now committed something they worked three months for, at zero rupee cost to them. That changes door-step behaviour. Implement it as: coins are debited to a `pending` state at order placement, converted to `spent` on delivery confirmation, and **burned** on refusal. Never silently returned.

Stack it with the boring stuff, which matters just as much:

- **WhatsApp confirmation before dispatch.** Automated, with a confirm/cancel button. Do not dispatch an unconfirmed COD order above PKR 3,000.
- **Phone OTP on first order.**
- **A per-customer `cod_risk_score`** that rises with each refusal. Above a threshold, require prepayment or partial advance.
- **Track RTO rate on the admin dashboard as a first-class metric**, next to revenue. Target under 12%.

### 7.6 Teams and challenges

Teams of 5–30 with an invite code. Office vs office, university vs university, neighbourhood vs neighbourhood. Free to join.

This is our growth engine, so treat it as a product, not a feature: one captain recruits twenty people for us. Make creating and sharing a team take under 30 seconds, generate a shareable image card of the team's weekly rank, and make joining work from a deep link without an account (create the account after they're in).

### 7.7 Referrals

Both sides get coins, **paid on the referee's first completed purchase — not on install.** This filters out install farms and is how every referral programme worth copying works. Show pending referrals ("Ali joined — you'll get 500 coins when he makes his first order") so the referrer keeps nudging.

### 7.8 Ads

**Rewarded video only. Zero ads in browse, cart, or checkout.**

One abandoned PKR 2,500 order wipes out months of ad revenue from that user. An interstitial in a shopping flow is a net loss dressed up as revenue. Ads live only in the earning half of the app: "Watch a video, get 30 coins," capped at 3/day.

---

## 8. PRODUCT DATA — READ THIS BEFORE YOU SCRAPE ANYTHING

The plan is to pull product data with Cowork or the browser extension. Split that into what works and what doesn't, because getting this wrong ends the business rather than slowing it down.

**Don't lift catalogues and photos from other retailers.** Product images are owned by the brand or the photographer, competitor terms of service prohibit it, and affiliate accounts get terminated for exactly this. Worse, it's operationally broken: if you scrape a listing you don't stock and someone orders it, you have nothing to ship — and an unfulfilled order in a COD market is a chargeback, a one-star review, and a dead customer.

**Do use automation for these, which are genuinely valuable:**

1. **Price benchmarking.** Scrape current market prices across Daraz and brand sites so we price competitively and so `cost_pkr` vs market price is a real number, not a guess. This is research, not republishing — it never enters the catalogue as content.
2. **Building the brand outreach list.** Scrape Instagram and Facebook for Lahore clothing and accessory brands: handle, follower count, whether they already sell online, contact. This is the single highest-value automation available to us, and it feeds the human task list in §11.
3. **Official affiliate feeds.** Where a merchant publishes a product feed or API for affiliates, ingest it — that's licensed data supplied for this purpose. Tag those rows `source = 'affiliate'` and link out rather than fulfilling ourselves.
4. **Ingesting consignment catalogues.** Brands who sign with us will hand over their own photos and specs, usually as a spreadsheet or a Drive folder. Build a bulk importer that takes a CSV with `title, price, cost, stock, images[]` and validates `price > cost` on every row. This is where the real catalogue comes from.

Build the CSV importer in Phase 2. It's the tool that turns each signed brand from a day of manual data entry into ten minutes.

---

## 9. UI/UX DIRECTION

Do not ship default React Native components with a coat of paint. The brief below is specific — follow it, and where it leaves an axis free, make a real choice rather than reaching for a template.

### 9.1 The concept: a ledger of distance

The app is an account book of ground covered. Steps accrue like entries; coins are minted, not "earned points." The visual language comes from currency and roadside milestones — stamped numerals, ruled lines, struck metal — not from fitness-app neon or e-commerce card grids.

**Two temperatures, one app.** The earning half (steps, streak, leaderboard) is dark, nocturnal, dense with numbers. The spending half (store, checkout) is light, airy, product-forward. The transition between them is the most important moment in the app: it should feel like stepping indoors. This is the structural idea — hold it consistently.

### 9.2 Tokens

```
--ink            #101828   /* earning surfaces, base */
--ink-raised     #1B2437   /* cards on dark */
--brass          #C8952E   /* the coin. used ONLY for coin values. never decorative */
--signal         #3E9E75   /* goal met, delivery confirmed */
--clay           #C0563F   /* streak broken, coins expiring, order refused */
--paper          #FAF8F4   /* store surfaces, base */
--paper-line     #E4DFD6   /* ledger rules, dividers */
--graphite       #4A5468   /* secondary text on paper */
```

Brass is reserved. The moment it appears on a button that isn't about coins, the coin stops feeling like currency.

### 9.3 Type

- **Display:** a characterful grotesque with real width contrast — Familjen Grotesk or Bricolage Grotesque. Used for screen titles and the step count only.
- **Body:** Inter. Neutral, boring, correct at 13–15px.
- **Data:** a monospace with **tabular figures** — JetBrains Mono or Roboto Mono. Non-negotiable for the step counter, coin balance, prices, and leaderboard ranks. Proportional numerals jitter when they tick, and a jittering counter is the difference between "polished" and "hobby project."
- **Urdu:** Noto Nastaliq Urdu, full RTL support, language toggle in settings. Ship bilingual from day one — this is a Pakistani product, and an English-only launch cuts the addressable market in half.

### 9.4 Layout

Five bottom tabs: **Steps · Board · Shop · Wallet · You**

The coin balance is pinned in the header on every single screen, in brass, in tabular figures. It is the hook, and it should never be more than one glance away.

Home screen hierarchy, top to bottom:
1. Today's step count — very large, monospace, ticking
2. A horizontal progress rule toward the daily cap (a ruled ledger line filling, **not** a circular ring — everyone ships a ring)
3. Today's coins, in brass, counting up
4. Streak, with days-remaining pressure if it's at risk
5. One contextual card: expiring coins, team rank, or an unclaimed reward — whichever is most urgent. Never more than one.

### 9.5 The signature moment

**Minting.** When a step threshold is crossed, the coin counter increments with a struck-metal micro-animation and a short haptic tap. Roughly 400ms, once per 1,000 steps, never more often. This is the dopamine beat of the entire app and the one place to spend real animation effort.

Everything else stays quiet: 150–200ms ease-out transitions, no parallax, no scattered micro-interactions. Respect `prefers-reduced-motion` — replace the mint animation with a simple value change, keep the haptic.

### 9.6 Copy

Sentence case, plain verbs, active voice. An action keeps its name through the whole flow: a button that says "Use coins" produces a confirmation that says "Coins used."

Empty states are invitations, not apologies. Empty wallet: "Walk 1,000 steps to mint your first coins." Not "You have no coins yet."

Errors say what happened and what to do. "Health permission is off, so today's steps aren't counting. Turn it on →" Not "An error occurred."

Never use the words points, rewards, cashback, or earn money. We say **coins**, **mint**, **discount**.

### 9.7 Quality floor, unannounced

Keyboard focus visible, screen-reader labels on every interactive element, tap targets ≥44px, works at 320px width, works on a three-year-old mid-range Android, works offline for the steps screen (queue submissions, sync later). Test on a cheap Android device, not just a simulator — that's the actual hardware this market runs.

---

## 10. BUILD PHASES

Do not build these in the order they're fun. Ship each phase to TestFlight / internal testing before starting the next.

**Phase 0 — Foundations (week 1)**
Repo, Supabase project, schema from §5, the §0 constraint with tests that prove it rejects a violating insert. Write those tests first.

**Phase 1 — The earning app, no store at all (weeks 2–4)**
Step ingestion, coin ledger, full anti-fraud from §6.1, streaks, all four leaderboard scopes, teams, expiry notifications, the complete §9 design system.

**Ship this and stop.** Give it four weeks with real users and no store. If people won't return daily for a streak and a leaderboard, they will not return for a PKR 90 discount, and we need to know that before a single brand is signed or a single parcel ships. This is the cheapest possible test of the riskiest assumption.

**Phase 2 — Commerce (weeks 5–8)**
Catalogue, CSV importer, product pages, cart, checkout with the margin cap, COD flow with WhatsApp confirmation and coin-burn-on-refusal, courier integration, order tracking, admin dashboard showing `order_economics` and RTO rate.

**Phase 3 — Growth (weeks 9–10)**
Referrals paid on first purchase, sponsored challenges, shareable team cards, rewarded video.

**Phase 4 — Store submission**
Apple: health data disclosure, no health data used for advertising, App Privacy labels filled honestly. Google: Health Connect declaration form, data safety section. Budget two weeks for review round-trips on the first submission — it always takes longer than expected.

---

## 11. WHAT I NEED FROM YOU (the human)

Maintain a file at the repo root called `HUMAN_TASKS.md`. Whenever you hit something you cannot do yourself — an account, a credential, a decision, a real-world action — append it there with a priority and a blocking flag, and mention it in your next message rather than sitting blocked.

Format each entry like this:

```md
- [ ] **P1 · BLOCKING** — Create Supabase project, paste URL + anon key into `.env.local`
      Why: nothing runs without it
      How: supabase.com → New project → Settings → API
```

Seed it now with everything you already know I'll need. Off the top, that includes Apple Developer and Google Play accounts, the Supabase project, AdMob setup, a courier account, WhatsApp Business API access, a domain, and a privacy policy URL — but you'll know the full list better than I do once you've read this brief, so write it out properly.

Keep it current. Move finished items to a `## Done` section rather than deleting them, so I can see what we've already handled.

---

## 12. DEFINITION OF DONE FOR v0

Ship when all of these are true:

- [ ] A violating discount is rejected by the database, proven by a passing test
- [ ] Steps sync on both platforms, survive app restart, and queue while offline
- [ ] A rooted emulator submitting 500,000 steps earns zero coins
- [ ] The leaderboard shows correct ranks across all four scopes and refreshes on schedule
- [ ] Coins expire correctly and the 7-days-out push notification fires
- [ ] The full UI matches §9 — dark earning half, light shop half, tabular figures throughout
- [ ] Urdu renders correctly RTL on every screen
- [ ] It runs acceptably on a mid-range Android from three years ago
- [ ] `HUMAN_TASKS.md` is current

---

## 13. STANDING RULES FOR THIS PROJECT

1. §0 wins over every other consideration, always.
2. Never accept a coin value, balance, or discount amount from the client.
3. Never add coin transfer, coin gifting, or cash-out.
4. Never add a mechanic where a user stakes money or can lose something they paid for.
5. Never put an ad in the shopping flow.
6. Never cut the coin earning rate after launch. Tune discounts instead.
7. When you're unsure whether something breaks §0, stop and ask me rather than guessing.
