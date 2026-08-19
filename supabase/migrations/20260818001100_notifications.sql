-- 20260818001100_notifications.sql
-- §4, §7.2: the expiry reminder.
--
-- "The user who is about to lose their coins is exactly the user who finally has
-- enough to want to spend them." §4 calls this our single best reactivation
-- lever, so it is a first-class table with a delivery record, not a fire-and-
-- forget send from a script.

create table push_tokens (
  user_id    uuid not null references users(id) on delete cascade,
  token      text not null,
  platform   text not null check (platform in ('ios','android')),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (user_id, token)
);

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  kind        text not null check (kind in (
                'coins_expiring','streak_at_risk','order_confirm','order_delivered','challenge_result')),
  dedupe_key  text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  -- One notification per user per subject per window. The sweep runs daily and
  -- must not nag the same user about the same batch every morning.
  unique (user_id, kind, dedupe_key)
);

create index notifications_unsent_idx on notifications (created_at) where sent_at is null;

insert into app_config (key, value, description) values
  ('EXPIRY_WARNING_DAYS', 7,   'Days before a coin batch expires that we warn (§12).'),
  ('EXPIRY_WARNING_MIN_COINS', 200, 'Below this, an expiry warning is noise rather than news.');

-- Queues one reminder per user per expiring batch. Returns how many it queued.
-- Idempotent: running it twice in a day queues nothing the second time.
create or replace function queue_expiry_warnings()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_days int := config_int('EXPIRY_WARNING_DAYS');
  v_min  int := config_int('EXPIRY_WARNING_MIN_COINS');
  v_n    int;
begin
  insert into notifications (user_id, kind, dedupe_key, payload)
  select
    b.user_id,
    'coins_expiring',
    b.expires_at::date::text,
    jsonb_build_object(
      'coins', b.remaining,
      'expires_on', b.expires_at::date,
      'days_left', b.days_left
    )
  from coin_batches b
  join users u on u.id = b.user_id
  where b.days_left <= v_days
    and b.remaining >= v_min
    and u.status in ('active','flagged')
  on conflict (user_id, kind, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- §7.1: a streak is worth reminding someone about only while it is still savable.
create or replace function queue_streak_warnings()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_bar int := config_int('STREAK_QUALIFYING_STEPS');
  v_n   int;
begin
  insert into notifications (user_id, kind, dedupe_key, payload)
  select
    u.id,
    'streak_at_risk',
    pkt_date()::text,
    jsonb_build_object('streak', current_streak(u.id))
  from users u
  where u.status = 'active'
    and current_streak(u.id) >= 3
    -- yesterday qualified, today has not yet
    and not exists (
      select 1 from daily_steps ds
      where ds.user_id = u.id and ds.date = pkt_date() and ds.credited_steps >= v_bar
    )
  on conflict (user_id, kind, dedupe_key) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

alter table push_tokens   enable row level security;
alter table notifications enable row level security;

create policy push_tokens_own on push_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on push_tokens to authenticated;

create policy notifications_own on notifications
  for select to authenticated using (user_id = auth.uid());
grant select on notifications to authenticated;
