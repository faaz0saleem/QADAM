-- ============================================================================
-- README §5 — the coin ledger.
--
-- Two properties this file exists to defend:
--   1. The ledger is append-only and there is no balance column anywhere.
--   2. Expiry is exact. A spent-then-expired batch must not double-subtract and
--      walk a user into a negative balance.
-- ============================================================================
begin;
select plan(35);

select has_table('public', 'coin_ledger', 'coin_ledger exists');

-- ── there is no balance column, anywhere ───────────────────────────────────
-- "Never store a balance column. Ever." — §5. This assertion is the tripwire.
select is(
  (select count(*)::int
     from information_schema.columns
    where table_schema in ('public','private')
      and (column_name = 'balance'
           or column_name like '%coin_balance%'
           or column_name like 'balance_%'
           or column_name like '%_balance')),
  0,
  'no table in public or private has a balance column');

-- ── append-only, enforced by the database ──────────────────────────────────
create temporary table t (u uuid, u2 uuid, batch uuid);
insert into t (u, u2) values (
  tests.new_user(p_created_at => now() - interval '60 days'),
  tests.new_user(p_created_at => now() - interval '60 days'));
update t set batch = private.mint_coins(u, 1000, 'steps', public.pkt_date(now()));

select throws_ok($$
  update public.coin_ledger set delta = 999999 where id = (select batch from t)
$$, '23001', null, 'UPDATE on coin_ledger is rejected');

select throws_ok($$
  delete from public.coin_ledger where id = (select batch from t)
$$, '23001', null, 'DELETE on coin_ledger is rejected');

-- ── minting and balance ────────────────────────────────────────────────────
select is(public.coin_balance((select u from t)), 1000, 'a 1,000 coin mint shows a 1,000 balance');
select is(public.coin_balance((select u2 from t)), 0, 'a user with no rows has a zero balance, not null');

select throws_ok($$ select private.mint_coins((select u from t), 0, 'adjustment_credit') $$,
  '23514', null, 'minting zero coins is rejected');
select throws_ok($$ select private.mint_coins((select u from t), -50, 'adjustment_credit') $$,
  '23514', null, 'minting a negative amount is rejected');

select is(
  (select expires_at::date from public.coin_ledger where id = (select batch from t)),
  (now() + interval '90 days')::date,
  'a fresh batch expires in COIN_EXPIRY_DAYS (90) days');

-- ── spending ───────────────────────────────────────────────────────────────
select lives_ok($$ select private.spend_coins((select u from t), 300, 'adjustment_debit') $$,
  'spending 300 of 1,000 succeeds');
select is(public.coin_balance((select u from t)), 700, 'balance falls to 700');

select throws_ok($$ select private.spend_coins((select u from t), 701, 'adjustment_debit') $$,
  '23514', null, 'spending more than the balance is rejected');
select is(public.coin_balance((select u from t)), 700, 'a rejected spend leaves the balance untouched');

select throws_ok($$ select private.spend_coins((select u from t), 0, 'adjustment_debit') $$,
  '23514', null, 'spending zero is rejected');

-- ── coins never move between users (§13.3) ─────────────────────────────────
select throws_ok($$
  insert into public.coin_ledger (user_id, delta, reason, consumes_id)
  select u2, -100, 'adjustment_debit', batch from t
$$, '23514', null,
  'a debit cannot draw on another user''s batch — there is no transfer path');

-- ── a batch cannot be overdrawn even by a direct insert ────────────────────
select throws_ok($$
  insert into public.coin_ledger (user_id, delta, reason, consumes_id)
  select u, -5000, 'adjustment_debit', batch from t
$$, '23514', null,
  'a single debit larger than its batch is rejected');

-- ── FIFO: soonest expiry is spent first ────────────────────────────────────
create temporary table f (u uuid, soon uuid, later uuid);
insert into f (u) values (tests.new_user(p_created_at => now() - interval '60 days'));
-- Two batches, hand-dated so their order is unambiguous.
insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date)
select u, 100, 'steps', now() + interval '5 days', public.pkt_date(now() - interval '1 day') from f
returning id \gset soon_
insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date)
select u, 100, 'steps', now() + interval '60 days', public.pkt_date(now()) from f
returning id \gset later_
update f set soon = :'soon_id', later = :'later_id';

