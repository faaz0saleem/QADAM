-- §7.8 — how many rewarded videos this user has left today.
--
-- Server-counted, like everything else that turns into coins. The client shows
-- the number; it does not decide it, and a client that had run out could not
-- talk itself back into another one.
create or replace function public.my_rewarded_ads_left_today()
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select greatest(0, private.cfg_int('REWARDED_AD_DAILY_LIMIT')
                     - public.rewarded_ads_today(auth.uid()))
$$;

comment on function public.my_rewarded_ads_left_today() is
  'README §7.8, capped at REWARDED_AD_DAILY_LIMIT. Display only — the real limit is '
  'enforced in credit_rewarded_ad, which is where the coins are.';

revoke all on function public.my_rewarded_ads_left_today() from public, anon;
grant execute on function public.my_rewarded_ads_left_today() to authenticated;
