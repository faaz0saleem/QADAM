-- 20260818001600_analytics.sql
-- docs/METRICS.md §2 — the event spec, and §1.2 — the Phase 1 gates.
--
-- Events land in Postgres rather than in a vendor. Two reasons: the gates in
-- §1.2 are the decision this whole project turns on and should be computable
-- from the same database as everything else, and a self-hosted sink costs
-- nothing while the answer to "which analytics tool" is still open
-- (HUMAN_TASKS). A PostHog or Amplitude forwarder can read this table later
-- without any client change.

create table analytics_events (
  id          bigserial primary key,
  user_id     uuid references users(id) on delete cascade,
  session_id  uuid not null,
  name        text not null,
  props       jsonb not null default '{}',
  platform    text check (platform in ('android','ios','web')),
  app_version text,
  city        text,
  occurred_at timestamptz not null default now(),

  -- §2's vocabulary, exactly. A typo in an event name is invisible in a
  -- dashboard until someone notices a chart that never moved, so the set is
  -- closed and adding to it is a migration.
  constraint known_event check (name in (
    -- onboarding
    'first_open','onboarding_step_viewed','health_permission_prompted',
    'health_permission_granted','health_permission_denied','onboarding_completed',
    'account_deleted',
    -- core loop
    'app_open','steps_synced','coins_minted','streak_continued','streak_broken',
    'daily_goal_hit',
    -- social
    'leaderboard_viewed','team_created','team_joined','team_invite_shared',
    'referral_shared','referral_converted',
    -- commerce
    'store_opened','product_viewed','add_to_cart','checkout_started','coins_applied',
    'coins_insufficient_shown','order_placed','whatsapp_confirm_sent',
    'whatsapp_confirm_received','order_delivered','order_refused',
    -- the locked-shop test (§1.5)
    'shop_locked_viewed','notify_me_submitted',
    -- monetisation
    'rewarded_ad_offered','rewarded_ad_completed','coins_expired',
    'expiry_notification_sent','expiry_notification_tapped'
  ))
);

create index analytics_user_time_idx on analytics_events (user_id, occurred_at);
create index analytics_name_time_idx on analytics_events (name, occurred_at);
create index analytics_session_idx   on analytics_events (session_id, occurred_at);

comment on table analytics_events is
  'docs/METRICS.md §2. Append-only in practice; nothing reads it but the gate '
  'functions and the weekly dashboard. Never joined into a money path.';

-- ---------------------------------------------------------------------------
-- §1.2 — "Open retention, not install retention."
--
-- A step app keeps syncing in the background whether or not anyone looks at it,
-- so retention counts app_open only. Everything below follows from that one
-- decision.
-- ---------------------------------------------------------------------------
create or replace function retention_curve(p_days int default 30)
returns table (
  cohort_day     date,
  cohort_size    bigint,
  d1_retained    bigint,
  d7_retained    bigint,
  d30_retained   bigint,
  d1_pct         numeric,
  d7_pct         numeric,
  d30_pct        numeric
)
language sql stable security definer set search_path = public as $$
  with installs as (
    select user_id, min(occurred_at) as installed_at
    from analytics_events
    where name = 'first_open' and user_id is not null
    group by user_id
  ),
  cohorts as (
    select user_id, (installed_at at time zone 'Asia/Karachi')::date as cohort_day, installed_at
    from installs
    where installed_at >= now() - make_interval(days => p_days)
  ),
  opens as (
    select c.user_id, c.cohort_day,
           floor(extract(epoch from (e.occurred_at - c.installed_at)) / 86400)::int as day_n
    from cohorts c
    join analytics_events e on e.user_id = c.user_id and e.name = 'app_open'
    where e.occurred_at >= c.installed_at
  )
  select
    c.cohort_day,
    count(distinct c.user_id)                                                as cohort_size,
    count(distinct o.user_id) filter (where o.day_n = 1)                     as d1_retained,
    count(distinct o.user_id) filter (where o.day_n between 7 and 7)         as d7_retained,
    count(distinct o.user_id) filter (where o.day_n between 30 and 30)       as d30_retained,
    round(100.0 * count(distinct o.user_id) filter (where o.day_n = 1)
          / nullif(count(distinct c.user_id), 0), 1)                         as d1_pct,
    round(100.0 * count(distinct o.user_id) filter (where o.day_n = 7)
          / nullif(count(distinct c.user_id), 0), 1)                         as d7_pct,
    round(100.0 * count(distinct o.user_id) filter (where o.day_n = 30)
          / nullif(count(distinct c.user_id), 0), 1)                         as d30_pct
  from cohorts c
  left join opens o on o.user_id = c.user_id
  group by c.cohort_day
  order by c.cohort_day desc;
$$;

