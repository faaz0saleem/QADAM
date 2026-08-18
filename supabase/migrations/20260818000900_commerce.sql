-- 20260818000900_commerce.sql
-- §7.4, §7.5: checkout and the COD lifecycle.

-- What a given user can actually save on a given product right now, given their
-- balance (§7.4: "Save PKR 180 with your coins", not "up to 10% off").
create or replace function affordable_discount_pkr(p_user uuid, p_product uuid, p_qty int default 1)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_ceiling  int;
  v_eligible boolean;
  v_wallet   int;
begin
  select max_coin_discount_pkr(p.price_pkr, p.cost_pkr) * p_qty,
         coalesce(c.coin_eligible, true)
    into v_ceiling, v_eligible
  from products p
  left join categories c on c.id = p.category_id
  where p.id = p_product;

  if v_ceiling is null or not v_eligible then
    return 0;
  end if;

  v_wallet := floor(coin_balance(p_user) * config_num('COIN_VALUE_PKR'))::int;
  return least(v_ceiling, v_wallet);
end
$$;

-- ==========================================================================
-- place_order
--
-- The client sends what it wants to buy and how many COINS it wants to spend.
-- It never sends a price, a cost, a discount or a balance (§13.2). Every rupee
-- below is derived here from the catalogue and from app_config.
--
-- p_items: [{"product_id": "...", "qty": 2}, ...]
-- ==========================================================================
create or replace function place_order(
  p_items          jsonb,
  p_address        jsonb,
  p_phone          text,
  p_payment_method text default 'cod',
  p_coins          int  default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user       uuid := auth.uid();
  v_order      uuid;
  v_coin_value numeric := config_num('COIN_VALUE_PKR');
  v_min_order  int     := config_int('MIN_ORDER_FOR_COINS_PKR');
  v_subtotal   int     := 0;
  v_cap_total  int     := 0;
  v_coins      int     := 0;
  v_discount   int     := 0;
  v_left       int;
  v_take       int;
  it           record;
  li           record;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'place_order: no items' using errcode = 'check_violation';
  end if;
  if coalesce(p_coins, 0) < 0 then
    raise exception 'place_order: coins cannot be negative' using errcode = 'check_violation';
  end if;

  insert into orders (user_id, subtotal_pkr, discount_pkr, shipping_pkr, total_pkr,
                      coins_spent, coin_value_pkr, payment_method, address, phone)
  values (v_user, 0, 0, 0, 0, 0, v_coin_value, p_payment_method, p_address, p_phone)
  returning id into v_order;

  -- Snapshot price, cost and coin-eligibility onto each line, and take stock.
  for it in
    select (e ->> 'product_id')::uuid as product_id,
           coalesce((e ->> 'qty')::int, 1) as qty
    from jsonb_array_elements(p_items) e
  loop
    if it.qty <= 0 then
      raise exception 'place_order: qty must be positive' using errcode = 'check_violation';
    end if;

    update products set stock = stock - it.qty
    where id = it.product_id and stock >= it.qty and source <> 'affiliate';
    if not found then
      raise exception 'place_order: product % is out of stock or not fulfilled by us', it.product_id
        using errcode = 'check_violation';
    end if;

    insert into order_items (order_id, product_id, qty, price_pkr, cost_pkr, coin_eligible)
    select v_order, p.id, it.qty, p.price_pkr, p.cost_pkr, coalesce(c.coin_eligible, true)
    from products p
    left join categories c on c.id = p.category_id
    where p.id = it.product_id;
  end loop;

  select coalesce(sum(qty * price_pkr), 0)::int,
         coalesce(sum(case when coin_eligible
                           then qty * max_coin_discount_pkr(price_pkr, cost_pkr)
                           else 0 end), 0)::int
    into v_subtotal, v_cap_total
  from order_items where order_id = v_order;

  -- How many coins may actually be spent here. Clamped by the wallet, by §0's
  -- ceiling across the whole basket, and by §4's minimum order value.
  if p_coins > 0 and v_subtotal >= v_min_order then
    -- ceil, not floor: flooring here and flooring again below loses a rupee off
    -- the ceiling, so the user could never quite reach the discount §0 allows.
    -- ceil overshoots by less than one coin's worth, and the least() below keeps
    -- the result inside the ceiling for any configured rate.
    v_coins := least(
      p_coins,
      coin_balance(v_user),
      ceil(v_cap_total / v_coin_value)::int
    );
  end if;

  v_discount := least(floor(v_coins * v_coin_value)::int, v_cap_total);

  -- Charge only for the coins the discount actually consumed, so a user is never
  -- debited for value they did not receive.
  if v_coins > 0 then
    v_coins := least(v_coins, ceil(v_discount / v_coin_value)::int);
  end if;

  -- Spread the discount across the lines, never exceeding any line's §0 ceiling.
  v_left := v_discount;
  for li in
    select id, qty, price_pkr, cost_pkr, coin_eligible,
           case when coin_eligible
                then qty * max_coin_discount_pkr(price_pkr, cost_pkr) else 0 end as line_cap
    from order_items
    where order_id = v_order
    order by (case when coin_eligible
                   then qty * max_coin_discount_pkr(price_pkr, cost_pkr) else 0 end) desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, li.line_cap);
    if v_take > 0 then
      update order_items set discount_pkr = v_take where id = li.id;
      v_left := v_left - v_take;
    end if;
  end loop;

  if v_left > 0 then
    -- Unreachable: v_discount is clamped to v_cap_total above. If it ever fires,
    -- the allocation and the clamp have drifted apart.
    raise exception 'place_order: could not place % PKR of discount within §0 ceilings', v_left
      using errcode = 'check_violation';
  end if;

  if v_coins > 0 then
    perform spend_coins(v_user, v_coins, 'order_hold', v_order);
  end if;

  update orders
  set subtotal_pkr = v_subtotal,
      discount_pkr = v_discount,
      coins_spent  = v_coins,
      total_pkr    = v_subtotal - v_discount + shipping_pkr
  where id = v_order;

  return v_order;
