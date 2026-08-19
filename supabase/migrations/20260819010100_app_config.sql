-- README §4 — the coin economy, in one server-side table the human can edit
-- without a redeploy.
--
-- Two rules about this table:
--   1. Nothing in it is ever hardcoded in application code.
--   2. Nothing in it is ever visible to a client. Especially COIN_VALUE_PKR —
--      §4 is explicit that the coin-to-rupee rate is never published in the UI.
--      The UI shows "1,000 steps = 10 coins" and per-product coin discounts.

create table private.app_config (
  key         text primary key,
  value       numeric not null,
  unit        text,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

comment on table private.app_config is
  'README §4 coin economy knobs. Server-side only — never exposed to any client role.';

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger app_config_touch
  before update on private.app_config
  for each row execute function private.touch_updated_at();

-- Typed accessors. Every read of a knob goes through one of these, so a missing
-- key is a loud error at the call site rather than a silent NULL that becomes a
-- zero cap or an infinite one.
create or replace function private.cfg(p_key text)
returns numeric
language plpgsql
stable
as $$
declare v numeric;
begin
  select value into v from private.app_config where key = p_key;
  if v is null then
    raise exception 'app_config key % is not set', p_key using errcode = 'no_data_found';
  end if;
  return v;
end $$;

create or replace function private.cfg_int(p_key text)
returns integer
language sql
stable
as $$ select private.cfg(p_key)::integer $$;

insert into private.app_config (key, value, unit, description) values
  ('STEPS_PER_COIN',          100,   'steps',  'Steps that mint one coin. 1,000 steps = 10 coins — a promise we keep forever (§4).'),
  ('DAILY_STEP_CAP',          15000, 'steps',  'Hard server-side ceiling on credited steps per PKT day. Anti-fraud and budget control.'),
  ('COIN_VALUE_PKR',          0.03,  'PKR',    'Rupee value of one coin. NEVER shown to a client, in any form.'),
  ('COIN_EXPIRY_DAYS',        90,    'days',   'Coins expire 90 days after minting. Same window as the meaningful-discount window, deliberately.'),
  ('MIN_ORDER_FOR_COINS_PKR', 1500,  'PKR',    'Order subtotal below which coins cannot be spent.'),
  ('REWARDED_AD_COINS',       30,    'coins',  'Coins per completed rewarded video.'),
  ('REWARDED_AD_DAILY_LIMIT', 3,     'count',  'Rewarded videos per user per PKT day.'),
  ('REFERRAL_COINS_REFERRER', 500,   'coins',  'Paid on the referee''s FIRST COMPLETED PURCHASE, never on install.'),
  ('REFERRAL_COINS_REFEREE',  500,   'coins',  'Paid on the referee''s first completed purchase.'),
  ('STREAK_MULTIPLIER_MAX',   1.5,   'x',      'Multiplier at a 30-day streak. Ramps linearly from 1.0.'),
  ('STREAK_MULTIPLIER_DAYS',  30,    'days',   'Streak length at which the multiplier reaches its maximum.'),
  ('MAX_STEPS_PER_MINUTE',    200,   'steps',  'Rate ceiling (§6.1). Humans do not exceed this; anything that does is not walking.'),
  ('BACKFILL_LIMIT_HOURS',    48,    'hours',  'Oldest retroactive step data accepted (§6.1).'),
  ('REDEMPTION_HOLD_DAYS',    7,     'days',   'No coin redemption in an account''s first 7 days (§6.1). Kills farm throughput.'),
  ('COD_CONFIRM_THRESHOLD_PKR', 3000, 'PKR',   'COD orders above this are never dispatched without a WhatsApp confirmation (§7.5).'),
  ('COD_RISK_BLOCK_SCORE',    60,    'score',  'cod_risk_score at or above which prepayment is required (§7.5).');
