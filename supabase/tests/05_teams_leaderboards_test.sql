-- ============================================================================
-- README §7.3 leaderboards, §7.6 teams, and §13.4 — no user ever stakes anything.
-- ============================================================================
begin;
select plan(29);

-- ── §13.4, structurally ────────────────────────────────────────────────────
-- "Never add a mechanic where a user stakes money or can lose something they
--  paid for." A pooled prize needs somewhere to pool. There is nowhere.
select is(
  (select string_agg(table_name || '.' || column_name, ', ')
     from information_schema.columns
    where table_schema in ('public','private')
      and (column_name ~ '(^|_)(fee|stake|wager|entry_cost|buyin|pot)($|_)')),
  null,
  'no column anywhere could hold an entry fee, a stake or a pot (§13.4)');

select throws_ok($$
  insert into public.challenges (title, scope, starts_at, ends_at, prize_type, prize_value, prize_funded_by)
  values ('User funded', 'city', now(), now() + interval '7 days', 'coins', 1000, 'users')
$$, '23514', null,
  'a prize funded by users is rejected — prizes come from us or a sponsor');

select throws_ok($$
  insert into public.challenges (title, scope, starts_at, ends_at, prize_type, prize_value, prize_funded_by)
  values ('Cash prize', 'city', now(), now() + interval '7 days', 'cash', 5000, 'house')
$$, '23514', null,
  'a cash prize is rejected — coins and vouchers only (§1)');

select lives_ok($$
  insert into public.challenges (title, scope, starts_at, ends_at, prize_type, prize_value,
                                 prize_funded_by, sponsor_name)
  values ('Lahore vs Karachi', 'city', now(), now() + interval '7 days', 'voucher', 5000,
          'sponsor', 'A Sponsor')
$$, 'a sponsor-funded voucher prize is fine');

-- ── the week resets Monday 00:00 PKT (§7.3) ────────────────────────────────
select is(extract(isodow from public.pkt_week_start(now()))::int, 1,
  'the leaderboard week always starts on a Monday');
select ok(public.pkt_week_start(now()) <= public.pkt_date(now()),
  'and that Monday is not in the future');

-- ── teams ──────────────────────────────────────────────────────────────────
create temporary table t (cap uuid, m1 uuid, m2 uuid, outsider uuid, team uuid, code text);
insert into t (cap, m1, m2, outsider) values (
  tests.new_user(p_city => 'Lahore'), tests.new_user(p_city => 'Lahore'),
  tests.new_user(p_city => 'Lahore'), tests.new_user(p_city => 'Karachi'));

select tests.act_as((select cap from t));
select lives_ok($$ select public.create_team('Gulberg Walkers') $$, 'a captain can create a team');
update t set team = (select id from public.teams where name = 'Gulberg Walkers'),
             code = (select invite_code from public.teams where name = 'Gulberg Walkers');

select is(
  (select count(*)::int from public.team_members where team_id = (select team from t)),
  1, 'the captain is a member of their own team');

select matches((select code from t), '^[A-Z2-9]{6}$',
  'the invite code is six unambiguous characters — no 0/O, no 1/I/L');

select throws_ok($$ select public.create_team('Second Team') $$, '23505', null,
  'a captain cannot create a second team');

select tests.act_as((select m1 from t));
select lives_ok($$ select public.join_team((select code from t)) $$, 'a member joins by code');
select tests.act_as((select m2 from t));
select lives_ok($$ select public.join_team(lower((select code from t))) $$,
  'the code is case-insensitive — people type it as they hear it');

select is(
  (select count(*)::int from public.team_members where team_id = (select team from t)),
  3, 'the team has three members');

select throws_ok($$ select public.create_team('Breakaway') $$, '23505', null,
  'someone already in a team cannot start another one');

select tests.act_as((select outsider from t));
select throws_ok($$ select public.join_team('ZZZZZZ') $$, 'P0002', null,
  'an unknown invite code is refused');

-- ── leaderboards ───────────────────────────────────────────────────────────
select tests.log_day((select cap from t),      public.pkt_date(now()), 12000);
select tests.log_day((select m1 from t),       public.pkt_date(now()), 9000);
select tests.log_day((select m2 from t),       public.pkt_date(now()), 15000);
select tests.log_day((select outsider from t), public.pkt_date(now()), 20000);
select ok(private.rebuild_leaderboards() > 0, 'the leaderboard rebuild writes snapshots');

select tests.act_as((select cap from t));
select is(
  (select user_id from public.leaderboard('national') order by rank limit 1),
  (select outsider from t),
  'the national board ranks the highest step count first');

select is(
  (select count(*)::int from public.leaderboard('city')),
  3,
  'the city board contains only this city — the Karachi user is absent');

select is(
  (select count(*)::int from public.leaderboard('team')),
  3,
  'the team board contains exactly the team');

select is((select rank from public.my_rank('city')), 2,
  'the captain is second in Lahore, behind the 15,000-step member');

select ok((select percentile from public.my_rank('national')) between 1 and 100,
  'the pinned own-rank row carries a percentile, not just a number');

-- Friends: only me and my friends, drawn from the national board.
insert into public.friendships (user_a, user_b)
select least(cap, outsider), greatest(cap, outsider) from t;
select is(
  (select count(*)::int from public.leaderboard('friends')),
  2,
  'the friends board is me plus my friends, and nobody else');

select is(
  (select user_id from public.leaderboard('friends') order by rank limit 1),
  (select outsider from t),
  'and it ranks them properly');

select throws_ok($$ select * from public.leaderboard('everyone') $$, '23514', null,
  'an unknown scope is refused rather than silently returning the world');

-- ── flagged steps are excluded from ranking, but never from the user (§7.3) ─
create temporary table fl (u uuid);
insert into fl (u) values (tests.new_user(p_city => 'Lahore'));
select tests.log_day((select u from fl), public.pkt_date(now()), 30000, array['device_shared']);
select ok(private.rebuild_leaderboards() > 0, 'rebuild runs again');

select is(
  (select count(*)::int from public.leaderboard_snap
    where user_id = (select u from fl) and period = public.current_leaderboard_period()),
  0,
  'a flagged day does not rank');

select is(
  (select credited_steps from public.daily_steps where user_id = (select u from fl)),
  30000,
  'but the user still sees their own full total — a false positive must not feel like theft');

-- A banned account leaves the boards entirely.
update public.users set status = 'banned' where id = (select outsider from t);
select ok(private.rebuild_leaderboards() > 0, 'rebuild runs after a ban');
select is(
  (select count(*)::int from public.leaderboard_snap where user_id = (select outsider from t)),
  0,
  'a banned account is absent from every board');

select * from finish();
rollback;
