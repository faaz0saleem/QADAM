-- 20260818000700_steps.sql
-- §6.1, §7.1: step ingestion. The client reports a raw step count and nothing
-- else. It never computes coins, never sends a coin value, never sends a
-- balance. Everything below runs on the server.

-- All dates in this product are Pakistan dates. §7.3 resets the weekly board at
-- Monday 00:00 PKT, and a "day" of steps must mean the same thing to a user in
-- Karachi as it does to the cron job.
create or replace function pkt_date(p_at timestamptz default now()) returns date
language sql stable as $$
  select (p_at at time zone 'Asia/Karachi')::date;
$$;

create or replace function pkt_day_start(p_date date) returns timestamptz
language sql stable as $$
  select (p_date::timestamp at time zone 'Asia/Karachi');
$$;

create table daily_steps (
  user_id        uuid not null references users(id) on delete cascade,
  date           date not null,
  raw_steps      integer not null default 0 check (raw_steps >= 0),
  credited_steps integer not null default 0 check (credited_steps >= 0),
  coins_awarded  integer not null default 0 check (coins_awarded >= 0),
  source         text not null check (source in ('health_connect','healthkit','admin')),
  attested       boolean not null default false,
  flags          text[] not null default '{}',
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (user_id, date),
  constraint credited_not_above_raw check (credited_steps <= raw_steps)
);

create index daily_steps_date_idx on daily_steps (date, credited_steps desc);

comment on column daily_steps.raw_steps is
  'What the device reported. Shown back to the user as their own total even when '
  'none of it was credited, so a false positive never feels like theft (§7.3).';
comment on column daily_steps.credited_steps is
  'What survived §6.1: attestation, the rate ceiling and the daily cap. This is '
  'what earns coins and what the leaderboard ranks.';

-- §4 STREAK_MULTIPLIER_MAX is defined but the qualifying bar for "a day of the
-- streak" is not stated in the brief. 5,000 steps is the default; it is a config
-- dial, and confirming it is a HUMAN_TASKS item.
insert into app_config (key, value, description) values
  ('STREAK_QUALIFYING_STEPS', 5000, 'Credited steps needed for a day to extend a streak.'),
  ('STREAK_DAYS_FOR_MAX',     30,   'Streak length at which STREAK_MULTIPLIER_MAX applies (§4).');

