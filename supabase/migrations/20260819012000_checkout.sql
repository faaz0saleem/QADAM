-- README §7.5 — checkout. This is where §0 stops being a constraint and starts
-- being money.
--
-- THE SIGNATURE IS THE DESIGN. place_order takes product ids, quantities, an
-- address, and a boolean meaning "spend my coins if you can". It does not take a
-- discount, a coin count, a price, or a total, and it never will (§13.2). Every
-- number below is computed here, from the products table and from private
-- config the client cannot read.
--
-- A client that could name its own discount would make the order_items CHECK the
-- only thing standing between us and a loss. It is a good last line; it should
-- never be the first.

-- How much of a coin discount this line could fund, in whole PKR.
-- Zero for a category the brand has excluded — which is NOT how low-margin goods
-- are handled, since §0 already caps a phone near 1% on its own.
create or replace function private.line_discount_cap(p_product_id uuid, p_qty integer)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
           when not coalesce(c.coin_eligible, true) then 0
           else p_qty * public.max_coin_discount_pkr(p.price_pkr, p.cost_pkr)
         end
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.id = p_product_id
$$;

-- §7.4 — "On each product card, show the coin discount available to this user
-- right now, given their balance. Not a hypothetical maximum."
create or replace function public.my_discount_on(p_product_id uuid, p_qty integer default 1)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select least(
    coalesce(private.line_discount_cap(p_product_id, greatest(1, p_qty)), 0),
    case when public.can_redeem(auth.uid())
         then floor(public.coin_balance(auth.uid()) * private.cfg('COIN_VALUE_PKR'))::integer
         else 0 end
  )
$$;

comment on function public.my_discount_on(uuid, integer) is
  'The saving this user can actually make on this item today. Returns rupees, never '
  'a rate: §4 is explicit that the coin-to-rupee conversion is never published.';

-- ---------------------------------------------------------------------------
-- Placing an order
-- ---------------------------------------------------------------------------
create or replace function public.place_order(
  p_items          jsonb,                       -- [{"product_id": "...", "qty": 2}]
  p_address        text,
  p_phone          text,
  p_payment_method text default 'cod',
  p_use_coins      boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me         uuid := auth.uid();
  v_user       record;
  v_order_id   uuid;
  v_item       jsonb;
  v_product    record;
  v_qty        integer;
  v_subtotal   integer := 0;
  v_total_cap  integer := 0;
  v_discount   integer := 0;
  v_remaining  integer;
  v_take       integer;
  v_coins      integer;
  v_balance    integer;
  v_rate       numeric;
  v_line       record;
  v_refusals   integer;
  v_risk       integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_user from public.users where id = v_me;
  if v_user.status <> 'active' then
    raise exception 'this account cannot place orders' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'no items' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'too many items in one order' using errcode = 'check_violation';
  end if;

  -- §7.5 — a customer whose parcels keep coming back pays up front. The score is
  -- read here rather than trusted from anywhere.
  select count(*) into v_refusals
    from public.orders where user_id = v_me and status in ('refused', 'returned');
  v_risk := least(100, v_refusals * 25);

  if p_payment_method = 'cod' and v_risk >= private.cfg_int('COD_RISK_BLOCK_SCORE') then
    raise exception 'cash on delivery is not available on this account'
      using errcode = 'check_violation';
  end if;

  insert into public.orders (user_id, status, payment_method, address, phone, cod_risk_score)
  values (v_me, 'pending_confirmation', p_payment_method, p_address, p_phone, v_risk)
  returning id into v_order_id;

  -- Lines. price and cost are taken from the products table, never from input:
  -- an understated cost is an inflated §0 cap, which is the whole attack.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, coalesce((v_item ->> 'qty')::integer, 1));
    if v_qty > 10 then
      raise exception 'at most 10 of one item per order' using errcode = 'check_violation';
    end if;

    -- The row lock is what stops two checkouts selling the same last unit.
    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::uuid and is_active
     for update;

    if not found then
      raise exception 'product % is not available', v_item ->> 'product_id'
        using errcode = 'check_violation';
    end if;
    if v_product.stock < v_qty then
      raise exception 'only % of % left', v_product.stock, v_product.title
        using errcode = 'check_violation';
    end if;

    update public.products set stock = stock - v_qty where id = v_product.id;

    insert into public.order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr)
    values (v_order_id, v_product.id, v_qty, v_product.price_pkr, v_product.cost_pkr, 0);

    v_subtotal  := v_subtotal + v_qty * v_product.price_pkr;
    v_total_cap := v_total_cap + private.line_discount_cap(v_product.id, v_qty);
  end loop;

  -- ── the coin discount ────────────────────────────────────────────────────
  if p_use_coins
     and public.can_redeem(v_me)
     and v_subtotal >= private.cfg_int('MIN_ORDER_FOR_COINS_PKR')
  then
    v_rate    := private.cfg('COIN_VALUE_PKR');
    v_balance := public.coin_balance(v_me);

    -- floor(), so a fractional rupee of coin value is never rounded into a
    -- discount we did not fund. Rounding is always in the house's favour.
    v_discount := least(v_total_cap, floor(v_balance * v_rate)::integer);
  end if;

  if v_discount > 0 then
    -- Spread it across the lines, never past any line's own cap. The per-line
    -- CHECK would reject an over-allocation anyway; this is what makes sure it
    -- never has to.
    v_remaining := v_discount;
    for v_line in
      select oi.id, private.line_discount_cap(oi.product_id, oi.qty) as cap
        from public.order_items oi
       where oi.order_id = v_order_id
       order by cap desc, oi.id
    loop
      exit when v_remaining <= 0;
      v_take := least(v_line.cap, v_remaining);
      if v_take > 0 then
        update public.order_items set discount_pkr = v_take where id = v_line.id;
        v_remaining := v_remaining - v_take;
      end if;
    end loop;

    -- ceil(), so we never hand out more rupees than the coins paid for.
    v_coins := ceil(v_discount / v_rate)::integer;
    v_coins := least(v_coins, v_balance);

    -- §7.5 — debited to a pending state at placement. The debit stands until the
    -- order closes: converted to spent on delivery, and BURNED on refusal, which
    -- is the whole point. Never silently returned.
    perform private.spend_coins(v_me, v_coins, 'order_pending', v_order_id);

    update public.orders set discount_pkr = v_discount where id = v_order_id;
  end if;

  return jsonb_build_object(
    'order_id',     v_order_id,
    'subtotal_pkr', v_subtotal,
    'discount_pkr', v_discount,
    'coins_spent',  coalesce(v_coins, 0),
    'total_pkr',    (select total_pkr from public.orders where id = v_order_id),
    'coins_left',   public.coin_balance(v_me));
end $$;

comment on function public.place_order(jsonb, text, text, text, boolean) is
  'README §7.5. Takes product ids, quantities and a boolean meaning "spend my coins '
  'if you can". It does not take a discount, a coin count or a total, and it never '
  'will (§13.2) — every figure is computed here from products and private config.';

revoke all on function
  public.place_order(jsonb, text, text, text, boolean),
  public.my_discount_on(uuid, integer),
  private.line_discount_cap(uuid, integer)
from public, anon;

grant execute on function
  public.place_order(jsonb, text, text, text, boolean),
  public.my_discount_on(uuid, integer)
to authenticated;

grant execute on function private.line_discount_cap(uuid, integer) to service_role;
