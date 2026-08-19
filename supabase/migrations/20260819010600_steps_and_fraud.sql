-- README §6.1 and §7.1 — step ingestion, and the fraud controls that must exist
-- before the store does.
--
-- The governing rule (§6.1, last bullet): the client reports raw step counts and
-- nothing else. It never computes coins, never sends a coin value, never sends a
-- balance. Nothing in this file accepts one.
--
-- Rejections are silent. An attacker who submits 500,000 steps gets the same
-- shaped response as an honest user who submitted nothing new — no error, no
-- explanation, no signal about which control caught them.

-- A day counts toward a streak when it clears this, not when it merely records a
-- step. The daily CAP (15,000) is the ceiling on earning; this is the floor on
-- showing up. They are different numbers doing different jobs.
insert into private.app_config (key, value, unit, description) values
  ('STREAK_MIN_STEPS', 5000, 'steps',
   'Credited steps a PKT day needs to extend a streak. Tunable — see HUMAN_TASKS.md.');

create table public.daily_steps (
  user_id            uuid not null references public.users(id) on delete cascade,
  date               date not null,                -- PKT business day, see public.pkt_date
  raw_steps          integer not null default 0 check (raw_steps >= 0),
  credited_steps     integer not null default 0 check (credited_steps >= 0),
  coins_awarded      integer not null default 0 check (coins_awarded >= 0),
  source             text not null check (source in ('health_connect','healthkit','manual','import')),
  flags              text[] not null default '{}',
  attested           boolean not null default false,
  first_submitted_at timestamptz not null default now(),
  last_submitted_at  timestamptz not null default now(),

  primary key (user_id, date),
  constraint credited_never_exceeds_raw check (credited_steps <= raw_steps)
);

comment on table public.daily_steps is
  'One row per user per PKT day. raw_steps is what the device reported; credited_steps '
  'is what survived the daily cap and the fraud controls. Both are kept: a flagged user '
  'still sees their own real total (§7.3), they just do not rank or earn on it.';
comment on column public.daily_steps.attested is
  'Ingested rows are attested by construction — a submission that fails attestation is '
  'dropped rather than stored, so it cannot inflate raw_steps for a later one to collect '
  'on. false marks an admin import or manual correction, which earns nothing and never '
  'reaches a leaderboard.';

create index daily_steps_date_idx on public.daily_steps (date);
create index daily_steps_user_recent_idx on public.daily_steps (user_id, date desc);

