-- 20260818000200_config.sql
--
-- §4. The whole coin economy in one server-side table, editable without a
-- redeploy. Nothing here is ever hardcoded elsewhere, and none of it is
-- readable by anon or authenticated: COIN_VALUE_PKR reaching the client would
-- publish the coin-to-rupee rate the brief forbids showing (§4).

create table app_config (
  key         text primary key check (key = upper(key) and key ~ '^[A-Z][A-Z0-9_]*$'),
  value       numeric not null check (value >= 0),
  description text not null,
  updated_at  timestamptz not null default now()
);

comment on table app_config is
  '§4 coin economy dials. Server-side only — never exposed through the API. '
  'Edit values here; never hardcode them in application code.';

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger app_config_touch
  before update on app_config
  for each row execute function touch_updated_at();

insert into app_config (key, value, description) values
  ('STEPS_PER_COIN',          100,   '1,000 steps = 10 coins. The one promise we keep forever (§4).'),
  ('DAILY_STEP_CAP',          15000, 'Hard server-side ceiling on creditable steps per day (§4, §6.1).'),
  ('COIN_VALUE_PKR',          0.03,  'Internal coin-to-rupee rate. NEVER expose to a client (§4).'),
  ('COIN_EXPIRY_DAYS',        90,    'Life of a coin batch from the day it is minted (§4).'),
  ('MIN_ORDER_FOR_COINS_PKR', 1500,  'Order subtotal below which coins cannot be spent (§4).'),
  ('REWARDED_AD_COINS',       30,    'Coins per completed rewarded video (§4, §7.8).'),
  ('REWARDED_AD_DAILY_LIMIT', 3,     'Rewarded videos per user per day (§4, §7.8).'),
  ('REFERRAL_COINS_REFERRER', 500,   'Paid on the referee''s FIRST PURCHASE, not install (§4, §7.7).'),
  ('REFERRAL_COINS_REFEREE',  500,   'Paid on the referee''s FIRST PURCHASE, not install (§4, §7.7).'),
  ('STREAK_MULTIPLIER_MAX',   1.5,   'Multiplier reached at a 30-day streak (§4).'),
  -- §6.1 states this rule in prose but §4 has no dial for it. It belongs here for
  -- the same reason as the rest: tuning it must not need a redeploy.
  ('REDEMPTION_LOCK_DAYS',    7,     'No coin redemption in an account''s first N days (§6.1).'),
  ('STEP_BACKFILL_HOURS',     48,    'Oldest retroactive step data accepted (§6.1).'),
  ('MAX_STEPS_PER_MINUTE',    200,   'Rate ceiling; humans do not exceed this (§6.1).');

-- Reading config is a server-side privilege. SECURITY DEFINER so the coin
-- functions can call it while the API roles hold no grant on app_config at all.
create or replace function config_num(p_key text) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v numeric;
begin
  select value into v from app_config where key = p_key;
  if v is null then
    raise exception 'app_config is missing required key %', p_key
      using errcode = 'no_data_found';
  end if;
  return v;
end
$$;

create or replace function config_int(p_key text) returns integer
language sql stable as $$
  select config_num(p_key)::int;
$$;

alter table app_config enable row level security;
-- Deliberately no policies: only service_role (BYPASSRLS) and SECURITY DEFINER
-- functions can read this table.

revoke all on function config_num(text) from public;
revoke all on function config_int(text) from public;

-- ==========================================================================
-- While here: place_order looped over whatever array it was handed. A basket of
-- fifty thousand lines is not a shopping mistake, it is a way to hold a
-- connection open and lock rows. The cap is far above any real order.
-- ==========================================================================
create or replace function assert_basket_is_sane(p_items jsonb) returns void
language plpgsql immutable as $$
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'place_order: no items' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'place_order: too many lines in one order (%)', jsonb_array_length(p_items)
      using errcode = 'check_violation';
  end if;
end
$$;

revoke all on function assert_basket_is_sane(jsonb) from public, anon, authenticated;
