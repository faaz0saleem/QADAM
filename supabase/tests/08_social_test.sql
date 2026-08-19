-- ============================================================================
-- README §7.3 friends, §7.6 teams — the write paths.
--
-- friendships and team_members are readable but not writable by a client. Every
-- mutation goes through a function, so the rules live in one place. These tests
-- check both halves: that the functions enforce the rules, and that a client
-- cannot go round them.
-- ============================================================================
begin;
select plan(36);

create temporary table t (a uuid, b uuid, c uuid, code_b text);
insert into t (a, b, c) values (
  tests.new_user(p_city => 'Lahore'),
  tests.new_user(p_city => 'Lahore'),
  tests.new_user(p_city => 'Karachi'));
update t set code_b = (select u.referral_code from public.users u where u.id = t.b);

-- ── friends ────────────────────────────────────────────────────────────────
select tests.act_as((select a from t));

select is((public.add_friend((select code_b from t)) ->> 'added')::boolean, true,
  'a friend is added by their code — the same code they share for referrals');

select is((select count(*)::int from public.my_friends()), 1, 'and shows up in my friends');

select lives_ok($$ select public.add_friend((select code_b from t)) $$,
  'adding the same person twice is not an error');
select is((select count(*)::int from public.my_friends()), 1, 'and does not duplicate them');

select throws_ok($$
  select public.add_friend((select u.referral_code from public.users u where u.id = (select a from t)))
$$, '23514', null, 'you cannot add yourself');

select throws_ok($$ select public.add_friend('NOSUCH1') $$, 'P0002', null,
  'an unknown code is refused');

-- The friendship is one row, and it reads the same from either side.
select is((select count(*)::int from public.friendships), 1,
  'a friendship is stored once, not once per direction');

select tests.act_as((select b from t));
select is((select count(*)::int from public.my_friends()), 1,
  'the other person sees the friendship too, without adding it back');

-- ── friends leaderboard scope now has data (§7.3) ──────────────────────────
select tests.log_day((select a from t), public.pkt_date(now()), 8000);
select tests.log_day((select b from t), public.pkt_date(now()), 12000);
select tests.log_day((select c from t), public.pkt_date(now()), 20000);
select ok(private.rebuild_leaderboards() > 0, 'leaderboards rebuild');

select tests.act_as((select a from t));
select is((select count(*)::int from public.leaderboard('friends')), 2,
  'the friends board is me and my one friend');
select is((select user_id from public.leaderboard('friends') order by rank limit 1),
  (select b from t),
  'ranked by steps, and the Karachi stranger with 20,000 is not in it');

select lives_ok($$ select public.remove_friend((select b from t)) $$, 'a friend can be removed');
select is((select count(*)::int from public.my_friends()), 0, 'and is gone from both sides');

-- ── a client cannot write these tables directly ────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       format('insert into public.friendships (user_a, user_b) values (%L, %L)',
              (select least(a, c) from t), (select greatest(a, c) from t))),
  'a client cannot insert a friendship directly');

select ok(tests.denied('authenticated', (select a from t),
       'delete from public.friendships'),
  'nor delete one');

-- ── teams ──────────────────────────────────────────────────────────────────
select tests.act_as((select a from t));
select lives_ok($$ select public.create_team('Model Town Walkers', 'Lahore') $$,
  'a team is created');

select is((select name from public.my_team()), 'Model Town Walkers', 'my_team finds it');
select is((select is_captain from public.my_team()), true, 'the creator is the captain');
select is((select member_count from public.my_team()), 1, 'with one member');

select ok(tests.denied('authenticated', (select a from t),
       format('insert into public.team_members (team_id, user_id) values (%L, %L)',
              (select team_id from public.my_team()), (select c from t))),
  'a captain cannot add someone to their team by writing the table');

create temporary table code (v text);
insert into code (v) select invite_code from public.my_team();

select tests.act_as((select b from t));
select lives_ok($$ select public.join_team((select v from code)) $$, 'a member joins with the code');
select tests.act_as((select a from t));
select is((select member_count from public.my_team()), 2, 'the team now has two');
select is((select count(*)::int from public.team_roster()), 2, 'and the roster shows both');
select is((select is_captain from public.team_roster() where is_me), true,
  'the roster marks the captain');

-- ── leaving ────────────────────────────────────────────────────────────────
select throws_ok($$ select public.leave_team() $$, '23514', null,
  'the captain cannot walk out on a team that still has members');

select throws_ok($$ select public.hand_over_captaincy((select c from t)) $$, '23514', null,
  'captaincy cannot be handed to someone who is not a member');

select lives_ok($$ select public.hand_over_captaincy((select b from t)) $$,
  'but it can be handed to a member');
select is((select is_captain from public.my_team()), false, 'the old captain is no longer captain');

select lives_ok($$ select public.leave_team() $$, 'and can now leave');
select is((select count(*)::int from public.my_team()), 0, 'they are out of the team');

-- ── §7.6 — office vs office needs a rank for the OFFICE ────────────────────
create temporary table two (cap2 uuid, member2 uuid);
insert into two (cap2, member2) values (
  tests.new_user(p_city => 'Lahore'), tests.new_user(p_city => 'Lahore'));

select tests.act_as((select cap2 from two));
select public.create_team('Rival Office') \gset rival_
select tests.act_as((select member2 from two));
select public.join_team((select invite_code from public.teams where name = 'Rival Office')) \gset j2_

-- The rival team has two walkers doing 9,000 each; ours has one on 12,000.
select tests.log_day((select cap2 from two), public.pkt_date(now()), 9000);
select tests.log_day((select member2 from two), public.pkt_date(now()), 9000);
select ok(private.rebuild_leaderboards() >= 0, 'boards rebuild');

select tests.act_as((select a from t));
select is((select name from public.team_standings() order by rank limit 1), 'Rival Office',
  'teams are ranked on TOTAL steps — two people at 9,000 beat one at 12,000');

select is((select count(*)::int from public.team_standings()), 2, 'both teams are standing');

select is((select members from public.team_standings() where name = 'Rival Office'), 2,
  'the standing shows how many people walked for the team');

select tests.act_as((select cap2 from two));
select is((select rank from public.my_team_standing()), 1, 'and a captain can see where their team sits');
select is((select of_total from public.my_team_standing()), 2, 'out of how many');

select * from finish();
rollback;