-- Consecutive qualifying days ending today or yesterday. Yesterday still counts:
-- a streak should not break at 00:01 before the user has had a chance to walk.
create or replace function current_streak(p_user uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_bar    int := config_int('STREAK_QUALIFYING_STEPS');
  v_today  date := pkt_date();
  v_cursor date;
  v_streak int := 0;
begin
  if exists (select 1 from daily_steps
             where user_id = p_user and date = v_today and credited_steps >= v_bar) then
    v_cursor := v_today;
  elsif exists (select 1 from daily_steps
                where user_id = p_user and date = v_today - 1 and credited_steps >= v_bar) then
    v_cursor := v_today - 1;
  else
    return 0;
  end if;

  loop
    exit when not exists (
      select 1 from daily_steps
      where user_id = p_user and date = v_cursor and credited_steps >= v_bar
    );
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  return v_streak;
end
$$;

-- Exactly 1.0 on day one, rising linearly to STREAK_MULTIPLIER_MAX on day
-- STREAK_DAYS_FOR_MAX. Day one is exactly 1.0 on purpose: §4 promises "1,000
-- steps = 10 coins" forever, and a first-day multiplier would make the very
-- first number the user sees disagree with the promise.
create or replace function streak_multiplier(p_streak int) returns numeric
language sql stable as $$
  select 1 + (config_num('STREAK_MULTIPLIER_MAX') - 1)
             * least(greatest(p_streak - 1, 0), config_num('STREAK_DAYS_FOR_MAX') - 1)
             / greatest(config_num('STREAK_DAYS_FOR_MAX') - 1, 1);
$$;

-- ==========================================================================
-- The only way steps become coins.
--
-- Attestation itself (Play Integrity / DeviceCheck / App Attest) is verified in
-- an Edge Function, which passes the verdict here as p_attested. This function
-- owns everything downstream of that verdict.
--
-- Returns the coins credited by THIS call. Re-submitting a day is a top-up, not
-- a double-credit: coins_awarded records the running total for the day and only
-- the difference is ever written to the ledger.
-- ==========================================================================
create or replace function award_steps(
  p_user     uuid,
  p_date     date,
  p_raw      int,
  p_source   text,
  p_attested boolean default false,
  p_flags    text[] default '{}'
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cap        int := config_int('DAILY_STEP_CAP');
  v_per_coin   int := config_int('STEPS_PER_COIN');
  v_backfill   int := config_int('STEP_BACKFILL_HOURS');
  v_rate       int := config_int('MAX_STEPS_PER_MINUTE');
  v_today      date := pkt_date();
  v_prev       daily_steps%rowtype;
  v_prev_raw   int  := 0;
  v_window_end timestamptz;
  v_minutes    numeric;
  v_allowed    int;
  v_credited   int;
  v_flags      text[] := coalesce(p_flags, '{}');
  v_streak     int;
  v_target     int;
  v_delta      int;
  v_status     text;
begin
  if p_raw < 0 then
    raise exception 'award_steps: raw steps cannot be negative' using errcode = 'check_violation';
  end if;

  select status into v_status from users where id = p_user for update;
  if not found then
    raise exception 'award_steps: no such user %', p_user using errcode = 'no_data_found';
  end if;

  -- §6.1 backfill limit. Future-dated submissions are rejected outright: there
  -- is no honest client that produces one.
  if p_date > v_today then
    raise exception 'award_steps: % is in the future', p_date using errcode = 'check_violation';
  end if;
  if pkt_day_start(p_date) < now() - make_interval(hours => v_backfill) then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'stale_backfill', jsonb_build_object('date', p_date, 'raw_steps', p_raw));
    return 0;
  end if;

  select * into v_prev from daily_steps where user_id = p_user and date = p_date;
  v_prev_raw := coalesce(v_prev.raw_steps, 0);

  -- A device's daily total only ever goes up. A lower number means a reinstall,
  -- a clock change or a fabrication; keep the higher figure and credit nothing new.
  if p_raw < v_prev_raw then
    v_flags := array_append(v_flags, 'raw_regressed');
    p_raw := v_prev_raw;
  end if;

  -- §6.1 rate ceiling: >200 steps/minute is not a human.
  --
  -- Measured against the elapsed time INSIDE the reported day, not against the
  -- gap between two syncs. Health Connect and HealthKit hand over step data in
  -- batches, so an honest device routinely reports thousands of new steps a
  -- minute after its last sync — a per-sync ceiling would punish exactly the
  -- devices behaving correctly, and would clamp any resync of a past day. What
  -- is genuinely impossible is a DAY total larger than the day has had minutes.
  --
  -- The excess is clamped rather than the submission refused, so an honest
  -- device with one bad reading still gets its plausible steps.
  v_window_end := least(now(), pkt_day_start(p_date) + interval '1 day');
  v_minutes    := greatest(1, extract(epoch from (v_window_end - pkt_day_start(p_date))) / 60.0);
  v_allowed    := floor(v_minutes * v_rate)::int;
  if p_raw > v_allowed then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'rate_ceiling', jsonb_build_object(
      'date', p_date, 'submitted', p_raw, 'allowed', v_allowed,
      'minutes_elapsed_in_day', round(v_minutes, 1)));
    v_flags := array_append(v_flags, 'rate_clamped');
    p_raw := v_allowed;
  end if;

  -- §6.1 emulator / root: flag, never block. False positives are common here.
  if 'emulator' = any(v_flags) then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'emulator', jsonb_build_object('date', p_date));
  end if;
  if 'rooted' = any(v_flags) then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'rooted', jsonb_build_object('date', p_date));
  end if;

  -- §6.1 daily cap, always server-side.
  v_credited := least(p_raw, v_cap);
  if p_raw > v_cap then
    v_flags := array_append(v_flags, 'daily_cap');
  end if;

  -- §6.1 attestation. Unattested submissions are recorded and credited nothing.
  -- The caller gets a perfectly ordinary 0 back; nothing here tells an attacker
  -- which check they failed.
  if not p_attested then
    insert into fraud_events (user_id, kind, detail)
    values (p_user, 'unattested_submission', jsonb_build_object('date', p_date, 'raw_steps', p_raw));
    v_credited := 0;
  end if;

  -- A suspended account keeps its step history and earns nothing.
  if v_status = 'suspended' then
    v_credited := 0;
  end if;

  insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded,
                           source, attested, flags, updated_at)
  values (p_user, p_date, p_raw, v_credited, 0, p_source, p_attested,
          coalesce((select array_agg(distinct f) from unnest(v_flags) f), '{}'), now())
  on conflict (user_id, date) do update
    set raw_steps      = excluded.raw_steps,
        credited_steps = greatest(daily_steps.credited_steps, excluded.credited_steps),
        source         = excluded.source,
        attested       = daily_steps.attested or excluded.attested,
        flags          = (select coalesce(array_agg(distinct f), '{}')
                          from unnest(daily_steps.flags || excluded.flags) f),
        updated_at     = now()
  returning credited_steps into v_credited;

  -- Coins are a pure function of credited steps and the streak, computed here
  -- and nowhere else.
  v_streak := current_streak(p_user);
  v_target := floor((v_credited::numeric / v_per_coin) * streak_multiplier(v_streak))::int;
  v_delta  := v_target - coalesce(v_prev.coins_awarded, 0);

  if v_delta > 0 then
    perform credit_coins(p_user, v_delta, 'steps');
    update daily_steps set coins_awarded = v_target
    where user_id = p_user and date = p_date;
  end if;

  return greatest(v_delta, 0);
end
$$;

-- The client-facing entry point. Takes no user id: it can only ever write the
-- caller's own steps, and it takes no coin value of any kind (§6.1, §13.2).
create or replace function submit_steps(
  p_date     date,
  p_raw      int,
  p_source   text,
  p_attested boolean default false,
  p_flags    text[] default '{}'
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  return award_steps(v_user, p_date, p_raw, p_source, p_attested, p_flags);
end
$$;
