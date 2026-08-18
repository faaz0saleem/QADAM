-- 20260818000500_orders.sql
-- §3.2, §3.3, §5, §7.5: orders, order_items, and the two levels at which §0 is enforced.

create table orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete restrict,
  status         text not null default 'placed' check (status in (
                   'placed','confirmed','dispatched','delivered',
                   'refused','cancelled','returned')),
  subtotal_pkr   integer not null default 0 check (subtotal_pkr >= 0),
  discount_pkr   integer not null default 0 check (discount_pkr >= 0),
  shipping_pkr   integer not null default 0 check (shipping_pkr >= 0),
  total_pkr      integer not null default 0 check (total_pkr >= 0),
  coins_spent    integer not null default 0 check (coins_spent >= 0),
  -- §4's COIN_VALUE_PKR snapshotted at placement. Snapshotting it is what lets
  -- the discount/coins relationship be a CHECK constraint: tuning the live rate
  -- next week must not retroactively invalidate an order placed today.
  coin_value_pkr numeric(10,4) not null default 0 check (coin_value_pkr >= 0),
  payment_method text not null check (payment_method in ('cod','card','wallet')),
  address        jsonb not null,
  phone          text not null,
  confirmed_at   timestamptz,
  dispatched_at  timestamptz,
  delivered_at   timestamptz,
  closed_at      timestamptz,
  cod_risk_score numeric(6,2) not null default 0 check (cod_risk_score >= 0),
  created_at     timestamptz not null default now(),

  constraint total_is_consistent
    check (total_pkr = subtotal_pkr - discount_pkr + shipping_pkr),

  -- Every rupee of discount is backed by coins actually debited from the ledger,
  -- at the rate snapshotted above. floor() keeps rounding in the house's favour.
  constraint discount_is_coin_backed
    check (discount_pkr = floor(coins_spent * coin_value_pkr)::int)
);

create index orders_user_idx    on orders (user_id, created_at desc);
create index orders_status_idx  on orders (status) where status in ('placed','confirmed','dispatched');

comment on column orders.coins_spent is
  '§7.5: coins are debited at placement (a hold), become final on delivery, and are '
  'BURNED on refusal — never silently returned. The burn is simply the absence of a '
  'refund row in coin_ledger.';

create table order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  product_id    uuid not null references products(id) on delete restrict,
  qty           integer not null check (qty > 0),
  price_pkr     integer not null check (price_pkr > 0),   -- snapshot at purchase
  cost_pkr      integer not null check (cost_pkr >= 0),   -- snapshot at purchase
  discount_pkr  integer not null default 0 check (discount_pkr >= 0),
  -- snapshot of categories.coin_eligible, so the flag stays enforceable as a
  -- row-level CHECK rather than a cross-table lookup
  coin_eligible boolean not null default true,

  -- mirrors products.price_above_cost so a snapshot can never describe a line
  -- the catalogue itself would have rejected
  constraint item_price_above_cost check (price_pkr > cost_pkr),

  -- ======================================================================
  -- §0, LEVEL 1 — per item. This is the constraint the whole business rests
  -- on. It is a CHECK, not application logic: no admin panel, promo code,
  -- migration or bug can write a line that violates it, and it applies to
  -- UPDATEs exactly as it applies to INSERTs.
  -- ======================================================================
  constraint discount_within_margin
    check (discount_pkr <= qty * max_coin_discount_pkr(price_pkr, cost_pkr)),

  constraint no_discount_when_ineligible
    check (coin_eligible or discount_pkr = 0)
);

create index order_items_order_idx   on order_items (order_id);
create index order_items_product_idx on order_items (product_id);

-- ==========================================================================
-- §0, LEVEL 2 — per order.
--
-- The per-item CHECK guards each line, but orders.total_pkr is what actually
-- gets charged and orders.discount_pkr is a separate, unguarded column. A
-- checkout path that wrote a huge order-level discount would produce a loss
-- without ever touching an order_item. So the order header is re-derived from
-- its items at COMMIT and refused if it disagrees, or if the order as a whole
-- would book a gross loss.
--
-- A DEFERRABLE CONSTRAINT TRIGGER, not a CHECK: the invariant spans rows, and
-- checkout legitimately writes the header and the items in either order within
-- one transaction.
-- ==========================================================================
create or replace function assert_order_invariants() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid;
  o          orders%rowtype;
  agg        record;
begin
  if tg_table_name = 'orders' then
    v_order_id := coalesce(new.id, old.id);
  else
    v_order_id := coalesce(new.order_id, old.order_id);
  end if;

  select * into o from orders where id = v_order_id;
  if not found then
    return null;  -- order removed in this same transaction; nothing left to check
  end if;

  select
    coalesce(sum(qty * price_pkr), 0)::int                            as subtotal_pkr,
    coalesce(sum(discount_pkr), 0)::int                               as discount_pkr,
    coalesce(sum(qty * (price_pkr - cost_pkr) - discount_pkr), 0)::int as gross_profit_pkr,
    count(*)                                                          as line_count
  into agg
  from order_items
  where order_id = v_order_id;

  if agg.line_count = 0 then
    if o.subtotal_pkr <> 0 or o.discount_pkr <> 0 then
      raise exception
        'order % has no items but a subtotal of % and a discount of %',
        v_order_id, o.subtotal_pkr, o.discount_pkr
        using errcode = 'check_violation';
    end if;
    return null;
  end if;

  if o.subtotal_pkr <> agg.subtotal_pkr then
    raise exception
      'order % subtotal_pkr is % but its items total %',
      v_order_id, o.subtotal_pkr, agg.subtotal_pkr
      using errcode = 'check_violation';
  end if;

  if o.discount_pkr <> agg.discount_pkr then
    raise exception
      'order % discount_pkr is % but its item discounts total % (§0)',
      v_order_id, o.discount_pkr, agg.discount_pkr
      using errcode = 'check_violation';
  end if;

  -- The statement of §0 at order level. Structurally unreachable while the
  -- per-item CHECK holds and the header matches its items — which is exactly
  -- why tripping it means something has bypassed the constraint (§3.3, P0).
  if agg.gross_profit_pkr < 0 then
    raise exception
      'order % would book a gross loss of % PKR — §0 violated',
      v_order_id, agg.gross_profit_pkr
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

create constraint trigger orders_invariants
  after insert or update on orders
  deferrable initially deferred
  for each row execute function assert_order_invariants();

create constraint trigger order_items_invariants
  after insert or update or delete on order_items
  deferrable initially deferred
  for each row execute function assert_order_invariants();

-- §3.3, verbatim. gross_profit_pkr is structurally incapable of going negative;
-- an admin screen renders this, and a negative number here is a P0.
create view order_economics with (security_invoker = true) as
select
  o.id,
  sum(oi.qty * oi.price_pkr)                                   as revenue_pkr,
  sum(oi.qty * oi.cost_pkr)                                    as cogs_pkr,
  sum(oi.discount_pkr)                                         as coin_discount_pkr,
  sum(oi.qty * (oi.price_pkr - oi.cost_pkr) - oi.discount_pkr) as gross_profit_pkr
from orders o
join order_items oi on oi.order_id = o.id
group by o.id;
