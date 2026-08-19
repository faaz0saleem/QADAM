# METRICS — instrumentation, and the decision that actually matters

Two jobs. First, what to track. Second — and this is the important half — **the numbers that decide whether Phase 2 gets built at all.**

Nothing else in this project will tell the human to stop. This document has to.

---

## 1. THE PHASE 1 DECISION

Phase 1 ships steps, streaks, leaderboard and teams, with **no store**. It runs for four weeks with real users. Then we make a call.

The question is not "do people like it." Everyone says they like it. The question is: **does anyone come back without being paid to?**

That question is worth asking properly, because the store cannot fix a retention problem. A store monetises attention that already exists. If people don't open the app in Phase 1, they won't open it in Phase 2 to browse a catalogue for a PKR 90 discount — they'll just have a shop nobody visits, plus inventory, plus signed brands, plus parcels going out.

Phase 1 is the cheapest possible test of the assumption everything else rests on. Run it honestly.

### 1.1 Minimum sample

At least **300 installs**, at least **four full weeks**, all from organic or hand-recruited users. Do not buy installs for this test — bought users behave differently and will give you a false read in whichever direction is least useful.

### 1.2 The gates

| Metric | Green — build the store | Amber — fix and retest | Red — the loop doesn't work |
|---|---|---|---|
| D1 app-open retention | ≥ 35% | 20–35% | < 20% |
| D7 app-open retention | ≥ 18% | 10–18% | < 10% |
| D30 app-open retention | ≥ 8% | 4–8% | < 4% |
| Sessions/week among D7-retained | ≥ 4 | 2–4 | < 2 |
| Median session length | ≥ 40s | 20–40s | < 20s |
| Team join rate | ≥ 25% | 12–25% | < 12% |
| Invites sent per active user | ≥ 0.3 | 0.1–0.3 | < 0.1 |
| Health permission grant rate | ≥ 70% | 50–70% | < 50% |

**Open retention, not install retention.** A step app keeps syncing in the background whether or not anyone looks at it. Background sync is not engagement and cannot be sold against. Count sessions where the app came to the foreground.

### 1.3 How to read it

**Any two reds, or a red on D7: stop and change something structural.** Do not build the store. Do not sign brands. Do not order inventory.

**Team join rate is the one people will be tempted to ignore, and it's the most important number on the table.** It isn't an engagement metric — it's the entire distribution strategy. There is no advertising budget here. If users won't recruit each other, this app has no way to reach anyone, and the quality of the store is irrelevant because nobody will ever see it.

**A short median session with good retention is not automatically bad.** People checking a number daily is a real habit. But it *does* predict a store problem, because someone who spends 15 seconds in the app is not going to browse a catalogue. If sessions are short but retention is strong, the fix is to give the leaderboard and teams more to do before commerce lands.

### 1.4 If it comes back red

Red doesn't mean the idea is dead. It means this particular loop isn't holding people. In order of cost to try:

1. **Change the reward cadence.** Coins accruing invisibly is weak. Try a visible daily target with a mint moment at the end of it.
2. **Make the competition closer.** Global leaderboards demotivate everyone outside the top 50. City and team boards, and matching people into brackets against similar step counts, make winning feel possible.
3. **Change the audience.** University students in one city, recruited by hand, is a very different test from a general launch.
4. **Drop the walking.** The honest option. If the discount is what people want and the steps are friction, you have a discount app, not a step app — and that's a different business you should decide to be in deliberately rather than by drift.

Write down which of these you're testing, and what number would count as success, **before** you start. Deciding what counts as success after you see the data is how projects run for two years without anyone admitting it isn't working.

### 1.5 The second assumption Phase 1 doesn't test

Retention and purchase intent are different things, and Phase 1 only measures the first.

There's an unexamined bet underneath this whole product: that the people who enjoy streaks and leaderboards are the same people who will browse a catalogue and buy. They might not be. Fitness gamification attracts one kind of person; a PKR 180 discount attracts another. If those audiences don't overlap, Phase 1 can pass every gate above and Phase 2 can still fail.

Test it cheaply, inside Phase 1, before building any commerce:

**Put a locked Shop tab in the app from day one.** Real products, real photos, real prices, real coin discounts computed against the user's actual balance — and a "Opening soon" state instead of a buy button. Add an email or WhatsApp capture on each product: "Tell me when this opens."

Then measure:

