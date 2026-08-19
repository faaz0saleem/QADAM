-- README §7.5 — the cash-on-delivery lifecycle.
--
-- "This will decide whether the business makes money. The national
--  return-to-origin rate is 18–20% — one parcel in five comes back undelivered,
--  costing shipping both ways with zero revenue. The industry's own diagnosis:
--  the customer has no skin in the game before the product arrives.
--
--  We have skin in the game. It's called coins."
--
-- So the rule, and it is the whole reason the ledger works the way it does:
--
--   placement  → coins are debited, pending
--   delivery   → the debit simply stands. They are spent.
--   REFUSAL    → the debit also stands. They are BURNED.
--   cancelled before dispatch → and only then, they come back
--
-- Nothing is "converted" on delivery and nothing is written on refusal, because
-- the coins already left at placement. That is what makes an append-only ledger
-- the right shape for this: the states are properties of the ORDER, and the
-- money moved once.

-- ---------------------------------------------------------------------------
-- The one place coins come back
-- ---------------------------------------------------------------------------
create or replace function private.reverse_order_coins(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  d       record;
  v_total integer := 0;
begin
  for d in
    select l.id, l.user_id, l.delta, l.consumes_id, b.expires_at
      from public.coin_ledger l
      join public.coin_ledger b on b.id = l.consumes_id
     where l.order_id = p_order_id and l.reason = 'order_pending'
  loop
    -- Returned with the ORIGINAL expiry, not a fresh ninety days. Cancelling an
    -- order is not a way to launder coins into a longer life.
    insert into public.coin_ledger (user_id, delta, reason, expires_at, order_id, meta)
    values (d.user_id, -d.delta, 'order_reversal', d.expires_at, p_order_id,
            jsonb_build_object('reverses', d.id));
    v_total := v_total - d.delta;
  end loop;

  return v_total;
end $$;

create or replace function private.restock_order(p_order_id uuid)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$
  update public.products p
     set stock = p.stock + oi.qty
    from public.order_items oi
   where oi.order_id = p_order_id and oi.product_id = p.id
$$;

-- ---------------------------------------------------------------------------
-- Moving an order along. Admin and courier webhooks only — a client cannot mark
-- its own parcel delivered, which would be a free discount and a free parcel.
-- ---------------------------------------------------------------------------
create or replace function private.set_order_status(p_order_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_order   record;
  v_allowed boolean;
  v_burned  integer := 0;
  v_returned integer := 0;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'no such order' using errcode = 'no_data_found';
  end if;

  -- A parcel does not go from delivered back to dispatched, and a refused one
  -- does not quietly become delivered later.
  v_allowed := case
    when v_order.status = 'pending_confirmation' and p_to in ('confirmed', 'cancelled') then true
    when v_order.status = 'confirmed'  and p_to in ('dispatched', 'cancelled') then true
    when v_order.status = 'dispatched' and p_to in ('delivered', 'refused', 'returned') then true
    else false
  end;

  if not v_allowed then
    raise exception 'an order cannot go from % to %', v_order.status, p_to
      using errcode = 'check_violation';
  end if;

  -- §7.5 — no COD order above the threshold is dispatched without a
  -- confirmation. The gate is here rather than in the dispatch tooling, so a
  -- new courier integration cannot forget it.
  if p_to = 'dispatched'
     and v_order.payment_method = 'cod'
     and v_order.total_pkr > private.cfg_int('COD_CONFIRM_THRESHOLD_PKR')
     and v_order.confirmed_at is null
  then
    raise exception
      'COD order % is over the confirmation threshold and has not been confirmed (§7.5)',
      p_order_id using errcode = 'check_violation';
  end if;

  update public.orders
     set status        = p_to,
         confirmed_at  = case when p_to = 'confirmed'  then now() else confirmed_at end,
         dispatched_at = case when p_to = 'dispatched' then now() else dispatched_at end,
         delivered_at  = case when p_to = 'delivered'  then now() else delivered_at end,
         closed_at     = case when p_to in ('delivered','refused','cancelled','returned')
                              then now() else closed_at end
   where id = p_order_id;

  if p_to = 'cancelled' then
    -- The only path where coins come back: nothing has shipped, nothing has
    -- been risked, and the customer has not refused anything.
    v_returned := private.reverse_order_coins(p_order_id);
    perform private.restock_order(p_order_id);

  elsif p_to in ('refused', 'returned') then
    -- The coins are gone. The debit written at placement simply stands, and this
    -- is the entire mechanism: someone who refuses a parcel loses what they
    -- walked three months for, at zero rupee cost to them.
    select coalesce(-sum(delta), 0) into v_burned
      from public.coin_ledger where order_id = p_order_id and reason = 'order_pending';
    perform private.restock_order(p_order_id);

    -- §7.5 — the score rises with each refusal.
    update public.users u
       set status = u.status
     where u.id = v_order.user_id;
    update public.orders o
       set cod_risk_score = least(100, (
             select count(*) * 25 from public.orders x
              where x.user_id = v_order.user_id and x.status in ('refused','returned')))
     where o.user_id = v_order.user_id and o.closed_at is null;
  end if;

  -- delivery writes nothing to the ledger. The coins left at placement; they are
  -- spent now, and "spent" is a fact about this order rather than a row.

  return jsonb_build_object(
    'order_id', p_order_id, 'status', p_to,
    'coins_burned', v_burned, 'coins_returned', v_returned);
end $$;

comment on function private.set_order_status(uuid, text) is
  'README §7.5. The only way an order changes state. Coins come back on cancellation '
  'and on nothing else — a refused parcel burns them, which is the skin in the game '
  'that the whole COD model rests on.';

-- What the wallet and the order list need to show about coins on an order.
create or replace function public.order_coin_state(p_order_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
           when o.user_id <> auth.uid() then null
           when not exists (select 1 from public.coin_ledger l
                             where l.order_id = o.id and l.reason = 'order_pending') then 'none'
           when o.status in ('refused', 'returned')  then 'burned'
           when o.status = 'cancelled'               then 'returned'
           when o.status = 'delivered'               then 'spent'
           else 'pending'
         end
    from public.orders o where o.id = p_order_id
$$;

-- A customer can call off an order that has not shipped. That is the only state
-- change they may make, and it is the only one that gives coins back.
create or replace function public.cancel_my_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_order record;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.user_id <> auth.uid() then
    raise exception 'no such order' using errcode = 'no_data_found';
  end if;
  if v_order.status not in ('pending_confirmation', 'confirmed') then
    raise exception 'this order has already been dispatched' using errcode = 'check_violation';
  end if;
  return private.set_order_status(p_order_id, 'cancelled');
end $$;

create or replace function public.my_orders()
returns table (
  id uuid, status text, created_at timestamptz,
  subtotal_pkr integer, discount_pkr integer, shipping_pkr integer, total_pkr integer,
  item_count integer, coin_state text
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select o.id, o.status, o.created_at,
         o.subtotal_pkr, o.discount_pkr, o.shipping_pkr, o.total_pkr,
         (select coalesce(sum(oi.qty), 0)::integer from public.order_items oi where oi.order_id = o.id),
         public.order_coin_state(o.id)
    from public.orders o
   where o.user_id = auth.uid()
   order by o.created_at desc
$$;

-- Service wrappers, for the admin tools and courier webhooks.
create or replace function public.set_order_status(p_order_id uuid, p_to text)
returns jsonb
language sql
security definer
set search_path = public, private, pg_temp
as $$ select private.set_order_status(p_order_id, p_to) $$;

revoke all on function
  private.set_order_status(uuid, text),
  private.reverse_order_coins(uuid),
  private.restock_order(uuid),
  public.set_order_status(uuid, text)
from public, anon, authenticated;

revoke all on function
  public.cancel_my_order(uuid),
  public.my_orders(),
  public.order_coin_state(uuid)
from public, anon;

grant execute on function
  public.cancel_my_order(uuid), public.my_orders(), public.order_coin_state(uuid)
to authenticated;

grant execute on function
  public.set_order_status(uuid, text),
  private.set_order_status(uuid, text),
  private.reverse_order_coins(uuid),
  private.restock_order(uuid)
to service_role;
