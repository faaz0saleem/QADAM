-- ============================================================================
-- README §6.1 — anti-fraud, and §7.1 — step ingestion.
--
-- "Build this before the store exists. If the store ships before this, the economy
--  is farmed within two weeks and the brands walk."
--
-- The §12 definition of done for this area is one line: a rooted emulator
-- submitting 500,000 steps earns zero coins. That is the last test in this file.
-- ============================================================================
begin;
select plan(43);

-- ── the signature is the first line of defence (§13.2) ─────────────────────
-- "Never accept a coin value, balance, or discount amount from the client."
-- If this ever fails, someone has added a parameter that must not exist.
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(arg)
    where n.nspname = 'public'
      and p.proname in ('submit_steps','claim_rewarded_ad')
      and (a.arg ilike '%coin%' or a.arg ilike '%balance%' or a.arg ilike '%discount%')),
  0,
  'no client-facing earning RPC takes a coin, balance or discount argument (§13.2)');

select has_table('public', 'daily_steps',  'daily_steps exists');
select has_table('public', 'fraud_events', 'fraud_events exists');

-- Fixtures. Every earning assertion uses YESTERDAY so the rate-ceiling window is
-- a whole 24h day and the results do not depend on what time the suite runs.
create temporary table t (u uuid, u2 uuid, y date, today date);
insert into t (u, u2, y, today) values (
  tests.new_user(p_created_at => now() - interval '120 days'),
  tests.new_user(p_created_at => now() - interval '120 days'),
  public.pkt_date(now()) - 1,
  public.pkt_date(now()));

create or replace function tests.submit(p_user uuid, p_date date, p_steps int,
                                        p_attested boolean default true,
                                        p_device text default null,
                                        p_flags jsonb default '{}'::jsonb)
returns jsonb language sql as $$
  select public.submit_steps(
    p_user,
    jsonb_build_array(jsonb_build_object('date', p_date, 'raw_steps', p_steps)),
    'health_connect', p_device, p_attested, p_flags)
$$;

