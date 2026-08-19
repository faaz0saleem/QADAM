-- 20260818999850_operational_fixes.sql
--
-- Three smaller things found in the same pass.
--
-- Numbered to run after ..._close_attestation_bypass.sql, which also defines
-- submit_steps: a CREATE OR REPLACE in an earlier migration is simply overwritten
-- by a later one, and the version that ships is whichever runs last.

-- ==========================================================================
-- 1. A returned parcel comes back to us, so the stock comes back too.
--
-- Stock is decremented at placement. Cancellation already restored it, but a
-- refusal or an RTO did not — so every failed delivery permanently lost a unit
-- from the catalogue count. At the 18–20% national RTO rate (§7.5) that is one
-- unit in five, and the first symptom is the shop showing "out of stock" for
-- something sitting on the shelf.
--
-- Note this is about the goods, not the coins. §7.5 still burns the coins on a
-- refusal; the two are independent and must stay that way.
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
    if o.status = 'dispatched' then
      raise exception
        'order % has already been dispatched; it can be refused or returned, not cancelled',
        p_order using errcode = 'check_violation';
    end if;
    -- Cancelled before it ever left: the hold was never consumed, so give it back.
    perform refund_order_coins(p_order);
  end if;

  -- The goods return to us on any failed outcome.
  if p_status in ('cancelled','refused','returned') then
    update products p set stock = p.stock + oi.qty
    from order_items oi
    where oi.order_id = p_order and oi.product_id = p.id;
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

-- ==========================================================================
-- 2. A client should not be able to label its steps as coming from an admin.
--
-- daily_steps.source admits 'admin' for manual corrections. submit_steps took
-- the source as free text, so a client could write rows that look like ours.
-- Nothing downstream trusts the value today, but a fraud investigation reading
-- 'admin' on a row nobody at the company wrote is the kind of thing that costs
-- an afternoon.
-- ==========================================================================
create or replace function submit_steps(
  p_date   date,
  p_raw    int,
  p_source text
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_source not in ('health_connect','healthkit') then
    raise exception 'unknown step source' using errcode = 'check_violation';
  end if;

  -- p_attested is hardcoded false and there is no argument for it. Minting
  -- happens through ingest-steps, which verifies a real token, or not at all.
  return award_steps(v_user, p_date, p_raw, p_source, false, '{}');
end
$$;

revoke all on function submit_steps(date, int, text) from public, anon, authenticated;
grant execute on function submit_steps(date, int, text) to authenticated;

-- ==========================================================================
-- 3. A negative quantity produced a negative discount in the shop preview.
--    Cosmetic — place_order rejects the order anyway — but it would render as
--    "Save PKR -300 with your coins".
-- ==========================================================================
create or replace function affordable_discount_pkr(p_user uuid, p_product uuid, p_qty int default 1)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_ceiling  int;
  v_eligible boolean;
  v_wallet   int;
  v_created  timestamptz;
  v_qty      int := greatest(coalesce(p_qty, 1), 1);
begin
  perform assert_self(p_user);

  select max_coin_discount_pkr(p.price_pkr, p.cost_pkr) * v_qty,
         coalesce(c.coin_eligible, true)
    into v_ceiling, v_eligible
  from products p
  left join categories c on c.id = p.category_id
  where p.id = p_product;

  if v_ceiling is null or not v_eligible then
    return 0;
  end if;

  select created_at into v_created from users where id = p_user;
  if v_created is null
     or v_created > now() - make_interval(days => config_int('REDEMPTION_LOCK_DAYS')) then
    return 0;
  end if;

  v_wallet := floor(coin_balance(p_user) * config_num('COIN_VALUE_PKR'))::int;
  return greatest(0, least(v_ceiling, v_wallet));
end
$$;