select is(public.coin_balance((select u from f)), 200, 'two batches of 100 make a 200 balance');
select lives_ok($$ select private.spend_coins((select u from f), 100, 'adjustment_debit') $$,
  'spending 100 across two batches succeeds');

select is(
  (select coalesce(sum(delta), 0)::int from public.coin_ledger where consumes_id = (select soon from f)),
  -100,
  'the batch expiring in 5 days is drained first');
select is(
  (select coalesce(sum(delta), 0)::int from public.coin_ledger where consumes_id = (select later from f)),
  0,
  'the batch expiring in 60 days is untouched');

select is(
  (select count(*)::int from public.coin_batches((select u from f))),
  1,
  'the drained batch drops out of the wallet view');

-- A spend that straddles batches writes one row per batch.
select lives_ok($$ select private.spend_coins((select u from f), 60, 'adjustment_debit') $$,
  'a spend can straddle batches');
select is(public.coin_balance((select u from f)), 40, 'balance is 40 after spending 160 of 200');

-- ── EXPIRY — the case that breaks a naive ledger ───────────────────────────
-- A batch that was partly spent and has now expired must contribute exactly zero.
-- Sum every delta blindly and this user's balance goes NEGATIVE.
create temporary table e (u uuid, batch uuid);
insert into e (u) values (tests.new_user(p_created_at => now() - interval '60 days'));
insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date)
select u, 500, 'steps', now() + interval '1 hour', public.pkt_date(now()) from e
returning id \gset exp_
update e set batch = :'exp_id';

select lives_ok($$ select private.spend_coins((select u from e), 200, 'adjustment_debit') $$,
  'spend 200 of a 500 batch that is about to expire');
select is(public.coin_balance((select u from e)), 300, 'balance is 300 while the batch is live');

-- Time cannot pass inside a test transaction, so construct the state that time
-- would produce: a batch spent while it was live, which has since lapsed. The
-- debit guard rightly refuses to write a debit against an already-expired batch,
-- so it is switched off for the two setup rows and switched straight back on.
create temporary table x (u uuid, batch uuid);
insert into x (u) values (tests.new_user(p_created_at => now() - interval '60 days'));
alter table public.coin_ledger disable trigger coin_ledger_debit_guard;
insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date)
select u, 500, 'steps', now() - interval '1 day', public.pkt_date(now() - interval '91 days') from x
returning id \gset old_
update x set batch = :'old_id';
insert into public.coin_ledger (user_id, delta, reason, consumes_id)
select u, -200, 'adjustment_debit', batch from x;
alter table public.coin_ledger enable trigger coin_ledger_debit_guard;

select is(public.coin_balance((select u from x)), 0,
  'a partly-spent EXPIRED batch contributes exactly zero — not minus 200');
select ok(public.coin_balance((select u from x)) >= 0,
  'the balance can never go negative through expiry');
select is(
  (select count(*)::int from public.coin_batches((select u from x))),
  0,
  'an expired batch is absent from the wallet view');

select throws_ok($$
  insert into public.coin_ledger (user_id, delta, reason, consumes_id)
  select u, -100, 'adjustment_debit', batch from x
$$, '23514', null,
  'expired coins cannot be spent');

-- ── expiry reporting drives the retention push (§4) ────────────────────────
select is(public.coins_expiring_within((select u from e), 7), 300,
  'coins_expiring_within(7 days) sees the 300 coins about to lapse');
select is(public.coins_expiring_within((select u from t), 7), 0,
  'a fresh 90-day batch is not reported as expiring within 7 days');
select is(public.coins_expiring_within((select u from f), 90), 40,
  'a 60-day batch is reported at a 90-day horizon');

-- ── §6.1 — no redemption in an account's first 7 days ──────────────────────
create temporary table n (u uuid);
insert into n (u) values (tests.new_user(p_created_at => now() - interval '2 days'));
select private.mint_coins((select u from n), 1000, 'steps', public.pkt_date(now())) \gset mint_

select ok(not public.can_redeem((select u from n)), 'a 2-day-old account cannot redeem');
select throws_ok($$ select private.spend_coins((select u from n), 10, 'adjustment_debit') $$,
  '23514', null,
  'a new account is blocked from spending — this is what kills farm throughput');
select ok(public.can_redeem((select u from t)), 'a 60-day-old active account can redeem');

select * from finish();
rollback;
