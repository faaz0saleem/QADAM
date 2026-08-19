-- README §5 — users.
--
-- public.users mirrors auth.users one-to-one. Supabase owns identity; this table
-- owns everything the product knows about a person.

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  phone         text not null unique,
  name          text,
  city          text,
  created_at    timestamptz not null default now(),
  referred_by   uuid references public.users(id) on delete set null,
  device_hash   text,
  status        text not null default 'active'
                  check (status in ('active','flagged','banned')),
  locale        text not null default 'en' check (locale in ('en','ur')),
  phone_verified_at timestamptz,

  constraint no_self_referral check (referred_by is distinct from id)
);

comment on table public.users is 'README §5. One row per person; id matches auth.users.id.';
comment on column public.users.status is
  'flagged: still earns and still sees their own totals, but is excluded from leaderboards '
  'and cannot redeem. banned: nothing. A false positive must never feel like theft (§7.3).';
comment on column public.users.device_hash is
  'The device this account was created on (§6.1). A hash seen on a second account is a '
  'flag, not an automatic ban — shared phones are normal in this market.';

-- Finding every account on one device has to be fast; it runs on every signup.
create index users_device_hash_idx on public.users (device_hash) where device_hash is not null;
create index users_referred_by_idx on public.users (referred_by) where referred_by is not null;
create index users_city_idx        on public.users (city) where city is not null;

-- §6.1 — no coin redemption in the first 7 days of an account's life.
create or replace function public.redemption_unlocks_at(p_user_id uuid)
returns timestamptz
language sql
stable
as $$
  select u.created_at + (private.cfg_int('REDEMPTION_HOLD_DAYS') || ' days')::interval
    from public.users u where u.id = p_user_id
$$;

create or replace function public.can_redeem(p_user_id uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select u.status = 'active' and now() >= public.redemption_unlocks_at(u.id)
       from public.users u where u.id = p_user_id),
    false)
$$;

comment on function public.can_redeem(uuid) is
  '§6.1 new-account velocity brake: no redemption in the first REDEMPTION_HOLD_DAYS. '
  'This alone kills most farming, because farms need throughput.';
