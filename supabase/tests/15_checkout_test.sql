-- ============================================================================
-- README §7.5 — checkout, and the COD lifecycle that decides whether the
-- business makes money.
--
-- Two things are on trial here.
--
-- One: the client cannot name its own discount. place_order takes product ids,
-- quantities and a boolean; every rupee is computed server-side from the
-- products table and from config no client can read.
--
-- Two: "Spend coins on an order and refuse the delivery, and the coins are
-- gone." That is the skin in the game the whole COD model rests on, and it is
-- the difference between an 18% return-to-origin rate and a business.
-- ============================================================================
begin;
select plan(40);

-- ── the signature is the first line of defence (§13.2) ─────────────────────
-- §13.2 forbids taking a coin VALUE from the client. A boolean cannot be one —
-- p_use_coins means "spend my coins if you can", and the amount is still worked
-- out here. So the check is on parameters that could carry a number.
select is(
  (select coalesce(string_agg(a.arg || ' ' || format_type(t.oid, null), ', '), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral unnest(p.proargnames, p.proargtypes::oid[]) as a(arg, argtype)
     join pg_type t on t.oid = a.argtype
    where n.nspname = 'public' and p.proname = 'place_order'
      and t.typname <> 'bool'
      and (a.arg ilike '%coin%' or a.arg ilike '%discount%'
           or a.arg ilike '%price%' or a.arg ilike '%total%' or a.arg ilike '%amount%')),
  '',
  'place_order takes no discount, coin, price or total the caller could put a number in');

create temporary table t (buyer uuid, poor uuid, fresh uuid, item uuid, phone uuid, cheap uuid, excluded uuid);
insert into t (buyer, poor, fresh) values (
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '2 days'));

-- price 2000 / cost 1200 → margin 800 → 20% = 160, 10% of price = 200 → cap 160
update t set item  = tests.new_product(2000, 1200, 50);
-- the phone from the brief: 5% margin, capped near 1% of price
update t set phone = tests.new_product(94000, 89000, 5);
update t set cheap = tests.new_product(400, 200, 50);

insert into public.categories (id, name, coin_eligible)
values ('00000000-0000-4000-8000-0000000000ff', 'No coins here', false);
insert into public.products (id, title, brand_id, category_id, price_pkr, cost_pkr, stock, source)
values ('00000000-0000-4000-8000-0000000000fe', 'Excluded item', tests.default_brand(),
        '00000000-0000-4000-8000-0000000000ff', 5000, 2000, 20, 'owned');
update t set excluded = '00000000-0000-4000-8000-0000000000fe';

select private.mint_coins((select buyer from t), 10000, 'steps', public.pkt_date(now()) - 1) \gset b_
select private.mint_coins((select poor from t), 50, 'steps', public.pkt_date(now()) - 1) \gset p_
select private.mint_coins((select fresh from t), 10000, 'steps', public.pkt_date(now()) - 1) \gset f_

-- ── an ordinary order, coins spent ─────────────────────────────────────────
select tests.act_as((select buyer from t));

create temporary table o1 (r jsonb);
insert into o1 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1, Gulberg, Lahore', '+923001234567');

select is(((select r from o1) ->> 'subtotal_pkr')::int, 2000, 'the subtotal is computed from the products table');
select is(((select r from o1) ->> 'discount_pkr')::int, 160,
  'the discount is exactly the §0 cap: 20% of an 800 rupee margin');
select is(((select r from o1) ->> 'total_pkr')::int, 1840, 'and the total reflects it');

select is(((select r from o1) ->> 'coins_spent')::int, 5334,
  'coins are charged at ceil() — 160 rupees of discount costs 5,334 coins, never 5,333');
select is(public.coin_balance((select buyer from t)), 4666, 'and the balance falls by exactly that');

select is(
  (select coin_state from public.my_orders() limit 1), 'pending',
  'the coins are pending, not yet spent — §7.5');

-- ── the cap holds however many coins someone has ───────────────────────────
select private.mint_coins((select buyer from t), 500000, 'adjustment_credit') \gset rich_
select tests.act_as((select buyer from t));

