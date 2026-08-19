-- Attestation nonces, push tokens, and the scheduled jobs.

-- ---------------------------------------------------------------------------
-- §6.1 — attestation nonces.
--
-- An attestation token that is not bound to a specific request can be captured
-- once and replayed forever. The client asks for a nonce, attests over it, and
-- the nonce is burned on use. Short TTL, single use, server-issued.
-- ---------------------------------------------------------------------------
create table private.attestation_nonces (
  nonce      text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at    timestamptz
);

create index attestation_nonces_user_idx on private.attestation_nonces (user_id, expires_at desc);

create or replace function private.issue_attestation_nonce(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_nonce text;
begin
  v_nonce := encode(gen_random_bytes(32), 'base64');
  insert into private.attestation_nonces (nonce, user_id, expires_at)
  values (v_nonce, p_user_id, now() + interval '5 minutes');

  -- Opportunistic tidy-up; this table is pure scratch.
  delete from private.attestation_nonces
   where expires_at < now() - interval '1 hour';

  return v_nonce;
end $$;

create or replace function private.consume_attestation_nonce(p_user_id uuid, p_nonce text)
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_ok boolean;
begin
  update private.attestation_nonces
     set used_at = now()
   where nonce = p_nonce
     and user_id = p_user_id
     and used_at is null
     and expires_at > now()
  returning true into v_ok;

  return coalesce(v_ok, false);
end $$;

comment on function private.consume_attestation_nonce(uuid, text) is
  'Single use. The UPDATE ... RETURNING is the whole point: two concurrent replays of the '
  'same nonce cannot both come back true.';

-- ---------------------------------------------------------------------------
-- Push tokens — coin expiry and streak-break reminders are the retention engine (§4).
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  user_id      uuid not null references public.users(id) on delete cascade,
  token        text not null,
  platform     text not null check (platform in ('ios','android')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  primary key (user_id, token)
);

create index push_tokens_token_idx on public.push_tokens (token);

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  insert into public.push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (user_id, token) do update set last_seen_at = now();
end $$;

-- What was sent, so a reminder is not sent twice for the same thing.
create table public.notifications_sent (
  user_id uuid not null references public.users(id) on delete cascade,
  kind    text not null check (kind in ('coins_expiring','streak_at_risk','streak_broken')),
  key     text not null,                -- e.g. the batch id, or the PKT date
  sent_at timestamptz not null default now(),

  primary key (user_id, kind, key)
);

-- §4 — "the user who is about to lose their coins is exactly the user who finally
-- has enough to want to spend them. That push notification is our single best
-- reactivation lever."
create or replace function private.coins_expiring_soon(p_days integer default 7)
returns table (user_id uuid, coins integer, expires_at timestamptz, batch_id uuid,
               token text, platform text, locale text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select u.id,
         (b.delta + coalesce((select sum(d.delta) from public.coin_ledger d
                               where d.consumes_id = b.id), 0))::integer as coins,
         b.expires_at,
         b.id,
         pt.token,
         pt.platform,
         u.locale
    from public.coin_ledger b
    join public.users u on u.id = b.user_id
    join public.push_tokens pt on pt.user_id = u.id
   where b.delta > 0
     and u.status = 'active'
     and b.expires_at > now()
     and b.expires_at <= now() + (p_days || ' days')::interval
     and (b.delta + coalesce((select sum(d.delta) from public.coin_ledger d
                               where d.consumes_id = b.id), 0)) > 0
     and not exists (select 1 from public.notifications_sent ns
                      where ns.user_id = u.id and ns.kind = 'coins_expiring'
                        and ns.key = b.id::text)
$$;

-- A streak is at risk when the user qualified yesterday but not yet today.
create or replace function private.streaks_at_risk()
returns table (user_id uuid, streak_days integer, token text, platform text, locale text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select u.id,
         public.streak_days(u.id, public.pkt_date(now()) - 1),
         pt.token, pt.platform, u.locale
    from public.users u
    join public.push_tokens pt on pt.user_id = u.id
   where u.status = 'active'
     and public.streak_days(u.id, public.pkt_date(now()) - 1) > 0
     and coalesce((select d.credited_steps from public.daily_steps d
                    where d.user_id = u.id and d.date = public.pkt_date(now())), 0)
         < private.cfg_int('STREAK_MIN_STEPS')
     and not exists (select 1 from public.notifications_sent ns
                      where ns.user_id = u.id and ns.kind = 'streak_at_risk'
                        and ns.key = public.pkt_date(now())::text)
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.push_tokens        enable row level security;
alter table public.notifications_sent enable row level security;

create policy push_tokens_select_self on public.push_tokens
  for select to authenticated using (user_id = auth.uid());
grant select on public.push_tokens to authenticated;

revoke all on function
  private.issue_attestation_nonce(uuid),
  private.consume_attestation_nonce(uuid, text),
  private.coins_expiring_soon(integer),
  private.streaks_at_risk()
from public, anon, authenticated;

revoke all on function public.register_push_token(text, text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;

grant execute on function
  private.issue_attestation_nonce(uuid),
  private.consume_attestation_nonce(uuid, text),
  private.coins_expiring_soon(integer),
  private.streaks_at_risk()
to service_role;

-- ---------------------------------------------------------------------------
-- Schedules.
--
-- pg_cron and pg_net exist on Supabase but not on a bare local cluster, so this
-- block is a no-op when they are unavailable and the test suite is unaffected.
-- Cron times are UTC. PKT is UTC+5 with no daylight saving, so a PKT time is the
-- UTC time minus five hours, always.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable — schedules skipped (local test cluster)';
    return;
  end if;

  create extension if not exists pg_cron;

  -- §7.3: recompute snapshots every 15 minutes, do not rank on read.
  perform cron.schedule('qadam-rebuild-leaderboards', '*/15 * * * *',
                        $cron$select private.rebuild_leaderboards()$cron$);

  -- 10:00 PKT — coins expiring inside seven days.
  perform cron.schedule('qadam-coins-expiring', '0 5 * * *',
                        $cron$select private.notify('expire-coins-notify')$cron$);

  -- 20:00 PKT — streak at risk, while there is still an evening to walk in.
  perform cron.schedule('qadam-streak-at-risk', '0 15 * * *',
                        $cron$select private.notify('streak-notify')$cron$);
end $$;

-- The bridge from cron to an Edge Function. pg_net is async by design: this
-- queues the request and returns immediately.
create or replace function private.notify(p_function text)
returns bigint
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_net unavailable — % not invoked', p_function;
    return null;
  end if;

  execute format(
    'select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
    current_setting('app.functions_base_url', true) || '/' || p_function,
    jsonb_build_object('Content-Type', 'application/json',
                       'Authorization', 'Bearer ' || coalesce(current_setting('app.service_role_key', true), '')),
    '{}'::jsonb)
  into v_id;
  return v_id;
end $$;

comment on function private.notify(text) is
  'Invoked from cron. Needs app.functions_base_url and app.service_role_key set as '
  'database settings — see HUMAN_TASKS.md. Fails loudly in the logs rather than '
  'silently doing nothing if they are missing.';

revoke all on function private.notify(text) from public, anon, authenticated;