create table public.fraud_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  kind       text not null check (kind in (
               'unattested','rate_ceiling','backfill_window','future_date',
               'device_shared','emulator','rooted','step_regression','cap_exceeded')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.fraud_events is
  'README §5, §6.1. Append this, never act on it silently in the app — emulator and root '
  'detection FLAG rather than block, because false positives on rooted-but-honest devices '
  'are common in this market.';

create index fraud_events_user_idx on public.fraud_events (user_id, created_at desc);
create index fraud_events_kind_idx on public.fraud_events (kind, created_at desc);

create or replace function private.log_fraud(p_user_id uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public, private, pg_temp
as $$
  insert into public.fraud_events (user_id, kind, detail) values (p_user_id, p_kind, p_detail)
$$;

-- ---------------------------------------------------------------------------
-- Streaks (§7.1, §4)
-- ---------------------------------------------------------------------------
create or replace function public.streak_days(p_user_id uuid, p_as_of date default null)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with bounds as (
    select coalesce(p_as_of, public.pkt_date(now())) as as_of
  ),
  qualifying as (
    select d.date,
           row_number() over (order by d.date desc) as rn
      from public.daily_steps d, bounds
     where d.user_id = p_user_id
       and d.date <= bounds.as_of
       and d.attested
       and d.credited_steps >= private.cfg_int('STREAK_MIN_STEPS')
  )
  -- Walk back from as_of; the first gap makes every earlier row fall behind the
  -- expected date and drop out, so the count is the unbroken run.
  select count(*)::integer
    from qualifying, bounds
   where qualifying.date = bounds.as_of - (qualifying.rn - 1)::integer
$$;

comment on function public.streak_days(uuid, date) is
  'Unbroken run of days meeting STREAK_MIN_STEPS, ending at p_as_of (default: today PKT). '
  'Only attested days count.';

-- 1.0 at day 0, ramping linearly to STREAK_MULTIPLIER_MAX at STREAK_MULTIPLIER_DAYS.
create or replace function public.streak_multiplier(p_streak_days integer)
returns numeric
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select 1 + (private.cfg('STREAK_MULTIPLIER_MAX') - 1)
           * least(greatest(p_streak_days, 0), private.cfg('STREAK_MULTIPLIER_DAYS'))
           / private.cfg('STREAK_MULTIPLIER_DAYS')
$$;

-- ---------------------------------------------------------------------------
-- Devices (§6.1 — one account per device)
-- ---------------------------------------------------------------------------
create or replace function private.register_device(p_user_id uuid, p_device_hash text)
returns boolean          -- true when this device is already on another account
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_others int;
begin
  if p_device_hash is null or p_device_hash = '' then return false; end if;

  update public.users set device_hash = p_device_hash
   where id = p_user_id and device_hash is distinct from p_device_hash;

  select count(*) into v_others
    from public.users
   where device_hash = p_device_hash and id <> p_user_id;

  if v_others > 0 then
    perform private.log_fraud(p_user_id, 'device_shared',
      jsonb_build_object('device_hash', p_device_hash, 'other_accounts', v_others));
    return true;
  end if;
  return false;
end $$;

comment on function private.register_device(uuid, text) is
  '§6.1 one account per device. Returns true when the device is seen on another account. '
  'Flags, never auto-bans — shared handsets are normal in this market.';

-- ---------------------------------------------------------------------------
-- THE INGESTION PATH
--
-- Note the signature. It takes raw step counts, a source, and device metadata.
-- There is no coins parameter, no balance parameter, no discount parameter, and
-- there never will be (§13.2).
-- ---------------------------------------------------------------------------
create or replace function public.submit_steps(
  p_user_id            uuid,
  p_samples            jsonb,                          -- [{"date":"2026-08-19","raw_steps":8123}]
  p_source             text,
  p_device_hash        text    default null,
  p_attestation_passed boolean default false,
  p_device_flags       jsonb   default '{}'::jsonb     -- {"rooted":false,"emulator":false}
) returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $fn$
declare
  v_user            record;
  v_sample          jsonb;
  v_date            date;
  v_raw             integer;
  v_today           date := public.pkt_date(now());
  v_oldest          date;
  v_existing        record;
  v_row             record;
  v_delta_raw       integer;
  v_window_from     timestamptz;
  v_window_to       timestamptz;
  v_elapsed_min     numeric;
  v_cap             integer := private.cfg_int('DAILY_STEP_CAP');
  v_per_coin        integer := private.cfg_int('STEPS_PER_COIN');
  v_credited        integer;
  v_flags           text[];
  v_streak          integer;
  v_coins_target    integer;
  v_coins_delta     integer;
  v_device_shared   boolean := false;
  v_results         jsonb := '[]'::jsonb;
begin
  select * into v_user from public.users where id = p_user_id;
  if not found then
    raise exception 'unknown user' using errcode = 'foreign_key_violation';
  end if;

  -- A banned account gets a well-formed, entirely uninteresting answer.
  if v_user.status = 'banned' then
    return jsonb_build_object('days', '[]'::jsonb, 'balance', 0, 'streak_days', 0);
  end if;

  v_device_shared := private.register_device(p_user_id, p_device_hash);

  if coalesce((p_device_flags ->> 'rooted')::boolean, false) then
    perform private.log_fraud(p_user_id, 'rooted', p_device_flags);
  end if;
  if coalesce((p_device_flags ->> 'emulator')::boolean, false) then
    perform private.log_fraud(p_user_id, 'emulator', p_device_flags);
  end if;

  -- §6.1 backfill limit: at most BACKFILL_LIMIT_HOURS of retroactive data.
  v_oldest := public.pkt_date(now() - (private.cfg_int('BACKFILL_LIMIT_HOURS') || ' hours')::interval);

  for v_sample in select * from jsonb_array_elements(p_samples)
  loop
    v_date := (v_sample ->> 'date')::date;
    v_raw  := greatest(0, coalesce((v_sample ->> 'raw_steps')::integer, 0));

    select * into v_existing from public.daily_steps
     where user_id = p_user_id and date = v_date for update;

    -- Everything below either accepts the sample or falls through to the silent
    -- report at the bottom of the loop. Nothing tells the caller which happened.
    <<sample>>
    begin
      -- §6.1 attestation. A submission we cannot vouch for is not merely unpaid,
      -- it is not stored: persisting its raw_steps would let the next, attested
      -- submission collect on an inflated figure one step higher.
      if not p_attestation_passed then
        perform private.log_fraud(p_user_id, 'unattested', jsonb_build_object('date', v_date));
        exit sample;
      end if;

      if v_date > v_today then
        perform private.log_fraud(p_user_id, 'future_date', jsonb_build_object('date', v_date));
        exit sample;
      end if;

      if v_date < v_oldest then
        perform private.log_fraud(p_user_id, 'backfill_window',
          jsonb_build_object('date', v_date, 'oldest_accepted', v_oldest));
        exit sample;
      end if;

      -- A step counter only rises within a day. A lower number means a reinstall
      -- or a device swap, not new activity: keep the higher figure.
      if v_existing.user_id is not null and v_raw <= v_existing.raw_steps then
        if v_raw < v_existing.raw_steps then
          perform private.log_fraud(p_user_id, 'step_regression',
            jsonb_build_object('date', v_date, 'had', v_existing.raw_steps, 'got', v_raw));
        end if;
        exit sample;
      end if;

      v_delta_raw := v_raw - coalesce(v_existing.raw_steps, 0);

      -- §6.1 rate ceiling: reject any interval implying more than 200 steps/minute.
      --
      -- The interval is derived on the server, from the day's own elapsed time — never
      -- from a window the client supplies, which is the entire point of the control.
      -- It is measured against the day's CUMULATIVE total rather than the increment
      -- since the last sync, so that syncing twice in a minute is not itself suspicious
      -- and so that a figure rejected once cannot be laundered by resubmitting it in
      -- slices.
      --
      -- The floor of 60 minutes keeps the first sync after PKT midnight from tripping
      -- on arithmetic: one minute into the day, any figure at all divides badly. The
      -- daily cap bounds what that could ever be worth anyway.
      v_window_from := public.pkt_day_start(v_date);
      v_window_to   := least(now(), v_window_from + interval '1 day');
      v_elapsed_min := greatest(60, extract(epoch from (v_window_to - v_window_from)) / 60.0);

      if v_raw / v_elapsed_min > private.cfg_int('MAX_STEPS_PER_MINUTE') then
        perform private.log_fraud(p_user_id, 'rate_ceiling', jsonb_build_object(
          'date', v_date, 'raw_steps', v_raw, 'delta_steps', v_delta_raw,
          'elapsed_minutes', round(v_elapsed_min, 2),
          'steps_per_minute', round(v_raw / v_elapsed_min, 2)));
        exit sample;                    -- and the inflated figure is NOT stored
      end if;

      -- §6.1 daily cap, applied server-side, always.
      v_credited := least(v_raw, v_cap);
      v_flags := '{}'::text[];
      if v_raw > v_cap then v_flags := array_append(v_flags, 'capped'); end if;
      if v_device_shared then v_flags := array_append(v_flags, 'device_shared'); end if;

      insert into public.daily_steps as ds
        (user_id, date, raw_steps, credited_steps, source, flags, attested, last_submitted_at)
      values
        (p_user_id, v_date, v_raw, v_credited, p_source, v_flags, true, now())
      on conflict (user_id, date) do update
        set raw_steps         = excluded.raw_steps,
            credited_steps    = greatest(ds.credited_steps, excluded.credited_steps),
            source            = excluded.source,
            flags             = excluded.flags,
            attested          = true,
            last_submitted_at = now();

      -- Coins. The server computes them from credited steps and the streak the user
      -- had going into this day, and mints only the difference from what this day
      -- has already paid — so a re-sync tops up and never doubles.
      select * into v_row from public.daily_steps where user_id = p_user_id and date = v_date;
      v_streak := public.streak_days(p_user_id, v_date - 1);
      v_coins_target := floor(
        (v_row.credited_steps::numeric / v_per_coin) * public.streak_multiplier(v_streak)
      )::integer;
      v_coins_delta := v_coins_target - v_row.coins_awarded;

      if v_coins_delta > 0 and v_user.status = 'active' then
        perform private.mint_coins(p_user_id, v_coins_delta, 'steps', v_date,
          jsonb_build_object('credited_steps', v_row.credited_steps, 'streak_days', v_streak));
        update public.daily_steps set coins_awarded = v_coins_target
         where user_id = p_user_id and date = v_date;
      end if;
    end sample;

    -- The silent report. Identical in shape whether the sample was taken or dropped.
    select * into v_row from public.daily_steps where user_id = p_user_id and date = v_date;
    v_results := v_results || jsonb_build_object(
      'date',           v_date,
      'credited_steps', coalesce(v_row.credited_steps, 0),
      'coins_awarded',  coalesce(v_row.coins_awarded, 0),
      'capped',         coalesce(v_row.credited_steps, 0) >= v_cap);
  end loop;

  return jsonb_build_object(
    'days',        v_results,
    'balance',     public.coin_balance(p_user_id),
    'streak_days', public.streak_days(p_user_id));
end $fn$;

comment on function public.submit_steps(uuid, jsonb, text, text, boolean, jsonb) is
  'README §6.1/§7.1. Called by the ingest-steps Edge Function AFTER it has verified a '
  'Play Integrity / App Attest token — never by a device directly. Takes raw step counts '
  'and nothing else: no coin amount, no balance, no discount (§13.2). Every rejection is '
  'silent and shaped exactly like an accepted submission.';