| Signal | What it tells you |
|---|---|
| Shop tab open rate among weekly actives | Whether the two halves connect at all |
| Products viewed per shop session | Browsing intent vs a single curious tap |
| Notify-me signups per weekly active | The strongest available proxy for purchase intent |
| Which categories get viewed | What to stock first, and which brands to approach |

**Green: 30%+ of weekly actives open the shop, and 8%+ leave a notify-me.** Under 15% open rate is a warning that deserves attention before a single brand is signed.

This costs a few days of work and gives you a ranked list of what to stock and who to call, which makes it worth building even if the numbers come back fine.

---

## 2. EVENT SPEC

Fire these to whatever analytics tool we pick (PostHog self-hosted or Amplitude free tier — decide in `HUMAN_TASKS.md`). Include `user_id`, `session_id`, `platform`, `app_version`, `city` on every event.

### Onboarding
```
first_open
onboarding_step_viewed      { step }
health_permission_prompted
health_permission_granted   { source: 'health_connect' | 'healthkit' }
health_permission_denied
onboarding_completed        { duration_sec }
```

### Core loop
```
app_open                    { days_since_install }
steps_synced                { raw, credited, capped: bool }
coins_minted                { amount, running_balance }
streak_continued            { day_count }
streak_broken               { day_count_lost }
daily_goal_hit              { steps }
```

### Social
```
leaderboard_viewed          { scope: city|team|friends|national, own_rank, own_percentile }
team_created
team_joined                 { via: code|link|search }
team_invite_shared          { channel }
referral_shared             { channel }
referral_converted          { days_since_share }
```

### Commerce (Phase 2)
```
store_opened
product_viewed              { product_id, category, coin_discount_available }
add_to_cart                 { product_id }
checkout_started            { subtotal }
coins_applied               { coins, discount_pkr, pct_of_subtotal }
coins_insufficient_shown    { needed, held }
order_placed                { total, payment_method, discount_pkr }
whatsapp_confirm_sent
whatsapp_confirm_received   { minutes_to_confirm }
order_delivered             { days_in_transit }
order_refused               { coins_burned }
```

### Monetisation
```
rewarded_ad_offered
rewarded_ad_completed       { coins_awarded }
coins_expired               { amount }
expiry_notification_sent    { days_out, amount }
expiry_notification_tapped
```

`coins_insufficient_shown` is easy to skip and worth more than it looks. It tells you exactly how far a real buyer was from the discount they wanted, which is the number that should drive any future tuning of `COIN_VALUE_PKR`.

---

## 3. THE WEEKLY DASHBOARD

One screen. Build it in Phase 1, not Phase 3.

**Health of the loop**
DAU, WAU, DAU/WAU ratio, D1/D7/D30 curves by install cohort, median session length, health permission grant rate.

**Health of the growth engine**
New installs by source, team join rate, invites sent per active user, referral conversion rate, average team size.

**Health of the economy** *(Phase 2)*
Coins minted vs coins redeemed vs coins expired, outstanding coin liability in PKR, liability as a multiple of trailing 30-day gross profit, redemption rate by cohort age.

**Health of the business** *(Phase 2)*
Orders, gross profit from `order_economics`, RTO rate on a 7-day rolling basis, average order value, discount as a percentage of margin, revenue per active user per month.

### 3.1 The two numbers to watch above all others

**RTO rate.** One parcel in five coming back is the national average and it's a margin killer. Watch it weekly from the first order onward, not after it becomes a problem. Target under 12%. If it climbs past 15%, stop expanding the catalogue and fix confirmations first — growth on a broken fulfilment loop just multiplies the losses.

**Coin liability as a multiple of trailing gross profit.** Under 3.0 is comfortable. Above 5.0 means we're issuing coins faster than we're earning the margin to honour them, and the correction — repricing discounts — is the thing users hate most. Adjust early and gently, never late and sharply.

---

## 4. WHAT NOT TO OPTIMISE

Some numbers look like progress and aren't:

- **Installs.** Free to inflate, meaningless without retention behind them.
- **Total steps walked across all users.** A vanity number. It appears in press releases and predicts nothing.
- **Coins minted.** That's a liability, not an achievement.
- **Registered users.** Only DAU and WAU describe a real business.
- **Time in app, if the time is in the steps screen.** Someone staring at a step counter is not closer to buying anything.

If a number can only go up, it isn't telling you anything.
