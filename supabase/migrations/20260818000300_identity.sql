-- 20260818000300_identity.sql
-- §5: users, teams, team_members.

create table users (
  id           uuid primary key references auth.users(id) on delete cascade,
  phone        text not null unique,
  name         text,
  city         text,
  referred_by  uuid references users(id) on delete set null,
  device_hash  text,
  status       text not null default 'active'
                 check (status in ('active','flagged','suspended','deleted')),
  created_at   timestamptz not null default now(),
  constraint no_self_referral check (referred_by is null or referred_by <> id)
);

comment on column users.status is
  'Soft delete only. coin_ledger is append-only, so a user with ledger history '
  'cannot be hard-deleted; set status = ''deleted'' instead.';
comment on column users.device_hash is
  '§6.1 one account per device. A hash seen on a second account is flagged, not blocked.';

create index users_device_hash_idx on users (device_hash) where device_hash is not null;
create index users_referred_by_idx on users (referred_by);
create index users_city_idx        on users (city);

-- §6.1 evidence trail. Written by triggers and by the step-ingestion function;
-- never readable or writable through the API.
create table fraud_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in (
               'duplicate_device','unattested_submission','rate_ceiling',
               'stale_backfill','emulator','rooted','daily_cap_hit',
               'redemption_lock','delivery_refused')),
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index fraud_events_user_idx    on fraud_events (user_id, created_at desc);
create index fraud_events_kind_idx    on fraud_events (kind, created_at desc);

-- §6.1: flag any device seen on a second account. Flag, never hard-block —
-- shared and resold handsets are common in this market.
create or replace function flag_duplicate_device() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_other uuid;
begin
  if new.device_hash is null then
    return new;
  end if;

  select id into v_other
  from users
  where device_hash = new.device_hash and id <> new.id
  limit 1;

  if v_other is not null then
    insert into fraud_events (user_id, kind, detail)
    values (new.id, 'duplicate_device',
            jsonb_build_object('device_hash', new.device_hash, 'first_seen_on', v_other));
    update users set status = 'flagged' where id = new.id and status = 'active';
  end if;

  return new;
end
$$;

create trigger users_flag_duplicate_device
  after insert or update of device_hash on users
  for each row execute function flag_duplicate_device();

-- §7.6 Teams of 5–30, free to join, invite code.
create table teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 40),
  city        text,
  captain_id  uuid not null references users(id) on delete restrict,
  invite_code text not null unique,
  created_at  timestamptz not null default now()
);

create table team_members (
  team_id   uuid not null references teams(id) on delete cascade,
  user_id   uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on team_members (user_id);

-- Unambiguous alphabet: no O/0, no I/1/L. Codes get read aloud and typed by hand.
create or replace function gen_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from teams where invite_code = code);
  end loop;
  return code;
end
$$;

alter table teams alter column invite_code set default gen_invite_code();

-- §7.6 caps a team at 30. The floor of 5 is a display rule, not a data rule:
-- every team is size 1 for the first few seconds of its life.
create or replace function enforce_team_size() returns trigger
language plpgsql as $$
declare
  v_count int;
begin
  select count(*) into v_count from team_members where team_id = new.team_id;
  if v_count > 30 then
    raise exception 'team % is full (30 members maximum)', new.team_id
      using errcode = 'check_violation';
  end if;
  return null;
end
$$;

create trigger team_members_size_cap
  after insert on team_members
  for each row execute function enforce_team_size();

-- The captain is always a member.
create or replace function add_captain_to_team() returns trigger
language plpgsql as $$
begin
  insert into team_members (team_id, user_id) values (new.id, new.captain_id)
  on conflict do nothing;
  return null;
end
$$;

create trigger teams_captain_joins
  after insert on teams
  for each row execute function add_captain_to_team();