-- ── the honest path ────────────────────────────────────────────────────────
select is(
  (tests.submit((select u from t), (select y from t), 10000) #>> '{days,0,coins_awarded}')::int,
  100,
  '10,000 steps mints 100 coins — the 1,000 steps = 10 coins promise (§4)');

select is(public.coin_balance((select u from t)), 100, 'the coins are in the ledger, not a column');

select is(
  (select credited_steps from public.daily_steps where user_id = (select u from t) and date = (select y from t)),
  10000, 'credited steps match what was submitted');

-- Re-syncing the same day tops up rather than paying twice.
select is(
  (tests.submit((select u from t), (select y from t), 10000) #>> '{days,0,coins_awarded}')::int,
  100, 'submitting the same total again awards nothing further');
select is(public.coin_balance((select u from t)), 100, 'and the balance has not moved');

select is(
  (tests.submit((select u from t), (select y from t), 12000) #>> '{days,0,coins_awarded}')::int,
  120, 'walking 2,000 more mints 20 more coins');
select is(public.coin_balance((select u from t)), 120, 'balance tops up to 120');

-- ── §6.1 daily cap, applied server-side, always ────────────────────────────
select is(
  (tests.submit((select u2 from t), (select y from t), 100000) #>> '{days,0,credited_steps}')::int,
  15000, '100,000 steps credits only DAILY_STEP_CAP (15,000)');
select is(public.coin_balance((select u2 from t)), 150, 'and pays only 150 coins');
select is(
  (tests.submit((select u2 from t), (select y from t), 140000) #>> '{days,0,coins_awarded}')::int,
  150, 'walking further past the cap earns nothing more');
select ok(
  (select 'capped' = any(flags) from public.daily_steps
    where user_id = (select u2 from t) and date = (select y from t)),
  'the day is flagged as capped');

-- ── §6.1 attestation: reject silently ──────────────────────────────────────
create temporary table a (u uuid);
insert into a (u) values (tests.new_user(p_created_at => now() - interval '120 days'));

select is(
  (tests.submit((select u from a), (select y from t), 9000, p_attested => false)
     #>> '{days,0,coins_awarded}')::int,
  0, 'an unattested submission earns nothing');
select is(public.coin_balance((select u from a)), 0, 'and mints no coins');
select is(
  (select count(*)::int from public.daily_steps where user_id = (select u from a)),
  0, 'and is not stored at all — so it cannot inflate a later attested submission');
select is(
  (select count(*)::int from public.fraud_events
    where user_id = (select u from a) and kind = 'unattested'),
  1, 'but it is recorded as a fraud event');

-- The response shape must not betray which control fired.
select is(
  (select jsonb_object_keys(x) from jsonb_array_elements(
     tests.submit((select u from a), (select y from t), 9000, p_attested => false) -> 'days') as e(x)
   order by 1 limit 1),
  'capped',
  'a rejected submission returns the same keys as an accepted one');

-- The hole this closes: reject, then re-submit one step higher.
select is(
  (tests.submit((select u from a), (select y from t), 9001, p_attested => true)
     #>> '{days,0,credited_steps}')::int,
  9001, 'a later attested submission is credited on its own merits');
select is(public.coin_balance((select u from a)), 90,
  'it pays for 9,001 steps, not for the 9,000 that were thrown away');

-- ── §6.1 rate ceiling: >200 steps/minute is not walking ────────────────────
create temporary table r (u uuid);
insert into r (u) values (tests.new_user(p_created_at => now() - interval '120 days'));

-- A whole day at 200/min is 288,000 steps. Just over that must be refused.
select is(
  (tests.submit((select u from r), (select y from t), 300000) #>> '{days,0,credited_steps}')::int,
  0, '300,000 steps in one day exceeds 200/minute and is refused');
select is(
  (select count(*)::int from public.fraud_events
    where user_id = (select u from r) and kind = 'rate_ceiling'),
  1, 'the rate ceiling is recorded');
select is(public.coin_balance((select u from r)), 0, 'and it earns nothing');
select is(
  (select count(*)::int from public.daily_steps where user_id = (select u from r)),
  0, 'the inflated figure is never stored');

-- And the same trick one step at a time still gets nowhere.
select is(
  (tests.submit((select u from r), (select y from t), 300001) #>> '{days,0,credited_steps}')::int,
  0, 'resubmitting one step higher does not launder the rejected total');

select is(
  (tests.submit((select u from r), (select y from t), 20000) #>> '{days,0,credited_steps}')::int,
  15000, 'a plausible figure for the same day is accepted and capped');

-- ── §6.1 backfill window: at most 48 hours retroactive ─────────────────────
select is(
  (tests.submit((select u from t), (select y from t) - 10, 8000) #>> '{days,0,credited_steps}')::int,
  0, 'step data from 11 days ago is refused');
select is(
  (select count(*)::int from public.fraud_events
    where user_id = (select u from t) and kind = 'backfill_window'),
  1, 'the backfill breach is recorded');

select is(
  (tests.submit((select u from t), (select today from t) + 1, 8000) #>> '{days,0,credited_steps}')::int,
  0, 'a future date is refused');
select is(
  (select count(*)::int from public.fraud_events
    where user_id = (select u from t) and kind = 'future_date'),
  1, 'the future date is recorded');

-- ── §6.1 one account per device ────────────────────────────────────────────
create temporary table d (u1 uuid, u2 uuid);
insert into d (u1, u2) values (
  tests.new_user(p_created_at => now() - interval '120 days'),
  tests.new_user(p_created_at => now() - interval '120 days'));

select lives_ok($$ select tests.submit((select u1 from d), public.pkt_date(now()) - 1, 6000,
                                       p_device => 'device-abc') $$,
  'the first account on a device submits normally');
select is(
  (select count(*)::int from public.fraud_events where kind = 'device_shared'), 0,
  'one account on one device raises nothing');

select lives_ok($$ select tests.submit((select u2 from d), public.pkt_date(now()) - 1, 6000,
                                       p_device => 'device-abc') $$,
  'a second account on the same device still submits');
select is(
  (select count(*)::int from public.fraud_events
    where user_id = (select u2 from d) and kind = 'device_shared'), 1,
  'but the shared device is flagged (§6.1: flag, do not block — shared handsets are normal)');
select ok(public.coin_balance((select u2 from d)) > 0,
  'and the second account still earns — a flag is not a punishment');

-- ── streak multiplier (§4) ─────────────────────────────────────────────────
create temporary table s (u uuid);
insert into s (u) values (tests.new_user(p_created_at => now() - interval '120 days'));
-- 30 qualifying days ending the day before yesterday.
insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select (select u from s), (select y from t) - g, 9000, 9000, 90, 'health_connect', true
  from generate_series(1, 30) g;

select is(public.streak_days((select u from s), (select y from t) - 1), 30,
  'a 30-day unbroken run reads as a 30-day streak');
select is(round(public.streak_multiplier(30), 4), 1.5000::numeric, 'which is the maximum 1.5x multiplier');
select is(round(public.streak_multiplier(0), 4), 1.0000::numeric, 'a cold start earns 1.0x');
select is(round(public.streak_multiplier(15), 4), 1.2500::numeric, 'and it ramps linearly — 15 days is 1.25x');

select is(
  (tests.submit((select u from s), (select y from t), 10000) #>> '{days,0,coins_awarded}')::int,
  150,
  '10,000 steps on a 30-day streak mints 150 coins, not 100');

-- ── §12 DEFINITION OF DONE ─────────────────────────────────────────────────
-- "A rooted emulator submitting 500,000 steps earns zero coins."
create temporary table dod (u uuid);
insert into dod (u) values (tests.new_user(p_created_at => now() - interval '120 days'));

select is(
  (tests.submit((select u from dod), (select y from t), 500000,
                p_attested => false,
                p_device   => 'emulator-1',
                p_flags    => '{"rooted":true,"emulator":true}'::jsonb)
    #>> '{days,0,coins_awarded}')::int,
  0,
  '§12: a rooted emulator submitting 500,000 steps earns zero coins');

select is(public.coin_balance((select u from dod)), 0, 'and its balance stays at zero');

select * from finish();
rollback;
