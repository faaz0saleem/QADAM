-- README §7.8 rewarded video, §7.7 referrals.
--
-- Both are earning-side mechanics, and both are places where a naive
-- implementation would take a number from a device and mint coins from it.
-- Neither does.

-- ---------------------------------------------------------------------------
-- §7.8 — rewarded video. ZERO ads in browse, cart, or checkout.
--
-- "One abandoned PKR 2,500 order wipes out months of ad revenue from that user.
--  An interstitial in a shopping flow is a net loss dressed up as revenue."
--
-- That rule is enforced here rather than left to UI review: `placement` admits
-- only earning-half surfaces. There is no value in the CHECK that could describe
-- a point in the shopping flow, so an ad cannot be recorded in one.
-- ---------------------------------------------------------------------------
create table public.ad_impressions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  network        text not null default 'admob' check (network in ('admob')),
  network_txn_id text not null,
  placement      text not null check (placement in ('earn_home','wallet','streak_recovery')),
  coins_awarded  integer not null check (coins_awarded >= 0),
  created_at     timestamptz not null default now(),

  -- AdMob's server-side verification callback can be retried. A replay must not
  -- pay twice.
  unique (network, network_txn_id)
);

comment on table public.ad_impressions is
  'README §7.8. Rewarded video only, and only on earning surfaces — the placement CHECK '
  'has no value that could name a point in the shopping flow (§13.5).';
comment on column public.ad_impressions.network_txn_id is
  'AdMob''s SSV transaction id. The unique constraint on it is what makes a replayed '
  'callback idempotent rather than profitable.';

create index ad_impressions_user_day on public.ad_impressions (user_id, created_at desc);

