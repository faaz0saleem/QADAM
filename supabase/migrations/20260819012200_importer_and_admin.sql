-- README §8.4 — the consignment importer, and §3.3 — the economics report.
--
-- "Brands who sign with us will hand over their own photos and specs, usually as
--  a spreadsheet or a Drive folder. Build a bulk importer that takes a CSV with
--  title, price, cost, stock, images[] and validates price > cost on every row.
--  This is where the real catalogue comes from."
--
-- The design point is that a brand's spreadsheet is always partly wrong. An
-- importer that rejects the whole file because row 43 has a missing cost turns
-- ten minutes back into a day. So each row is judged on its own and the failures
-- come back with reasons, ready to be handed to the brand.

create or replace function private.import_products(p_brand_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  r          jsonb;
  v_title    text;
  v_price    integer;
  v_cost     integer;
  v_stock    integer;
  v_images   jsonb;
  v_category uuid;
  v_imported integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_row      integer := 0;
  v_reason   text;
begin
  if not exists (select 1 from public.brands where id = p_brand_id) then
    raise exception 'no such brand' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = 'check_violation';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_row := v_row + 1;
    v_reason := null;

    v_title := nullif(btrim(coalesce(r ->> 'title', '')), '');
    v_price := nullif(regexp_replace(coalesce(r ->> 'price', ''), '[^0-9-]', '', 'g'), '')::integer;
    v_cost  := nullif(regexp_replace(coalesce(r ->> 'cost', ''), '[^0-9-]', '', 'g'), '')::integer;
    v_stock := coalesce(nullif(regexp_replace(coalesce(r ->> 'stock', ''), '[^0-9-]', '', 'g'), '')::integer, 0);

    -- Every rejection names the row and the reason, because the person fixing
    -- it is a brand owner looking at their own spreadsheet, not a developer.
    if v_title is null then
      v_reason := 'no title';
    elsif v_price is null or v_cost is null then
      v_reason := 'price and cost are both required';
    elsif v_price <= 0 then
      v_reason := 'price must be above zero';
    elsif v_cost < 0 then
      v_reason := 'cost cannot be negative';
    elsif v_price <= v_cost then
      -- §0's premise. An item that cannot be sold above cost cannot fund a
      -- discount, and stocking it at a loss is how the app dies faster the more
      -- successful it gets.
      v_reason := format('price %s is not above cost %s', v_price, v_cost);
    elsif v_stock < 0 then
      v_reason := 'stock cannot be negative';
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object(
        'row', v_row, 'title', coalesce(v_title, r ->> 'title'), 'reason', v_reason);
      continue;
    end if;

    v_images := case
      when jsonb_typeof(r -> 'images') = 'array' then r -> 'images'
      when coalesce(r ->> 'images', '') <> '' then
        to_jsonb(string_to_array(btrim(r ->> 'images'), '|'))
      else '[]'::jsonb
    end;

    select id into v_category from public.categories
     where lower(name) = lower(coalesce(r ->> 'category', '')) limit 1;

    insert into public.products
      (title, brand_id, category_id, price_pkr, cost_pkr, stock, source, images)
    values
      (v_title, p_brand_id, v_category, v_price, v_cost, v_stock, 'consignment', v_images);

    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object(
    'imported', v_imported,
    'rejected', jsonb_array_length(v_rejected),
    'rows',     v_row,
    'problems', v_rejected);
end $$;

comment on function private.import_products(uuid, jsonb) is
  'README §8.4. Judges each row on its own and returns the failures with reasons — a '
  'brand''s spreadsheet is always partly wrong, and rejecting the whole file over row '
  '43 turns ten minutes back into a day.';

-- ---------------------------------------------------------------------------
-- §3.3 and §7.5 — the numbers that say whether this works.
--
-- "Track RTO rate on the admin dashboard as a first-class metric, next to
--  revenue. Target under 12%."
--
-- Gross profit is not net profit. Fulfilment eats 13–20% of order value here
-- even on a successful delivery, and every failed delivery is a pure loss — so
-- the report puts the return rate beside the revenue rather than three screens
-- away from it.
-- ---------------------------------------------------------------------------
create or replace function private.economics_summary(
  p_from date default (current_date - 30),
  p_to   date default current_date
) returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with scoped as (
    select o.id, o.status, e.revenue_pkr, e.cogs_pkr, e.coin_discount_pkr, e.gross_profit_pkr
      from public.orders o
      join public.order_economics e on e.id = o.id
     where public.pkt_date(o.created_at) between p_from and p_to
  ),
  closed as (
    select * from scoped where status in ('delivered', 'refused', 'returned')
  )
  select jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'orders',            (select count(*) from scoped),
    'delivered',         (select count(*) from scoped where status = 'delivered'),
    'refused',           (select count(*) from scoped where status in ('refused','returned')),
    'cancelled',         (select count(*) from scoped where status = 'cancelled'),
    -- Of the parcels that reached a conclusion, how many came back. Measured on
    -- closed orders only: counting the ones still in transit flatters it.
    'rto_rate_pct',      (select case when count(*) = 0 then 0
                            else round(100.0 * count(*) filter (where status in ('refused','returned'))
                                       / count(*), 1) end from closed),
    'rto_target_pct',    12,
    'revenue_pkr',       (select coalesce(sum(revenue_pkr), 0) from scoped where status = 'delivered'),
    'cogs_pkr',          (select coalesce(sum(cogs_pkr), 0) from scoped where status = 'delivered'),
    'coin_discount_pkr', (select coalesce(sum(coin_discount_pkr), 0) from scoped where status = 'delivered'),
    'gross_profit_pkr',  (select coalesce(sum(gross_profit_pkr), 0) from scoped where status = 'delivered'),
    -- Money spent shipping parcels that came back and earned nothing.
    'rto_cost_exposure_pkr',
      (select coalesce(sum(revenue_pkr), 0) from scoped where status in ('refused','returned'))
  )