create temporary table o2 (r jsonb);
insert into o2 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select phone from t), 'qty', 1)),
  'House 1', '+923001234567');

select is(((select r from o2) ->> 'discount_pkr')::int, 1000,
  'a PKR 94,000 phone gets PKR 1,000 off — about 1% — no matter how rich the wallet is');
select ok(((select r from o2) ->> 'discount_pkr')::int < 0.02 * 94000,
  'never even 2% of the price of a low-margin item');

-- ── the discount never exceeds the cap, per line or in total ───────────────
select is(
  (select count(*)::int from public.order_items oi
     join public.products p on p.id = oi.product_id
    where oi.discount_pkr > oi.qty * public.max_coin_discount_pkr(oi.price_pkr, oi.cost_pkr)),
  0,
  'no line anywhere carries more discount than §0 allows');

select ok(
  (select bool_and(gross_profit_pkr >= 0) from public.order_economics),
  'and every order still shows non-negative gross profit (§3.3)');

-- ── the three reasons coins are not spent ──────────────────────────────────
select tests.act_as((select buyer from t));
create temporary table o3 (r jsonb);
insert into o3 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select cheap from t), 'qty', 1)),
  'House 1', '+923001234567');
select is(((select r from o3) ->> 'discount_pkr')::int, 0,
  'an order under MIN_ORDER_FOR_COINS_PKR gets no coin discount');

select tests.act_as((select fresh from t));
create temporary table o4 (r jsonb);
insert into o4 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567');
select is(((select r from o4) ->> 'discount_pkr')::int, 0,
  'a two-day-old account cannot spend coins (§6.1), however many it has');
select is(public.coin_balance((select fresh from t)), 10000, 'and keeps all of them');

select tests.act_as((select buyer from t));
create temporary table o5 (r jsonb);
insert into o5 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select excluded from t), 'qty', 1)),
  'House 1', '+923001234567');
select is(((select r from o5) ->> 'discount_pkr')::int, 0,
  'a category the brand excluded funds no discount');

select tests.act_as((select poor from t));
create temporary table o6 (r jsonb);
insert into o6 (r) select public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567', 'cod', true);
select is(((select r from o6) ->> 'discount_pkr')::int, 1,
  'fifty coins buys one rupee off — floor(), so a part-rupee is never rounded up');

-- ── stock ──────────────────────────────────────────────────────────────────
select is((select stock from public.products where id = (select phone from t)), 4,
  'stock comes down when an order is placed');

select tests.act_as((select buyer from t));
select throws_ok($$
  select public.place_order(
    jsonb_build_array(jsonb_build_object('product_id', (select phone from t), 'qty', 9)),
    'House 1', '+923001234567')
$$, '23514', null, 'an order for more than the shelf holds is refused');

select throws_ok($$
  select public.place_order('[]'::jsonb, 'House 1', '+923001234567')
$$, '23514', null, 'an empty order is refused');

select throws_ok($$
  select public.place_order(
    jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 50)),
    'House 1', '+923001234567')
$$, '23514', null, 'fifty of one item in one order is refused');

-- ── the lifecycle ──────────────────────────────────────────────────────────
create temporary table live (id uuid, coins_before int);
insert into live (id, coins_before)
select ((select r from o1) ->> 'order_id')::uuid, public.coin_balance((select buyer from t));

select throws_ok(
  format($$ select private.set_order_status(%L, 'delivered') $$, (select id from live)),
  '23514', null,
  'an order cannot jump from awaiting confirmation to delivered');

select lives_ok(format($$ select private.set_order_status(%L, 'confirmed') $$, (select id from live)),
  'it can be confirmed');
select lives_ok(format($$ select private.set_order_status(%L, 'dispatched') $$, (select id from live)),
  'and dispatched');
select throws_ok(format($$ select private.set_order_status(%L, 'confirmed') $$, (select id from live)),
  '23514', null, 'but not confirmed again afterwards');

select lives_ok(format($$ select private.set_order_status(%L, 'delivered') $$, (select id from live)),
  'and delivered');