create or replace function public.rewarded_ads_today(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select count(*)::integer
    from public.ad_impressions
   where user_id = p_user_id
     and public.pkt_date(created_at) = public.pkt_date(now())
$$;

-- Called by the admob-ssv Edge Function AFTER it has verified Google's signature.
-- Note the signature: a user id, a transaction id, a placement. No coin amount —
-- the reward is read from config, server-side (§13.2).
create or replace function private.credit_rewarded_ad(
  p_user_id        uuid,
  p_network_txn_id text,
  p_placement      text default 'earn_home'
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_limit  integer := private.cfg_int('REWARDED_AD_DAILY_LIMIT');
  v_coins  integer := private.cfg_int('REWARDED_AD_COINS');
  v_today  integer;
  v_status text;
begin
  select status into v_status from public.users where id = p_user_id;
  if v_status is null then
    raise exception 'unknown user' using errcode = 'foreign_key_violation';
  end if;

  if exists (select 1 from public.ad_impressions
              where network = 'admob' and network_txn_id = p_network_txn_id) then
    return jsonb_build_object('credited', false, 'reason', 'already_counted',
                              'coins', 0, 'remaining_today',
                              greatest(0, v_limit - public.rewarded_ads_today(p_user_id)));
  end if;

  v_today := public.rewarded_ads_today(p_user_id);
  if v_today >= v_limit then
    return jsonb_build_object('credited', false, 'reason', 'daily_limit',
                              'coins', 0, 'remaining_today', 0);
  end if;

  if v_status <> 'active' then
    -- Recorded, unpaid, and told nothing (§6.1).
    insert into public.ad_impressions (user_id, network_txn_id, placement, coins_awarded)
    values (p_user_id, p_network_txn_id, p_placement, 0);
    return jsonb_build_object('credited', true, 'coins', v_coins,
                              'remaining_today', greatest(0, v_limit - v_today - 1));
  end if;

  insert into public.ad_impressions (user_id, network_txn_id, placement, coins_awarded)
  values (p_user_id, p_network_txn_id, p_placement, v_coins);

  perform private.mint_coins(p_user_id, v_coins, 'rewarded_ad', null,
    jsonb_build_object('placement', p_placement, 'network_txn_id', p_network_txn_id));

  return jsonb_build_object('credited', true, 'coins', v_coins,
                            'remaining_today', greatest(0, v_limit - v_today - 1));
end $$;

-- ---------------------------------------------------------------------------
-- §7.7 — referrals, paid on the referee's FIRST COMPLETED PURCHASE.
--
-- Not on install. This filters out install farms and is how every referral
-- programme worth copying works. For a COD market "completed" has to mean
-- delivered — an order that is placed and refused cost us money and earned
-- nobody anything.
-- ---------------------------------------------------------------------------
alter table public.users add column referral_code text;
create unique index users_referral_code_key on public.users (referral_code)
  where referral_code is not null;

create table public.referrals (
  id                 uuid primary key default gen_random_uuid(),
  referrer_id        uuid not null references public.users(id) on delete cascade,
  referee_id         uuid not null references public.users(id) on delete cascade,
  created_at         timestamptz not null default now(),
  qualified_order_id uuid references public.orders(id) on delete set null,
  paid_at            timestamptz,
  referrer_coins     integer,
  referee_coins      integer,

  -- One referrer per referee, forever. A second claim is not a second payout.
  unique (referee_id),
  constraint no_self_referral check (referrer_id <> referee_id),
  constraint paid_rows_are_complete
    check ((paid_at is null) = (qualified_order_id is null)
           and (paid_at is null) = (referrer_coins is null)
           and (paid_at is null) = (referee_coins is null))
);

comment on table public.referrals is
  'README §7.7. A row appears when a code is applied and stays unpaid until the referee''s '
  'first order is DELIVERED. Showing the pending state is the point — "Ali joined, you get '
  '500 coins when he makes his first order" is what keeps the referrer nudging.';

create index referrals_referrer_idx on public.referrals (referrer_id, paid_at);

-- Same ambiguity-free alphabet as team invite codes: no 0/O, no 1/I/L.
create or replace function private.assign_referral_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_code text; v_try integer := 0;
begin
  loop
    v_try := v_try + 1;
    v_code := private.generate_invite_code(7);
    exit when not exists (select 1 from public.users u where u.referral_code = v_code);
    if v_try > 20 then
      raise exception 'could not allocate a referral code' using errcode = 'internal_error';
    end if;
  end loop;
  update public.users set referral_code = v_code where id = p_user_id;
  return v_code;
end $$;

-- Every user gets a code at signup, so sharing never needs a round trip first.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into public.users (id, phone)
  values (new.id, coalesce(new.phone, new.email, new.id::text))
  on conflict (id) do nothing;
  perform private.assign_referral_code(new.id);
  return new;
end $$;

update public.users set referral_code = private.generate_invite_code(7)
 where referral_code is null;

create or replace function public.apply_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_referrer uuid;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select u.id into v_referrer from public.users u
   where u.referral_code = upper(btrim(p_code));
  if v_referrer is null then
    raise exception 'no such referral code' using errcode = 'no_data_found';
  end if;
  if v_referrer = v_me then
    raise exception 'you cannot refer yourself' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.referrals r where r.referee_id = v_me) then
    raise exception 'a referral code has already been applied to this account'
      using errcode = 'unique_violation';
  end if;
  -- After the first delivered order there is nothing left to qualify.
  if exists (select 1 from public.orders o where o.user_id = v_me and o.status = 'delivered') then
    raise exception 'a referral code cannot be applied after your first order'
      using errcode = 'check_violation';
  end if;

  insert into public.referrals (referrer_id, referee_id) values (v_referrer, v_me);
  update public.users set referred_by = v_referrer where id = v_me;

  return jsonb_build_object('applied', true, 'pays_on', 'first_delivered_order');
end $$;

-- Settlement. Both sides, once, and only when an order actually arrives.
create or replace function private.settle_referral(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_order record;
  v_ref   record;
  v_a     integer := private.cfg_int('REFERRAL_COINS_REFERRER');
  v_b     integer := private.cfg_int('REFERRAL_COINS_REFEREE');
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.status <> 'delivered' then return false; end if;

  select * into v_ref from public.referrals
   where referee_id = v_order.user_id and paid_at is null
     for update;
  if not found then return false; end if;

  perform private.mint_coins(v_ref.referrer_id, v_a, 'referral_referrer', null,
    jsonb_build_object('referee_id', v_ref.referee_id, 'order_id', p_order_id));
  perform private.mint_coins(v_ref.referee_id, v_b, 'referral_referee', null,
    jsonb_build_object('referrer_id', v_ref.referrer_id, 'order_id', p_order_id));

  update public.referrals
     set qualified_order_id = p_order_id, paid_at = now(),
         referrer_coins = v_a, referee_coins = v_b
   where id = v_ref.id;

  return true;
end $$;

create or replace function private.orders_settle_referral()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    perform private.settle_referral(new.id);
  end if;
  return null;
end $$;

create trigger orders_settle_referral_on_delivery
  after update of status on public.orders
  for each row execute function private.orders_settle_referral();

-- §7.7 — show pending referrals, so the referrer keeps nudging.
create or replace function public.my_referrals()
returns table (referee_name text, joined_at timestamptz, paid boolean, coins integer)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select u.name, r.created_at, r.paid_at is not null, r.referrer_coins
    from public.referrals r
    join public.users u on u.id = r.referee_id
   where r.referrer_id = auth.uid()
   order by r.created_at desc
$$;

create or replace function public.my_referral_code()
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$ select u.referral_code from public.users u where u.id = auth.uid() $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.ad_impressions enable row level security;
alter table public.referrals      enable row level security;

create policy ad_impressions_select_self on public.ad_impressions
  for select to authenticated using (user_id = auth.uid());
create policy referrals_select_mine on public.referrals
  for select to authenticated using (referrer_id = auth.uid() or referee_id = auth.uid());

grant select on public.ad_impressions to authenticated;
grant select on public.referrals to authenticated;

revoke all on function
  private.credit_rewarded_ad(uuid, text, text),
  private.settle_referral(uuid),
  private.assign_referral_code(uuid)
from public, anon, authenticated;

revoke all on function
  public.rewarded_ads_today(uuid),
  public.apply_referral_code(text),
  public.my_referrals(),
  public.my_referral_code()
from public;

grant execute on function
  public.apply_referral_code(text),
  public.my_referrals(),
  public.my_referral_code()
to authenticated;

grant execute on function
  private.credit_rewarded_ad(uuid, text, text),
  private.settle_referral(uuid),
  public.rewarded_ads_today(uuid)
to service_role;
