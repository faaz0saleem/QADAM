-- 20260818999860_account_deletion.sql
-- docs/OPERATIONS.md §1.2 — "In-app account deletion is mandatory for any app
-- with account creation. Build it in Phase 1 regardless of platform — Google
-- requires it too."
--
-- The interesting part is that coin_ledger is append-only by trigger (§5), so a
-- cascading hard delete is refused by design. That is the correct behaviour: a
-- ledger that can be erased is not a ledger. It also means deletion here has to
-- mean something more precise than DELETE.
--
-- What we do:
--   * erase everything personal — name, city, phone, device hash, health data,
--     behavioural analytics, social graph, push tokens
--   * keep the financial record, with the person scrubbed out of it. Orders and
--     ledger rows survive as anonymous accounting entries, which is what both
--     the tax position and §3.3's margin reporting need
--   * mark the account deleted so it can never sign in, earn or spend again
--
-- Deleting the auth row itself is the Edge Function's job, because only
-- service_role can, and it can only succeed for an account with no ledger
-- history. Everything below runs first either way.
--
-- Numbered to run after ..._operational_fixes.sql, which is the last other file
-- to define submit_steps. A CREATE OR REPLACE in an earlier migration is simply
-- overwritten by a later one.

create or replace function delete_my_account()
returns table (deleted_at timestamptz, ledger_rows_retained bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_user   uuid := auth.uid();
  v_ledger bigint;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from users where id = v_user for update;

  -- Health data. The most sensitive thing we hold, and nothing downstream needs
  -- it once the account is gone: leaderboard snapshots are rebuilt from scratch
  -- on the next refresh.
  delete from daily_steps      where user_id = v_user;
  delete from leaderboard_snap where user_id = v_user;

  -- Behaviour. docs/METRICS.md's cohorts lose one member; that is the correct
  -- trade against holding a deleted user's habits.
  delete from analytics_events where user_id = v_user;

  -- Social graph, in both directions.
  delete from friendships  where user_id = v_user or friend_id = v_user;
  delete from team_members where user_id = v_user;

  -- Reachability.
  delete from push_tokens   where user_id = v_user;
  delete from notifications where user_id = v_user;
  delete from notify_me     where user_id = v_user;

  -- A team whose captain leaves is handed to its longest-standing member rather
  -- than deleted — the other members did not ask to lose their team.
  update teams t
  set captain_id = (
    select tm.user_id from team_members tm
    where tm.team_id = t.id and tm.user_id <> v_user
    order by tm.joined_at limit 1
  )
  where t.captain_id = v_user
    and exists (select 1 from team_members tm where tm.team_id = t.id and tm.user_id <> v_user);

  delete from teams where captain_id = v_user;

  select count(*) into v_ledger from coin_ledger where user_id = v_user;

  -- Scrub the person out of the row that the financial records point at. The
  -- phone is replaced rather than nulled because it is NOT NULL and UNIQUE, and
  -- because freeing the number for reuse would let a deleted account's history
  -- be re-attached to whoever gets that number next.
  update users
  set name          = null,
      city          = null,
      device_hash   = null,
      referred_by   = null,
      referral_code = null,
      phone         = 'deleted:' || id::text,
      status        = 'deleted'
  where id = v_user;

  return query select now(), v_ledger;
end
$$;

comment on function delete_my_account() is
  'docs/OPERATIONS.md §1.2. Erases everything personal and keeps the financial '
  'record anonymised — coin_ledger is append-only and must stay intact.';

-- A deleted account must not be able to do anything, even if a session token is
-- still alive somewhere. The status check belongs next to each action rather
-- than only at sign-in.
create or replace function assert_active(p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
begin
  select status into v_status from users where id = p_user;
  if v_status is null or v_status = 'deleted' then
    raise exception 'this account has been deleted' using errcode = 'insufficient_privilege';
  end if;
end
$$;

revoke all on function assert_active(uuid) from public, anon, authenticated;

-- The two doors that matter. Steps already refuse a suspended account; a
-- deleted one must be refused everywhere.
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
  perform assert_active(v_user);
  if p_source not in ('health_connect','healthkit') then
    raise exception 'unknown step source' using errcode = 'check_violation';
  end if;
  return award_steps(v_user, p_date, p_raw, p_source, false, '{}');
end
$$;

revoke all on function submit_steps(date, int, text) from public, anon, authenticated;
grant execute on function submit_steps(date, int, text) to authenticated;

-- place_order is the other door. A deleted account must not be able to spend
-- coins its ledger still shows, or take stock off a shelf.
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
  perform assert_active(v_user);
  perform assert_basket_is_sane(p_items);
  if coalesce(p_coins, 0) < 0 then
    raise exception 'place_order: coins cannot be negative' using errcode = 'check_violation';
  end if;

  insert into orders (user_id, subtotal_pkr, discount_pkr, shipping_pkr, total_pkr,
                      coins_spent, coin_value_pkr, payment_method, address, phone)
  values (v_user, 0, 0, 0, 0, 0, v_coin_value, p_payment_method, p_address, p_phone)
  returning id into v_order;

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

  if p_coins > 0 and v_subtotal >= v_min_order then
    v_coins := least(p_coins, coin_balance(v_user), ceil(v_cap_total / v_coin_value)::int);
  end if;

  v_discount := least(floor(v_coins * v_coin_value)::int, v_cap_total);
  if v_coins > 0 then
    v_coins := least(v_coins, ceil(v_discount / v_coin_value)::int);
  end if;

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

revoke all on function place_order(jsonb, jsonb, text, text, int) from public, anon, authenticated;
grant execute on function place_order(jsonb, jsonb, text, text, int) to authenticated;
