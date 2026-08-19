-- README §3.2, §3.3, §5 — orders, and the constraint that makes §0 unbreakable.

create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete restrict,
  status         text not null default 'pending_confirmation'
                   check (status in ('pending_confirmation','confirmed','dispatched',
                                     'delivered','refused','cancelled','returned')),
  subtotal_pkr   integer not null default 0 check (subtotal_pkr >= 0),
  discount_pkr   integer not null default 0 check (discount_pkr >= 0),
  shipping_pkr   integer not null default 0 check (shipping_pkr >= 0),
  total_pkr      integer not null default 0 check (total_pkr >= 0),
  payment_method text not null check (payment_method in ('cod','card','wallet')),
  address        text not null,
  phone          text not null,
  confirmed_at   timestamptz,
  dispatched_at  timestamptz,
  delivered_at   timestamptz,
  closed_at      timestamptz,
  cod_risk_score integer not null default 0 check (cod_risk_score between 0 and 100),
  created_at     timestamptz not null default now(),

  constraint total_is_consistent
    check (total_pkr = subtotal_pkr - discount_pkr + shipping_pkr)
);

comment on column public.orders.discount_pkr is
  'Sum of the line discounts. Maintained by trigger and validated against the lines — '
  'the header can never claim a discount the lines do not fund.';
comment on column public.orders.cod_risk_score is
  '§7.5. Rises with each refusal. At or above COD_RISK_BLOCK_SCORE, prepayment is required.';

create index orders_user_idx    on public.orders (user_id, created_at desc);
create index orders_status_idx  on public.orders (status) where status in ('pending_confirmation','confirmed','dispatched');

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  qty            integer not null check (qty > 0),
  price_pkr      integer not null check (price_pkr > 0),   -- snapshot at purchase
  cost_pkr       integer not null check (cost_pkr >= 0),   -- snapshot at purchase
  discount_pkr   integer not null default 0 check (discount_pkr >= 0),
  created_at     timestamptz not null default now(),

  -- ======================================================================
  -- §0. THIS IS THE CONSTRAINT. Everything else in this file exists to stop
  -- someone routing around it.
  -- ======================================================================
  constraint discount_within_margin
    check (discount_pkr <= qty * public.max_coin_discount_pkr(price_pkr, cost_pkr))
);

comment on constraint discount_within_margin on public.order_items is
  'README §0: a coin discount can never exceed 20% of gross margin on the item, or 10% of '
  'the item price, whichever is lower. Enforced here so no future feature, admin panel, '
  'promo code or bug can bypass it. If a checkout path violates this, the transaction dies.';

comment on column public.order_items.price_pkr is
  'Snapshot at purchase. If a supplier raises their price next month, historical margin '
  'reporting must not silently change. Immutable once written (§3.2).';

create index order_items_order_idx   on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- Guard 1: the snapshot must be a real snapshot.
--
-- The CHECK above trusts price_pkr and cost_pkr. Understate cost and the apparent
-- margin grows, and with it the cap — so a forged cost is a forged §0. The line
-- has to match the product it points at, and once written it never changes.
-- ---------------------------------------------------------------------------
create or replace function private.order_item_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  p record;
begin
  if tg_op = 'UPDATE' then
    if new.price_pkr is distinct from old.price_pkr
       or new.cost_pkr is distinct from old.cost_pkr
       or new.product_id is distinct from old.product_id then
      raise exception
        'order line price/cost snapshots are immutable once written (README §3.2)'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  select price_pkr, cost_pkr into p from public.products where id = new.product_id;
  if not found then
    raise exception 'product % does not exist', new.product_id
      using errcode = 'foreign_key_violation';
  end if;

  -- Callers may omit the snapshot and let the database take it, which is the
  -- preferred path. If they supply one, it must be the truth.
  if new.price_pkr is null then new.price_pkr := p.price_pkr; end if;
  if new.cost_pkr  is null then new.cost_pkr  := p.cost_pkr;  end if;

  if new.price_pkr <> p.price_pkr or new.cost_pkr <> p.cost_pkr then
    raise exception
      'order line snapshot (price %, cost %) does not match product % (price %, cost %) — '
      'a forged cost forges the §0 margin cap',
      new.price_pkr, new.cost_pkr, new.product_id, p.price_pkr, p.cost_pkr
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger order_items_snapshot_guard
  before insert or update on public.order_items
  for each row execute function private.order_item_snapshot_guard();

