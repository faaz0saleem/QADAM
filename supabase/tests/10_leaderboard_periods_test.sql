-- ============================================================================
-- README §7.3 — the weekly board resets Monday 00:00 PKT, and there is also an
-- all-time board.
--
-- "A permanent all-time-only board is dead to anyone who joins in month three.
--  Weekly resets mean everyone is always seven days from a win."
--
-- That promise only holds if the weekly board actually forgets last week. This
-- file is about the boundary between the two periods, which nothing else covers.
-- ============================================================================
begin;
select plan(17);

create temporary table t (veteran uuid, newcomer uuid, week_start date);
insert into t (veteran, newcomer, week_start) values (
  tests.new_user(p_city => 'Multan', p_created_at => now() - interval '200 days'),
  tests.new_user(p_city => 'Multan', p_created_at => now() - interval '200 days'),
  public.pkt_week_start(now()));

-- The veteran walked a great deal, but all of it before this Monday.
-- The newcomer has walked a modest amount since.
insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select veteran, week_start - g, 15000, 15000, 150, 'health_connect', true
  from t, generate_series(1, 20) g;

insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select newcomer, week_start, 4000, 4000, 40, 'health_connect', true from t;

select ok(private.rebuild_leaderboards() > 0, 'the leaderboards rebuild');

-- ── the weekly board forgets last week ─────────────────────────────────────
select tests.act_as((select newcomer from t));

select is((select count(*)::int from public.leaderboard('city')), 1,
  'only the person who walked THIS week is on the weekly city board');

select is((select user_id from public.leaderboard('city') limit 1), (select newcomer from t),
  'and it is the newcomer, not the veteran with 300,000 older steps');

select is((select rank from public.my_rank('city')), 1,
  'someone who joined this week can be first — everyone is seven days from a win');

-- ── the all-time board remembers everything ────────────────────────────────
select is((select count(*)::int from public.leaderboard('city', 'all_time')), 2,
  'the all-time board has both of them');

select is((select user_id from public.leaderboard('city', 'all_time') order by rank limit 1),
  (select veteran from t),
  'and there the veteran is first, as twenty days of walking should be');

select is((select rank from public.my_rank('city', 'all_time')), 2,
  'the newcomer is second all-time');

-- ── the boundary itself ────────────────────────────────────────────────────
-- A day on the Monday counts. The Sunday before it does not. This is the whole
-- reset, and it is one date comparison away from being silently wrong.
select is(
  (select steps from public.leaderboard_snap
    where user_id = (select newcomer from t) and scope = 'city'
      and period = public.current_leaderboard_period()),
  4000,
  'steps dated on the Monday itself are inside the week');

insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select newcomer, week_start - 1, 9000, 9000, 90, 'health_connect', true from t;
select ok(private.rebuild_leaderboards() > 0, 'rebuild after adding a Sunday');

select is(
  (select steps from public.leaderboard_snap
    where user_id = (select newcomer from t) and scope = 'city'
      and period = public.current_leaderboard_period()),
  4000,
  'the Sunday before does NOT leak into this week''s total');

select is(
  (select steps from public.leaderboard_snap
    where user_id = (select newcomer from t) and scope = 'city' and period = 'all_time'),
  13000,
  'but it is counted all-time');

-- ── a rebuild is a replacement, not an accumulation ────────────────────────
select ok(private.rebuild_leaderboards() > 0, 'rebuild once more');
select is(
  (select count(*)::int from public.leaderboard_snap
    where user_id = (select newcomer from t) and scope = 'city'
      and period = public.current_leaderboard_period()),
  1,
  'running the rebuild twice leaves one row per user, not two');

-- ── ties ───────────────────────────────────────────────────────────────────
create temporary table tie (a uuid, b uuid);
insert into tie (a, b) values (
  tests.new_user(p_city => 'Quetta'),
  tests.new_user(p_city => 'Quetta'));
select tests.log_day((select a from tie), public.pkt_date(now()), 7777);
select tests.log_day((select b from tie), public.pkt_date(now()), 7777);
select ok(private.rebuild_leaderboards() > 0, 'rebuild with a tie');

select is(
  (select count(distinct rank)::int from public.leaderboard_snap
    where scope = 'city' and scope_key = 'Quetta'
      and period = public.current_leaderboard_period()),
  1,
  'an exact tie shares a rank rather than picking a winner at random');

select is(
  (select count(*)::int from public.leaderboard_snap
    where scope = 'city' and scope_key = 'Quetta'
      and period = public.current_leaderboard_period() and rank = 1),
  2,
  'both tied users are rank 1');

-- ── a user with nothing this week is simply absent, not rank zero ──────────
select tests.act_as((select veteran from t));
select is((select count(*)::int from public.my_rank('city')), 0,
  'someone who has not walked this week has no weekly rank at all');

select * from finish();
rollback;
