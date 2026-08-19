-- ============================================================================
-- README §7.8 rewarded video, §7.7 referrals.
-- ============================================================================
begin;
select plan(30);

-- ── §13.5 — no ad can be recorded in the shopping flow ─────────────────────
-- "Zero ads in browse, cart, or checkout." Enforced by the placement CHECK, not
-- by remembering to review the UI.
select throws_ok($$
  insert into public.ad_impressions (user_id, network_txn_id, placement, coins_awarded)
  values (tests.new_user(), 'txn-cart', 'cart', 30)
$$, '23514', null, 'an ad impression in the cart is rejected');

select throws_ok($$
  insert into public.ad_impressions (user_id, network_txn_id, placement, coins_awarded)
  values (tests.new_user(), 'txn-checkout', 'checkout', 30)
$$, '23514', null, 'an ad impression at checkout is rejected');

select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
    where t.relname = 'ad_impressions'
      and pg_get_constraintdef(c.oid) ~* '(cart|checkout|browse|product|basket)'),
  0,
  'no placement the constraint permits names any part of the shopping flow');

-- ── the reward is read from config, never taken from the caller ────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(coalesce(p.proargnames, '{}')) as a(arg)
    where p.proname in ('credit_rewarded_ad','apply_referral_code','settle_referral')
      and (a.arg ilike '%coin%' or a.arg ilike '%amount%' or a.arg ilike '%balance%')),
  0,
  'no earning function takes a coin amount from its caller (§13.2)');

-- ── rewarded video ─────────────────────────────────────────────────────────
create temporary table t (u uuid);
insert into t (u) values (tests.new_user(p_created_at => now() - interval '30 days'));

select is(
  (private.credit_rewarded_ad((select u from t), 'ssv-1') ->> 'coins')::int, 30,
  'a verified rewarded video pays REWARDED_AD_COINS (30)');
select is(public.coin_balance((select u from t)), 30, 'and the coins are minted');
select is(
  (private.credit_rewarded_ad((select u from t), 'ssv-1') ->> 'credited')::boolean, false,
  'a replayed AdMob callback is not credited twice');
select is(public.coin_balance((select u from t)), 30, 'and the balance does not move');

select is((private.credit_rewarded_ad((select u from t), 'ssv-2') ->> 'coins')::int, 30, 'a second video pays');
select is((private.credit_rewarded_ad((select u from t), 'ssv-3') ->> 'remaining_today')::int, 0,
  'the third leaves none remaining today');
select is(
  (private.credit_rewarded_ad((select u from t), 'ssv-4') ->> 'reason'), 'daily_limit',
  'the fourth is refused — REWARDED_AD_DAILY_LIMIT is 3');
select is(public.coin_balance((select u from t)), 90, 'three videos, ninety coins, no more');
select is(public.rewarded_ads_today((select u from t)), 3, 'the count is server-side');

-- A banned account watches ads and earns nothing, and is told nothing.
create temporary table b (u uuid);
insert into b (u) values (tests.new_user(p_created_at => now() - interval '30 days'));
update public.users set status = 'banned' where id = (select u from b);
select is((private.credit_rewarded_ad((select u from b), 'ssv-b1') ->> 'credited')::boolean, true,
  'a banned account gets the same answer as anyone else');
select is(public.coin_balance((select u from b)), 0, 'but is paid nothing');

-- ── referrals: paid on the first COMPLETED purchase, never on install ──────
create temporary table r (referrer uuid, referee uuid, code text, prod uuid, ord uuid);
insert into r (referrer, referee, prod) values (
  tests.new_user(p_created_at => now() - interval '30 days'),
  tests.new_user(p_created_at => now() - interval '30 days'),
  tests.new_product(2000, 1200));
update r set code = (select u.referral_code from public.users u where u.id = r.referrer);

select ok((select code from r) ~ '^[A-Z2-9]{7}$',
  'every account gets a referral code at signup');

select tests.act_as((select referee from r));
select is(
  (public.apply_referral_code((select code from r)) ->> 'applied')::boolean, true,
  'the referee applies the code');
select is(public.coin_balance((select referrer from r)), 0,
  'nobody is paid on install — this is what kills install farms (§7.7)');
select is(public.coin_balance((select referee from r)), 0, 'neither side');
select is(
  (select count(*)::int from public.referrals where referee_id = (select referee from r) and paid_at is null),
  1, 'the referral sits pending, which is what the referrer is shown');

select throws_ok($$ select public.apply_referral_code((select code from r)) $$,
  '23505', null, 'a second code cannot be applied to the same account');

select tests.act_as((select referrer from r));
select throws_ok($$ select public.apply_referral_code((select code from r)) $$,
  '23514', null, 'you cannot refer yourself');

-- An order that is placed but never arrives pays nobody.
update r set ord = tests.new_order(referee);
insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr)
select ord, prod, 1, 2000, 1200 from r;
update public.orders set status = 'refused' where id = (select ord from r);
select is(public.coin_balance((select referrer from r)), 0,
  'a refused order settles nothing — "completed" means delivered, in a COD market especially');

-- Delivery is what qualifies.
update public.orders set status = 'delivered' where id = (select ord from r);
select is(public.coin_balance((select referrer from r)), 500,
  'on delivery the referrer is paid REFERRAL_COINS_REFERRER');
select is(public.coin_balance((select referee from r)), 500,
  'and the referee is paid too — both sides, per §7.7');

select is(
  (select count(*)::int from public.referrals
    where referee_id = (select referee from r) and paid_at is not null),
  1, 'the referral is marked settled');

-- A second delivered order does not pay again.
create temporary table r2 (ord uuid);
insert into r2 (ord) select tests.new_order(referee) from r;
insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr)
select r2.ord, r.prod, 1, 2000, 1200 from r2, r;
update public.orders set status = 'delivered' where id = (select ord from r2);
select is(public.coin_balance((select referrer from r)), 500,
  'a second delivered order pays the referrer nothing further');

select tests.act_as((select referrer from r));
select is((select count(*)::int from public.my_referrals()), 1,
  'the referrer sees their referral');
select is((select paid from public.my_referrals() limit 1), true,
  'and can see it has been paid');

-- ── coins still cannot move between people ─────────────────────────────────
select is(
  (select count(*)::int
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and p.proname ~* '(transfer|gift|send|withdraw|cash_?out|redeem_cash)'),
  0,
  'no function anywhere transfers, gifts or cashes out coins (§13.3)');

select * from finish();
rollback;