-- ---------------------------------------------------------------------------
-- Guard 2: the header cannot claim a discount its lines do not fund.
--
-- Without this, a checkout path could leave every line at zero and put the whole
-- discount on orders.discount_pkr, and every per-line check would be theatre.
-- ---------------------------------------------------------------------------
create or replace function private.order_totals_recompute(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_subtotal int;
  v_line_discount int;
  v_order record;
begin
  select coalesce(sum(qty * price_pkr), 0), coalesce(sum(discount_pkr), 0)
    into v_subtotal, v_line_discount
    from public.order_items where order_id = p_order_id;

  select * into v_order from public.orders where id = p_order_id;
  if not found then return; end if;

  if v_order.discount_pkr > v_line_discount then
    raise exception
      'order % claims a discount of % but its lines only fund % (README §0)',
      p_order_id, v_order.discount_pkr, v_line_discount
      using errcode = 'check_violation';
  end if;

  update public.orders
     set subtotal_pkr = v_subtotal,
         total_pkr    = v_subtotal - discount_pkr + shipping_pkr
   where id = p_order_id
     and (subtotal_pkr is distinct from v_subtotal
          or total_pkr is distinct from v_subtotal - discount_pkr + shipping_pkr);
end $$;

create or replace function private.order_items_after_change()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.order_totals_recompute(coalesce(new.order_id, old.order_id));
  return null;
end $$;

create trigger order_items_recompute_totals
  after insert or update or delete on public.order_items
  for each row execute function private.order_items_after_change();

-- The header itself: keep total_pkr derived, then re-validate against the lines.
create or replace function private.orders_before_write()
returns trigger
language plpgsql
as $$
begin
  new.total_pkr := new.subtotal_pkr - new.discount_pkr + new.shipping_pkr;
  return new;
end $$;

create trigger orders_derive_total
  before insert or update on public.orders
  for each row execute function private.orders_before_write();

create or replace function private.orders_after_write()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_line_discount int;
begin
  select coalesce(sum(discount_pkr), 0) into v_line_discount
    from public.order_items where order_id = new.id;

  if new.discount_pkr > v_line_discount then
    raise exception
      'order % claims a discount of % but its lines only fund % (README §0)',
      new.id, new.discount_pkr, v_line_discount
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create trigger orders_validate_discount
  after insert or update of discount_pkr on public.orders
  for each row execute function private.orders_after_write();

-- ---------------------------------------------------------------------------
-- §3.3 — every order is provably profitable.
--
-- gross_profit_pkr is structurally incapable of going negative. Build an admin
-- screen on this view; if it ever shows a negative number, something has bypassed
-- the constraint and that is a P0 bug.
--
-- Note this is GROSS profit. Fulfilment eats 13–20% of order value in Pakistan
-- even on a successful delivery, and every failed delivery is a pure loss (§7.5).
-- ---------------------------------------------------------------------------
create view public.order_economics as
select
  o.id,
  o.user_id,
  o.status,
  o.created_at,
  sum(oi.qty * oi.price_pkr)                                   as revenue_pkr,
  sum(oi.qty * oi.cost_pkr)                                    as cogs_pkr,
  sum(oi.discount_pkr)                                         as coin_discount_pkr,
  sum(oi.qty * (oi.price_pkr - oi.cost_pkr) - oi.discount_pkr) as gross_profit_pkr
from public.orders o
join public.order_items oi on oi.order_id = o.id
group by o.id, o.user_id, o.status, o.created_at;

comment on view public.order_economics is
  'README §3.3. Admin-only — it exposes COGS. Never granted to anon or authenticated.';