-- ---------------------------------------------------------------------------
-- §1.2 as a function. Returns one row per gate with its value and its verdict,
-- so the dashboard and any future CI check read the same thresholds.
--
-- The thresholds live here rather than in the reporting script on purpose: a
-- number that decides whether to build a business should not be a literal in a
-- file someone edits while looking at disappointing data.
-- ---------------------------------------------------------------------------
create or replace function phase1_gates()
returns table (
  metric    text,
  value     numeric,
  green_at  numeric,
  red_below numeric,
  verdict   text,
  note      text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_installs   bigint;
  v_d1  numeric; v_d7 numeric; v_d30 numeric;
  v_sessions   numeric;
  v_median_sec numeric;
  v_team_pct   numeric;
  v_invites    numeric;
  v_perm_pct   numeric;
begin
  select count(*) into v_installs
  from (select distinct user_id from analytics_events where name = 'first_open') x;

  select coalesce(avg(d1_pct), 0), coalesce(avg(d7_pct), 0), coalesce(avg(d30_pct), 0)
    into v_d1, v_d7, v_d30
  from retention_curve(60);

  -- Sessions per week among users still opening the app at D7.
  with retained as (
    select distinct e.user_id
    from analytics_events e
    join (select user_id, min(occurred_at) as t0 from analytics_events
          where name = 'first_open' group by user_id) i on i.user_id = e.user_id
    where e.name = 'app_open'
      and e.occurred_at >= i.t0 + interval '7 days'
  )
  select coalesce(avg(weekly), 0) into v_sessions
  from (
    select e.user_id, count(distinct e.session_id)::numeric
           / greatest(1, extract(day from (max(e.occurred_at) - min(e.occurred_at))) / 7) as weekly
    from analytics_events e
    join retained r on r.user_id = e.user_id
    where e.name = 'app_open'
    group by e.user_id
  ) s;

  -- Median session length, first to last event within a session.
  --
  -- Only sessions that actually contain an app_open count. §1.2 measures
  -- foreground sessions, and a background job or a one-off event carrying its
  -- own session id would otherwise register as a zero-second session and drag
  -- the median to nothing — reporting a red gate the data does not support.
  select coalesce(percentile_cont(0.5) within group (
           order by extract(epoch from (last_seen - first_seen))), 0)
    into v_median_sec
  from (
    select session_id, min(occurred_at) as first_seen, max(occurred_at) as last_seen
    from analytics_events
    group by session_id
    having bool_or(name = 'app_open')
  ) sess;

  select round(100.0 * count(*) filter (where joined) / nullif(count(*), 0), 1)
    into v_team_pct
  from (
    select i.user_id,
           exists (select 1 from analytics_events e
                   where e.user_id = i.user_id and e.name = 'team_joined') as joined
    from (select distinct user_id from analytics_events where name = 'first_open') i
  ) t;

  select coalesce(
           count(*) filter (where name in ('team_invite_shared','referral_shared'))::numeric
           / nullif(count(distinct user_id) filter (where name = 'app_open'), 0), 0)
    into v_invites
  from analytics_events;

  select round(100.0 * count(*) filter (where name = 'health_permission_granted')
          / nullif(count(*) filter (where name in
              ('health_permission_granted','health_permission_denied')), 0), 1)
    into v_perm_pct
  from analytics_events;

  return query
  with gates as (
    select * from (values
      ('installs',                coalesce(v_installs, 0)::numeric, 300::numeric, 300::numeric,
         'docs/METRICS.md §1.1: 300 organic installs over four full weeks'),
      ('d1_open_retention_pct',   coalesce(v_d1, 0),        35,  20,
         'app-open, never install'),
      ('d7_open_retention_pct',   coalesce(v_d7, 0),        18,  10,
         'a red here on its own stops Phase 2'),
      ('d30_open_retention_pct',  coalesce(v_d30, 0),        8,   4, null),
      ('sessions_per_week_d7',    coalesce(v_sessions, 0),   4,   2, null),
      ('median_session_seconds',  coalesce(v_median_sec, 0), 40,  20,
         'short but retained is survivable; it still predicts a store problem'),
      ('team_join_rate_pct',      coalesce(v_team_pct, 0),  25,  12,
         'the entire distribution strategy — there is no ad budget'),
      ('invites_per_active_user', coalesce(v_invites, 0),  0.3, 0.1, null),
      ('health_permission_pct',   coalesce(v_perm_pct, 0),  70,  50, null)
    ) as g(metric, value, green_at, red_below, note)
  )
  select
    g.metric, g.value, g.green_at, g.red_below,
    case
      when g.value >= g.green_at then 'green'
      when g.value <  g.red_below then 'red'
      else 'amber'
    end,
    g.note
  from gates g;
end
$$;

-- §1.3: "Any two reds, or a red on D7: stop." Encoded so nothing has to
-- remember it.
create or replace function phase2_is_unlocked()
returns table (unlocked boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_reds     int;
  v_d7_red   boolean;
  v_installs numeric;
begin
  select count(*) filter (where verdict = 'red'),
         bool_or(verdict = 'red' and metric = 'd7_open_retention_pct'),
         max(value) filter (where metric = 'installs')
    into v_reds, v_d7_red, v_installs
  from phase1_gates();

  if coalesce(v_installs, 0) < 300 then
    return query select false,
      'Not enough sample yet: ' || coalesce(v_installs, 0)::text ||
      ' installs of the 300 that docs/METRICS.md §1.1 asks for.';
    return;
  end if;
  if v_d7_red then
    return query select false, 'D7 open retention is red. §1.3: stop and change something structural.';
    return;
  end if;
  if v_reds >= 2 then
    return query select false,
      v_reds::text || ' gates are red. §1.3: stop and change something structural.';
    return;
  end if;
  return query select true, 'Gates met. Building the store is a defensible decision.';
end
$$;

alter table analytics_events enable row level security;

-- A client may write its own events and read none of them. Analytics is not a
-- money path, but a user reading the table would learn other people's habits.
create policy analytics_insert_self on analytics_events
  for insert to authenticated with check (user_id = auth.uid());
