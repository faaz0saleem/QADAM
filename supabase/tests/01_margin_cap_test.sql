-- ============================================================================
-- §0 — THE ONE RULE THAT MUST NEVER BREAK
--
--   max_discount_pkr = MIN( 0.20 * (price - cost),  0.10 * price )
--
-- This file is the contract. It proves the rule is enforced by the DATABASE and
-- not by application code, which means no future feature, admin panel, promo
-- code, or bug can bypass it.
--
-- If a change makes this file fail, the change is wrong.
-- ============================================================================
begin;
select plan(35);

-- ── the function itself ────────────────────────────────────────────────────
select has_function('public', 'max_coin_discount_pkr', array['integer','integer'],
  'public.max_coin_discount_pkr(price, cost) exists');

select function_returns('public', 'max_coin_discount_pkr', array['integer','integer'], 'integer',
  'it returns an integer — money is never a float');

-- A CHECK constraint may only be trusted if the function it calls is immutable.
-- A volatile function would let the same row pass today and fail tomorrow.
select is(
  (select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'max_coin_discount_pkr'),
  'i'::"char",
  'it is IMMUTABLE, so the constraint means the same thing forever');

-- ── the arithmetic, at the boundaries that matter ──────────────────────────
-- Margin-bound: a 10% margin item is capped by the margin leg, not the price leg.
select is(public.max_coin_discount_pkr(1000, 900), 20,
  'price 1000 cost 900 → margin 100 → 20% of margin = 20 (margin leg binds)');

-- Both legs meet exactly at a 50% margin.
select is(public.max_coin_discount_pkr(1000, 500), 100,
  'price 1000 cost 500 → both legs = 100');

-- Price-bound: a fat-margin item is capped by the 10%-of-price leg.
select is(public.max_coin_discount_pkr(1000, 100), 100,
  'price 1000 cost 100 → margin 900 → 20% = 180, but price leg caps at 100');

-- The phone case from the brief. A 5% margin phone must land near 1% of price,
-- with no special-casing anywhere — the formula alone has to do it.
select is(public.max_coin_discount_pkr(100000, 95000), 1000,
  'PKR 100,000 phone at 5% margin → PKR 1,000 discount = 1% of price');

select ok(public.max_coin_discount_pkr(100000, 95000) < (0.02 * 100000)::int,
  'a low-margin phone can never reach even 2% off');

-- Zero margin, zero discount.
select is(public.max_coin_discount_pkr(1000, 1000), 0,
  'price = cost → no discount is fundable');

-- Never negative, however the inputs arrive.
select is(public.max_coin_discount_pkr(1000, 1200), 0,
  'cost above price → clamps to 0, never a negative discount');

select is(public.max_coin_discount_pkr(1, 0), 0,
  'a PKR 1 item floors to 0, it does not round up into a loss');

-- Rounding is always down. A discount that rounds up is a discount that can
-- exceed the cap by a rupee, and the cap is not a suggestion.
select is(public.max_coin_discount_pkr(999, 900), 19,
  'floor, not round: 0.20 × 99 = 19.8 → 19');

select is(public.max_coin_discount_pkr(1999, 1000), 199,
  'floor on the price leg too: 0.10 × 1999 = 199.9 → 199');

-- ── the constraint that makes it unbreakable ───────────────────────────────
select has_table('public', 'order_items', 'order_items exists');
select has_check('public', 'order_items', 'order_items carries a CHECK constraint');

select col_type_is('public', 'order_items', 'price_pkr',    'integer', 'price is snapshot on the line');
select col_type_is('public', 'order_items', 'cost_pkr',     'integer', 'cost is snapshot on the line');
select col_type_is('public', 'order_items', 'discount_pkr', 'integer', 'discount is an integer');

-- Fixtures: one user, one order, a 10%-margin product (cap = 20/unit) and a
-- phone at 5% margin (cap = 1,000/unit).
create temporary table t (user_id uuid, product_id uuid, phone_id uuid, order_id uuid);
insert into t (user_id, product_id, phone_id)
values (tests.new_user(), tests.new_product(1000, 900), tests.new_product(100000, 95000));
update t set order_id = tests.new_order(user_id);

-- Exactly at the cap is allowed. One rupee over is not.
select lives_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 1000, 900, 20 from t
$$, 'a discount exactly at the cap is accepted');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 1000, 900, 21 from t
$$, '23514', null,
  'ONE RUPEE over the cap is rejected by the database');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 1000, 900, 100 from t
$$, '23514', null,
  'a flat 10%-of-price discount on a 10%-margin item is rejected');

-- The phone: the case that would quietly kill the business one unit at a time.
select lives_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, phone_id, 1, 100000, 95000, 1000 from t
$$, 'a phone discounted to exactly 1% of price is accepted');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, phone_id, 1, 100000, 95000, 10000 from t
$$, '23514', null,
  '10% off a phone — the loss-making case — is rejected');

-- Negative discounts are not a back door to inflating the total either.
select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 1000, 900, -50 from t
$$, '23514', null,
  'a negative discount is rejected');

-- ── quantity scales the cap, and nothing else does ─────────────────────────
select lives_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 3, 1000, 900, 60 from t
$$, 'qty 3 → cap 3 × 20 = 60 is accepted');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 3, 1000, 900, 61 from t
$$, '23514', null,
  'qty 3 → 61 is rejected');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 0, 1000, 900, 0 from t
$$, '23514', null,
  'qty 0 is rejected outright');

-- ── an UPDATE cannot walk the discount past the cap either ─────────────────
select throws_ok($$
  update public.order_items set discount_pkr = 500
   where order_id = (select order_id from t) and price_pkr = 1000
$$, '23514', null,
  'raising the discount after insert is rejected too');

-- ── the line cannot be re-pointed at a forged cost to widen the cap ────────
-- Understating cost inflates apparent margin, which inflates the cap. The line
-- snapshot has to match the product it points at.
select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 1000, 0, 20 from t
$$, '23514', null,
  'a cost that does not match the product is rejected (no forging margin)');

select throws_ok($$
  insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
  select order_id, product_id, 1, 99, 90, 1 from t
$$, '23514', null,
  'an understated price that does not match the product is rejected');

-- ── products themselves can never be sold below cost ───────────────────────
select throws_ok($$
  insert into public.products (title, brand_id, category_id, price_pkr, cost_pkr, stock, source)
  values ('Loss Leader', tests.default_brand(), tests.default_category(), 500, 600, 10, 'owned')
$$, '23514', null,
  'a product priced below its cost cannot exist');

-- ── the order header cannot claim a discount its lines do not fund ─────────
-- Without this, a checkout path could put the whole discount on the header and
-- leave the lines at zero, and every per-line check above would be pointless.
select throws_ok($$
  update public.orders set discount_pkr = 99999 where id = (select order_id from t)
$$, '23514', null,
  'an order header discount above the sum of its lines is rejected');

select lives_ok($$
  update public.orders set discount_pkr = (
    select sum(discount_pkr) from public.order_items where order_id = (select order_id from t)
  ) where id = (select order_id from t)
$$, 'a header discount equal to the sum of its lines is accepted');

-- ── gross profit is structurally incapable of going negative ───────────────
select has_view('public', 'order_economics', 'order_economics view exists (§3.3)');

select ok(
  (select coalesce(bool_and(gross_profit_pkr >= 0), true) from public.order_economics),
  'every order in the database shows non-negative gross profit');

select * from finish();
rollback;