select is(public.coin_balance((select buyer from t)), (select coins_before from live),
  'delivery writes nothing to the ledger — the coins left at placement and are simply spent');
select tests.act_as((select buyer from t));
select is((select coin_state from public.my_orders() where id = (select id from live)), 'spent',
  'and the order says so');

-- ── REFUSAL: the coins are gone ────────────────────────────────────────────
select tests.act_as((select buyer from t));
-- Captured in separate statements on purpose: the order of evaluation of two
-- function calls inside one SELECT is not defined, and a test that depends on it
-- passes or fails by luck.
create temporary table burn (id uuid, before int, after_place int, stock_before int);
insert into burn (before, stock_before)
select public.coin_balance((select buyer from t)),
       (select stock from public.products where id = (select item from t));

update burn set id = (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 2)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;

update burn set after_place = public.coin_balance((select buyer from t));

select ok((select before from burn) > (select after_place from burn),
  'placing the order took coins');

select private.set_order_status((select id from burn), 'confirmed') \gset c_
select private.set_order_status((select id from burn), 'dispatched') \gset d_
select private.set_order_status((select id from burn), 'refused') \gset r_

select is(public.coin_balance((select buyer from t)), (select after_place from burn),
  'REFUSING THE DELIVERY BURNS THE COINS — they are not returned (§7.5)');

select tests.act_as((select buyer from t));
select is((select coin_state from public.my_orders() where id = (select id from burn)), 'burned',
  'and the order says burned, in as many words');

select is((select stock from public.products where id = (select item from t)),
  (select stock_before from burn),
  'but the stock comes back — the parcel returned to us');

-- ── cancellation before dispatch: the one path back ────────────────────────
select tests.act_as((select buyer from t));
create temporary table cancelled (id uuid, before int, held int);
insert into cancelled (before) select public.coin_balance((select buyer from t));
update cancelled set id = (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;
update cancelled set held = public.coin_balance((select buyer from t));

select ok((select held from cancelled) < (select before from cancelled),
  'the coins are held');

select lives_ok($$ select public.cancel_my_order((select id from cancelled)) $$,
  'the customer can call off an order that has not shipped');

select is(public.coin_balance((select buyer from t)), (select before from cancelled),
  'and every coin comes back — exactly, not approximately');

-- The reversal must carry the expiry of the batch it is undoing. A fresh ninety
-- days would turn cancelling an order into a way of extending coin life.
select is(
  (select count(*)::int
     from public.coin_ledger rev
     join public.coin_ledger debit on debit.id = (rev.meta ->> 'reverses')::uuid
     join public.coin_ledger batch on batch.id = debit.consumes_id
    where rev.order_id = (select id from cancelled)
      and rev.reason = 'order_reversal'
      and rev.expires_at <> batch.expires_at),
  0,
  'returned with their ORIGINAL expiry, not a fresh ninety days');

select tests.act_as((select buyer from t));
select throws_ok($$ select public.cancel_my_order((select id from live)) $$,
  '23514', null, 'an order that has shipped cannot be cancelled by the customer');

-- ── the confirmation gate (§7.5) ───────────────────────────────────────────
select tests.act_as((select buyer from t));
create temporary table big (id uuid);
insert into big (id)
select (public.place_order(
          jsonb_build_array(jsonb_build_object('product_id', (select phone from t), 'qty', 1)),
          'House 1', '+923001234567') ->> 'order_id')::uuid;

select throws_ok(
  format($$ select private.set_order_status(%L, 'dispatched') $$, (select id from big)),
  '23514', null,
  'a COD order over the threshold is never dispatched unconfirmed');

-- ── a client cannot move its own parcel along ──────────────────────────────
select ok(tests.denied('authenticated', (select buyer from t),
       format('select public.set_order_status(%L, ''delivered'')', (select id from big))),
  'a customer cannot mark their own order delivered');

select ok(tests.denied('authenticated', (select buyer from t),
       'update public.orders set status = ''delivered'''),
  'nor write the status directly');

select ok(tests.denied('authenticated', (select buyer from t),
       'update public.order_items set discount_pkr = 99999'),
  'nor edit a line''s discount');

select * from finish();
rollback;
