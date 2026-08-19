-- ============================================================================
-- README §3.3 — "gross_profit_pkr is structurally incapable of going negative."
--
-- That is the whole business case. §0 is the mechanism; this is the claim the
-- mechanism exists to support, and it deserves more than one worked example.
--
-- So: sweep a wide grid of prices and costs, take the maximum discount the
-- database will allow on each, and check the arithmetic never produces a loss —
-- including at the integer boundaries where floor() and rounding live.
-- ============================================================================
begin;
select plan(12);

-- A grid spanning the catalogue we would plausibly carry: a PKR 50 sachet to a
-- PKR 500,000 laptop, at margins from 1% to 90%.
create temporary table grid as
select price,
       greatest(1, (price * (100 - margin_pct) / 100)::int) as cost,
       margin_pct
  from (values (50), (99), (100), (499), (1000), (1499), (2500), (9999),
               (15000), (49999), (94000), (150000), (500000)) as p(price)
  cross join (values (1), (2), (3), (5), (8), (10), (15), (20), (33), (50), (75), (90))
             as m(margin_pct)
 where greatest(1, (price * (100 - margin_pct) / 100)::int) < price;

select ok((select count(*) from grid) > 100, 'the grid is wide enough to be worth sweeping');

-- ── the cap never exceeds either leg ───────────────────────────────────────
select is(
  (select count(*)::int from grid
    where public.max_coin_discount_pkr(price, cost) > floor(0.20 * (price - cost))),
  0,
  'the cap never exceeds 20% of margin, anywhere on the grid');

select is(
  (select count(*)::int from grid
    where public.max_coin_discount_pkr(price, cost) > floor(0.10 * price)),
  0,
  'nor 10% of price');

select is(
  (select count(*)::int from grid where public.max_coin_discount_pkr(price, cost) < 0),
  0,
  'and is never negative');

-- ── the claim itself ───────────────────────────────────────────────────────
select is(
  (select count(*)::int from grid
    where (price - cost) - public.max_coin_discount_pkr(price, cost) < 0),
  0,
  '§3.3: gross profit per unit is never negative, at the maximum discount');

-- Not merely non-negative — at least 80% of the margin survives, because the
-- margin leg caps at 20% of it. That is the actual promise: a coin discount is
-- funded out of realised margin and can never eat all of it.
select is(
  (select count(*)::int from grid
    where public.max_coin_discount_pkr(price, cost) > 0.20 * (price - cost)),
  0,
  'at least 80% of gross margin always survives the discount');

-- ── the low-margin categories the brief is worried about ───────────────────
select is(
  (select count(*)::int from grid
    where margin_pct <= 8
      and public.max_coin_discount_pkr(price, cost) > 0.02 * price),
  0,
  'nothing at 8% margin or below can ever be discounted more than 2% of its price');

select ok(
  (select bool_and(public.max_coin_discount_pkr(price, cost) <= 0.10 * price) from grid),
  'and nothing at any margin exceeds 10% of price — the brief''s hard ceiling');

-- ── through the constraint, not just the function ──────────────────────────
-- The function could be right and the constraint still wrong. Push real rows in.
create temporary table fx (u uuid, o uuid);
insert into fx (u) values (tests.new_user());
update fx set o = tests.new_order(u);

do $$
declare
  g record;
  v_product uuid;
  v_order uuid := (select o from fx);
  v_cap int;
begin
  for g in select * from grid order by price, cost limit 60 loop
    v_product := tests.new_product(g.price, g.cost);
    v_cap := public.max_coin_discount_pkr(g.price, g.cost);

    -- At the cap: must be accepted.
    insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
    values (v_order, v_product, 1, g.price, g.cost, v_cap);

    -- One rupee over: must be rejected.
    begin
      insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
      values (v_order, v_product, 1, g.price, g.cost, v_cap + 1);
      raise exception 'the database accepted % on a % / % item, which is over the cap of %',
        v_cap + 1, g.price, g.cost, v_cap;
    exception when check_violation then
      null;  -- as it should be
    end;
  end loop;
end $$;

select ok(true, '60 real price/cost pairs accepted at the cap and rejected one rupee over');

select is(
  (select count(*)::int from public.order_items where order_id = (select o from fx)),
  60,
  'every line at the cap was accepted, and every line over it was not');

-- ── and the view agrees ────────────────────────────────────────────────────
select ok(
  (select bool_and(gross_profit_pkr >= 0) from public.order_economics),
  'order_economics reports non-negative gross profit on all sixty lines');

select ok(
  (select coin_discount_pkr <= 0.20 * (revenue_pkr - cogs_pkr) + 60 from public.order_economics
    where id = (select o from fx)),
  'and the total coin discount is within 20% of the order''s total margin');

select * from finish();
rollback;