end
$$;

-- ==========================================================================
-- §7.5 order lifecycle.
--
--   delivered -> the hold becomes final. Nothing to write.
--   refused   -> the coins are BURNED. Also nothing to write — the burn is the
--                absence of a refund, and it is why the user has skin in the
--                game at the door.
--   cancelled -> only before dispatch, and only then are coins returned.
-- ==========================================================================
create or replace function set_order_status(p_order uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype;
begin
  select * into o from orders where id = p_order for update;
  if not found then
    raise exception 'set_order_status: no such order %', p_order using errcode = 'no_data_found';
  end if;

  if o.status in ('delivered','refused','cancelled','returned') then
    raise exception 'order % is already closed (%)', p_order, o.status
      using errcode = 'check_violation';
  end if;

  -- §7.5: never dispatch an unconfirmed COD order above PKR 3,000.
  if p_status = 'dispatched'
     and o.payment_method = 'cod'
     and o.total_pkr > 3000
     and o.confirmed_at is null then
    raise exception
      'order % is COD for % PKR and has not been confirmed on WhatsApp (§7.5)',
      p_order, o.total_pkr
      using errcode = 'check_violation';
  end if;

  if p_status = 'cancelled' then
    if o.status in ('dispatched') then
      raise exception 'order % has already been dispatched; it can be refused or returned, not cancelled', p_order
        using errcode = 'check_violation';
    end if;
    -- Cancelled before it ever left: the hold was never consumed, so give it back.
    perform refund_order_coins(p_order);
    -- Stock returns too.
    update products p set stock = p.stock + oi.qty
    from order_items oi where oi.order_id = p_order and oi.product_id = p.id;
  end if;

  update orders
  set status        = p_status,
      confirmed_at  = case when p_status = 'confirmed'  then now() else confirmed_at end,
      dispatched_at = case when p_status = 'dispatched' then now() else dispatched_at end,
      delivered_at  = case when p_status = 'delivered'  then now() else delivered_at end,
      closed_at     = case when p_status in ('delivered','refused','cancelled','returned')
                           then now() else closed_at end,
      -- §7.5 a per-customer score that rises with each refusal
      cod_risk_score = case when p_status in ('refused','returned')
                            then cod_risk_score + 1 else cod_risk_score end
  where id = p_order;

  if p_status = 'refused' then
    -- The coins are gone. Deliberately no refund call anywhere here (§7.5) —
    -- the burn IS the absence of one.
    insert into fraud_events (user_id, kind, detail)
    values (o.user_id, 'delivery_refused',
            jsonb_build_object('order_id', p_order, 'total_pkr', o.total_pkr,
                               'coins_burned', o.coins_spent));

    -- Counted after the status is written, so this order counts as one of them.
    update users set status = 'flagged'
    where id = o.user_id
      and status = 'active'
      and (select count(*) from orders
           where user_id = o.user_id and status = 'refused') >= 2;
  end if;
end
$$;

-- §7.5: RTO is a first-class metric next to revenue. Target under 12%.
create view fulfilment_health with (security_invoker = true) as
select
  date_trunc('week', created_at)::date                                     as week,
  count(*) filter (where status in ('delivered','refused','returned'))     as closed_orders,
  count(*) filter (where status in ('refused','returned'))                 as rto_orders,
  round(100.0 * count(*) filter (where status in ('refused','returned'))
        / nullif(count(*) filter (where status in ('delivered','refused','returned')), 0), 1)
                                                                          as rto_pct,
  sum(total_pkr) filter (where status = 'delivered')                       as delivered_value_pkr,
  sum(coins_spent) filter (where status = 'refused')                       as coins_burned
from orders
group by 1
order by 1 desc;

-- §7.7: referral coins pay on the referee's FIRST COMPLETED PURCHASE, not install.
create or replace function pay_referral_on_first_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_referrer uuid;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then
    return null;
  end if;

  select referred_by into v_referrer from users where id = new.user_id;
  if v_referrer is null then
    return null;
  end if;

  -- first delivered order only
  if exists (
    select 1 from orders
    where user_id = new.user_id and status = 'delivered' and id <> new.id
  ) then
    return null;
  end if;

  perform credit_coins(v_referrer,  config_int('REFERRAL_COINS_REFERRER'), 'referral_referrer');
  perform credit_coins(new.user_id, config_int('REFERRAL_COINS_REFEREE'),  'referral_referee');
  return null;
end
$$;

create trigger orders_pay_referral
  after update of status on orders
  for each row execute function pay_referral_on_first_delivery();
