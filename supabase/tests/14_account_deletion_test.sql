-- ============================================================================
-- In-app account deletion.
--
-- Both stores require it of any app with accounts. It is also the one operation
-- that has to reach through an APPEND-ONLY ledger, so the interesting question
-- is not "does it delete" but "does everything else stay locked while it does".
-- ============================================================================
begin;
select plan(21);

create temporary table t (leaver uuid, friend uuid, captain_of uuid);
insert into t (leaver, friend) values (
  tests.new_user(p_city => 'Lahore', p_created_at => now() - interval '60 days'),
  tests.new_user(p_city => 'Lahore', p_created_at => now() - interval '60 days'));

select private.mint_coins((select leaver from t), 900, 'steps', public.pkt_date(now()) - 1) \gset m_
-- The friend keeps coins throughout, so "the ledger is still locked" is a claim
-- about the trigger rather than about an empty table: a DELETE that matches no
-- rows never fires a row-level trigger and would pass either way.
select private.mint_coins((select friend from t), 400, 'steps', public.pkt_date(now()) - 1) \gset mf_
select tests.log_day((select leaver from t), public.pkt_date(now()), 9000);
insert into public.push_tokens (user_id, token, platform)
select leaver, 'ExponentPushToken[leaving]', 'android' from t;
insert into public.friendships (user_a, user_b)
select least(leaver, friend), greatest(leaver, friend) from t;

-- ── the ledger stays append-only for everyone else ─────────────────────────
select throws_ok($$ delete from public.coin_ledger $$, '23001', null,
  'the ledger is still append-only — deletion does not open a general door');

select throws_ok($$
  update public.coin_ledger set delta = 1 where delta > 0
$$, '23001', null, 'and still cannot be rewritten');

-- ── requesting it ──────────────────────────────────────────────────────────
select tests.act_as((select leaver from t));
select is((public.request_account_deletion() ->> 'status'), 'deleting',
  'a signed-in user can ask to leave');

select is((select status from public.users where id = (select leaver from t)), 'deleting',
  'the account is marked immediately');

select is((select count(*)::int from public.push_tokens where user_id = (select leaver from t)), 0,
  'push tokens go straight away — no notifications to someone who has left');

select is((select count(*)::int from public.friendships), 0,
  'and they leave every shared surface at once, without waiting for the queue');

-- Marked accounts earn nothing and rank nowhere.
select ok(private.rebuild_leaderboards() >= 0, 'leaderboards rebuild');
select is(
  (select count(*)::int from public.leaderboard_snap where user_id = (select leaver from t)),
  0,
  'an account on its way out does not appear on any board');

-- ── a client cannot delete anyone, including itself ────────────────────────
select ok(tests.denied('authenticated', (select friend from t),
       format('select public.delete_account(%L)', (select leaver from t))),
  'a client cannot call the function that removes rows');

select ok(tests.denied('authenticated', (select friend from t),
       format('delete from public.users where id = %L', (select leaver from t))),
  'nor delete a user row directly');

-- ── the guard: only an account that asked ──────────────────────────────────
select throws_ok(
  format($$ select private.delete_account(%L) $$, (select friend from t)),
  '23514', null,
  'an account that has not asked to leave cannot be deleted');

-- ── the deletion itself ────────────────────────────────────────────────────
select is((private.delete_account((select leaver from t)) ->> 'deleted')::boolean, true,
  'the request is carried out');

select is((select count(*)::int from public.users where id = (select leaver from t)), 0,
  'the user row is gone');
select is((select count(*)::int from public.coin_ledger where user_id = (select leaver from t)), 0,
  'their coins are gone — destroyed, not moved, because §13.3 leaves nowhere to move them');
select is((select count(*)::int from public.daily_steps where user_id = (select leaver from t)), 0,
  'their step history is gone');

-- ── and the door closes again ──────────────────────────────────────────────
select throws_ok($$ delete from public.coin_ledger $$, '23001', null,
  'the ledger is append-only again the moment the transaction moves on');

select is(public.coin_balance((select friend from t)), 400,
  'the friend who stayed keeps every coin they had');

-- ── a captain leaving hands over rather than stranding the team ────────────
create temporary table team (cap uuid, member uuid);
insert into team (cap, member) values (
  tests.new_user(p_created_at => now() - interval '60 days'),
  tests.new_user(p_created_at => now() - interval '60 days'));
select tests.act_as((select cap from team));
select public.create_team('Leavers United') \gset ct_
select tests.act_as((select member from team));
select public.join_team((select invite_code from public.teams where name = 'Leavers United')) \gset jt_

select tests.act_as((select cap from team));
select public.request_account_deletion() \gset rq_
select is((private.delete_account((select cap from team)) ->> 'deleted')::boolean, true,
  'the captain leaves');

select is(
  (select captain_id from public.teams where name = 'Leavers United'),
  (select member from team),
  'and the team is handed to its longest-standing remaining member, not stranded');

-- The last person out takes the team with them.
select tests.act_as((select member from team));
select public.request_account_deletion() \gset rq2_
select is((private.delete_account((select member from team)) ->> 'deleted')::boolean, true,
  'the last member leaves too');
select is((select count(*)::int from public.teams where name = 'Leavers United'), 0,
  'and the empty team goes with them');

select * from finish();
rollback;
