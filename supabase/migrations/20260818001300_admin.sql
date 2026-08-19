-- 20260818001300_admin.sql
-- §3.3 — the admin view, and the alarm that goes with it.

-- §3.3: "Build an admin screen that shows this view. If it ever shows a
-- negative number, something has bypassed the constraint and that is a P0 bug."
--
-- This is that alarm as a query. It should always return zero rows. If it ever
-- returns one, stop and find out how — do not "fix" the order.
create view margin_breaches with (security_invoker = true) as
select
  oe.id                as order_id,
  o.created_at,
  o.status,
  oe.revenue_pkr,
  oe.cogs_pkr,
  oe.coin_discount_pkr,
  oe.gross_profit_pkr
from order_economics oe
join orders o on o.id = oe.id
where oe.gross_profit_pkr < 0;

comment on view margin_breaches is
  '§3.3 P0 alarm. Always empty while §0 holds. A row here means a constraint '
  'has been bypassed; investigate the write path, do not adjust the order.';

-- Outstanding coins are a real liability: every unexpired coin is a discount we
-- have already promised. §0 caps what any one order can absorb, so this can
-- never become a loss — but it is still the number that says how much margin is
-- committed, and it is what a coin-economy tuning decision should be made
-- against rather than by feel.
create view coin_liability with (security_invoker = true) as
select
  count(distinct cl.user_id)                                        as holders,
  coalesce(sum(cl.delta), 0)::bigint                                as coins_outstanding,
  floor(coalesce(sum(cl.delta), 0) * config_num('COIN_VALUE_PKR'))::bigint
                                                                    as max_discount_pkr,
  coalesce(sum(cl.delta) filter (where cl.expires_at < now() + interval '30 days'), 0)::bigint
                                                                    as expiring_within_30d
from coin_ledger cl
where cl.expires_at > now();

comment on view coin_liability is
  'Server-side only: it derives from COIN_VALUE_PKR, which §4 forbids publishing.';

-- What the catalogue can actually discount, by category. The number a buying
-- decision should be made against.
create view catalogue_margins with (security_invoker = true) as
select
  coalesce(c.name, 'Uncategorised')                                  as category,
  count(*)                                                           as products,
  sum(p.stock)                                                       as units_in_stock,
  round(avg(100.0 * (p.price_pkr - p.cost_pkr) / p.price_pkr), 1)    as avg_margin_pct,
  round(avg(100.0 * max_coin_discount_pkr(p.price_pkr, p.cost_pkr)
            / p.price_pkr), 1)                                       as avg_max_discount_pct
from products p
left join categories c on c.id = p.category_id
group by 1
order by 5 desc;