$$;

/*
 * §3.3 — "If it ever shows a negative number, something has bypassed the
 * constraint and that is a P0 bug."
 *
 * The constraint makes this impossible, which is exactly why it is worth
 * watching: an alarm that never fires is how you find out the day it does.
 */
create or replace function private.margin_alarm()
returns table (order_id uuid, gross_profit_pkr bigint, revenue_pkr bigint, coin_discount_pkr bigint)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select e.id, e.gross_profit_pkr, e.revenue_pkr, e.coin_discount_pkr
    from public.order_economics e
   where e.gross_profit_pkr < 0
$$;

comment on function private.margin_alarm() is
  'README §3.3. Returns nothing, forever, unless §0 has been bypassed — in which case '
  'every row is a P0. Wire it to whatever wakes someone up.';

create or replace function public.import_products(p_brand_id uuid, p_rows jsonb)
returns jsonb language sql security definer set search_path = public, private, pg_temp
as $$ select private.import_products(p_brand_id, p_rows) $$;

create or replace function public.economics_summary(p_from date default (current_date - 30),
                                                    p_to date default current_date)
returns jsonb language sql security definer set search_path = public, private, pg_temp
as $$ select private.economics_summary(p_from, p_to) $$;

create or replace function public.margin_alarm()
returns table (order_id uuid, gross_profit_pkr bigint, revenue_pkr bigint, coin_discount_pkr bigint)
language sql security definer set search_path = public, private, pg_temp
as $$ select * from private.margin_alarm() $$;

revoke all on function
  private.import_products(uuid, jsonb), private.economics_summary(date, date), private.margin_alarm(),
  public.import_products(uuid, jsonb), public.economics_summary(date, date), public.margin_alarm()
from public, anon, authenticated;

grant execute on function
  private.import_products(uuid, jsonb), private.economics_summary(date, date), private.margin_alarm(),
  public.import_products(uuid, jsonb), public.economics_summary(date, date), public.margin_alarm()
to service_role;
