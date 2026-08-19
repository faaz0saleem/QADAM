-- ============================================================================
-- README §8.4 the consignment importer, §3.3 the economics report.
--
-- The importer's job is to survive a real spreadsheet. The report's job is to
-- put the return-to-origin rate next to the revenue, because gross profit is
-- not net profit and one parcel in five coming back is what actually decides
-- this.
-- ============================================================================
begin;
select plan(25);

create temporary table b (id uuid);
insert into b (id) select tests.default_brand();

-- ── a real spreadsheet: mostly fine, partly wrong ──────────────────────────
create temporary table result (r jsonb);
insert into result (r) select private.import_products((select id from b), jsonb_build_array(
  jsonb_build_object('title', 'Lawn kurta',   'price', '3200', 'cost', '1900', 'stock', '40'),
  jsonb_build_object('title', 'Silk scarf',   'price', 'PKR 2,400', 'cost', '1,100', 'stock', '12'),
  jsonb_build_object('title', 'Loss leader',  'price', '500',  'cost', '600',  'stock', '5'),
  jsonb_build_object('title', '',             'price', '900',  'cost', '400',  'stock', '5'),
  jsonb_build_object('title', 'No cost given','price', '900',  'stock', '5'),
  jsonb_build_object('title', 'Free item',    'price', '0',    'cost', '0',    'stock', '5'),
  jsonb_build_object('title', 'Shawl', 'price', '5500', 'cost', '3100', 'stock', '8',
                     'images', 'a.jpg|b.jpg')
));

select is(((select r from result) ->> 'rows')::int, 7, 'every row is looked at');
select is(((select r from result) ->> 'imported')::int, 3, 'three good rows land');
select is(((select r from result) ->> 'rejected')::int, 4, 'four are rejected, not the file');

select is(
  (select count(*)::int from public.products where title = 'Silk scarf' and price_pkr = 2400 and cost_pkr = 1100),
  1,
  'a price typed as "PKR 2,400" is understood — a brand''s spreadsheet is not a CSV spec');

select is(
  (select images from public.products where title = 'Shawl'),
  '["a.jpg", "b.jpg"]'::jsonb,
  'pipe-separated images become an array');

-- The rejections have to be usable by the brand owner who wrote the file.
select ok(
  ((select r from result) -> 'problems') @> '[{"row": 3, "reason": "price 500 is not above cost 600"}]'::jsonb,
  'an item priced below cost is refused, and says so with both numbers');

select ok(
  ((select r from result) -> 'problems') @> '[{"row": 4, "reason": "no title"}]'::jsonb,
  'a missing title is refused by row number');

select ok(
  ((select r from result) -> 'problems') @> '[{"row": 5, "reason": "price and cost are both required"}]'::jsonb,
  'a missing cost is refused — §0 cannot be computed without it');

select ok(
  ((select r from result) -> 'problems') @> '[{"row": 6, "reason": "price must be above zero"}]'::jsonb,
  'a free item is refused');

-- ── nothing the importer creates can break §0 ──────────────────────────────
select is(
  (select count(*)::int from public.products where price_pkr <= cost_pkr),
  0,
  'no product anywhere is priced at or below cost');

select ok(
  (select bool_and(public.max_coin_discount_pkr(price_pkr, cost_pkr) <= 0.10 * price_pkr)
     from public.products),
  'and every imported item still obeys the 10%-of-price ceiling');

select throws_ok($$ select private.import_products(gen_random_uuid(), '[]'::jsonb) $$,
  '23503', null, 'importing against a brand that does not exist is refused');

select throws_ok($$ select private.import_products((select id from b), '"not an array"'::jsonb) $$,
  '23514', null, 'and so is a payload that is not a list of rows');

-- ── the economics report ───────────────────────────────────────────────────
create temporary table t (buyer uuid, item uuid);
insert into t (buyer) values (tests.new_user(p_created_at => now() - interval '90 days'));
update t set item = tests.new_product(2000, 1200, 100);
select private.mint_coins((select buyer from t), 20000, 'steps', public.pkt_date(now()) - 1) \gset m_

select tests.act_as((select buyer from t));
create temporary table orders_made (delivered uuid, refused uuid, open uuid);
update orders_made set delivered = null;
insert into orders_made (delivered) select (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;
update orders_made set refused = (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;
update orders_made set open = (public.place_order(
  jsonb_build_array(jsonb_build_object('product_id', (select item from t), 'qty', 1)),
  'House 1', '+923001234567') ->> 'order_id')::uuid;

select private.set_order_status((select delivered from orders_made), 'confirmed') \gset s1_
select private.set_order_status((select delivered from orders_made), 'dispatched') \gset s2_
select private.set_order_status((select delivered from orders_made), 'delivered') \gset s3_
select private.set_order_status((select refused from orders_made), 'confirmed') \gset s4_
select private.set_order_status((select refused from orders_made), 'dispatched') \gset s5_
select private.set_order_status((select refused from orders_made), 'refused') \gset s6_

create temporary table rep (r jsonb);
insert into rep (r) select private.economics_summary(current_date - 1, current_date);

select is((( select r from rep) ->> 'orders')::int, 3, 'the report counts every order in the window');
select is(((select r from rep) ->> 'delivered')::int, 1, 'one delivered');
select is(((select r from rep) ->> 'refused')::int, 1, 'one refused');

select is(((select r from rep) ->> 'rto_rate_pct')::numeric, 50.0,
  'the RTO rate is measured on CLOSED orders — counting the one still in transit would flatter it');
select is(((select r from rep) ->> 'rto_target_pct')::int, 12,
  'and the §7.5 target sits beside it');

select is(((select r from rep) ->> 'revenue_pkr')::int, 2000, 'revenue counts the delivered order only');
select is(((select r from rep) ->> 'cogs_pkr')::int, 1200, 'with its cost of goods');
select ok(((select r from rep) ->> 'gross_profit_pkr')::int > 0, 'and gross profit is positive');
select is(((select r from rep) ->> 'rto_cost_exposure_pkr')::int, 2000,
  'the value that shipped and came back is reported, because that is the money at risk');

-- ── the P0 alarm ───────────────────────────────────────────────────────────
select is((select count(*)::int from private.margin_alarm()), 0,
  '§3.3: the margin alarm is silent, as it must be forever unless §0 is bypassed');

-- ── none of this is reachable from a device ────────────────────────────────
select ok(tests.denied('authenticated', (select buyer from t),
       format('select public.import_products(%L, ''[]''::jsonb)', (select id from b))),
  'a client cannot import a catalogue');
select ok(tests.denied('authenticated', (select buyer from t),
       'select public.economics_summary()'),
  'nor read the economics report, which carries COGS');

select * from finish();
rollback;
