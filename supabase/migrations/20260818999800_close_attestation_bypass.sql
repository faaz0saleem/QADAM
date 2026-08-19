-- 20260818999800_close_attestation_bypass.sql
--
-- P0. `submit_steps` was granted to `authenticated` and took `p_attested` as an
-- argument, so any signed-in user could call:
--
--     select submit_steps(current_date, 15000, 'health_connect', true);
--
-- and mint a full day's coins with no attestation at all — routing around the
-- ingest-steps Edge Function that exists precisely to verify it. §6.1 says the
-- server decides everything; a boolean the client hands us is not the server
-- deciding.
--
-- The fix is to make the parameter unreachable rather than to validate it. A
-- client cannot assert its own integrity, so it must not be able to name the
-- field at all.

drop function if exists submit_steps(date, int, text, boolean, text[]);

-- The replacement records what the device reported and credits nothing.
--
-- It is still worth having: §7.3 shows a user their own raw total even when none
-- of it ranked or earned, and the offline queue needs somewhere to land when the
-- Edge Function is unreachable. Those steps become creditable the moment an
-- attested submission for the same day arrives — award_steps takes the higher
-- figure and tops up the difference.
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

  -- p_attested is hardcoded false and there is no argument for it. Minting
  -- happens through ingest-steps, which verifies a Play Integrity or DeviceCheck
  -- token first, or not at all.
  return award_steps(v_user, p_date, p_raw, p_source, false, '{}');
end
$$;

revoke all on function submit_steps(date, int, text) from public, anon, authenticated;
grant execute on function submit_steps(date, int, text) to authenticated;

comment on function submit_steps(date, int, text) is
  '§6.1: records raw steps and credits nothing. There is deliberately no way for '
  'a client to claim attestation — that verdict comes from the ingest-steps Edge '
  'Function, which checks a real token.';

-- ==========================================================================
-- The same hole, in the rewarded video path.
--
-- `claim_rewarded_ad` was callable by any authenticated user with no evidence a
-- video was ever watched: three calls a day, 90 coins, no ad impression. Small
-- per user, and exactly the throughput a farm is built for.
--
-- AdMob's server-side verification exists for this: Google calls US with a
-- signed callback once the reward is genuinely earned. So the claim moves
-- server-side and the client loses the ability to make it.
-- ==========================================================================
create table ad_reward_callbacks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  -- AdMob's transaction id. Unique, so a replayed callback pays once.
  transaction_id text not null unique,
  ad_network     text,
  created_at     timestamptz not null default now()
);

create index ad_reward_callbacks_user_idx on ad_reward_callbacks (user_id, created_at desc);

-- Called only by the verify-ad-reward Edge Function, after it has checked
-- Google's signature. Idempotent: AdMob retries callbacks.
create or replace function grant_verified_ad_reward(
  p_user           uuid,
  p_transaction_id text,
  p_ad_network     text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := config_int('REWARDED_AD_DAILY_LIMIT');
  v_coins int := config_int('REWARDED_AD_COINS');
  v_today int;
begin
  perform 1 from users where id = p_user for update;

  -- A retry of a callback we have already paid is a no-op, not a second reward.
  if exists (select 1 from ad_reward_callbacks where transaction_id = p_transaction_id) then
    return 0;
  end if;

  select count(*) into v_today from ad_views
  where user_id = p_user and date = pkt_date();

  if v_today >= v_limit then
    -- Over the cap. Record the callback so a retry does not re-check forever,
    -- and pay nothing.
    insert into ad_reward_callbacks (user_id, transaction_id, ad_network)
    values (p_user, p_transaction_id, p_ad_network);
    return 0;
  end if;

  insert into ad_reward_callbacks (user_id, transaction_id, ad_network)
  values (p_user, p_transaction_id, p_ad_network);
  insert into ad_views (user_id) values (p_user);
  perform credit_coins(p_user, v_coins, 'rewarded_ad');

  return v_coins;
end
$$;

-- The client-callable version goes away entirely.
drop function if exists claim_rewarded_ad();

-- How many are left today, so the app can show or hide the card. A count, not a
-- reward — nothing here mints anything.
create or replace function rewarded_ads_left_today()
returns int
language sql stable security definer set search_path = public as $$
  select greatest(0, config_int('REWARDED_AD_DAILY_LIMIT') - (
    select count(*)::int from ad_views
    where user_id = auth.uid() and date = pkt_date()
  ));
$$;

alter table ad_reward_callbacks enable row level security;
-- No policy: service_role only.

revoke all on function grant_verified_ad_reward(uuid, text, text)
  from public, anon, authenticated;
revoke all on function rewarded_ads_left_today() from public, anon;
grant execute on function rewarded_ads_left_today() to authenticated;
