-- 20260818000800_engagement.sql
-- §7.3 leaderboards, §7.6 challenges.

-- §7.3 lists a "Friends" scope; §5's table list does not carry the social graph
-- it needs. Mutual, accepted, and entirely social — coins never move between
-- users under any circumstance (§1, §13.3).
create table friendships (
  user_id    uuid not null references users(id) on delete cascade,
  friend_id  uuid not null references users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','accepted','blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  constraint no_self_friendship check (user_id <> friend_id)
);

create index friendships_friend_idx on friendships (friend_id) where status = 'accepted';

create table challenges (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  scope           text not null check (scope in ('city','team','friends','pakistan')),
  scope_key       text not null default '',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  prize_type      text not null check (prize_type in ('coins','voucher')),
  prize_value     integer not null check (prize_value > 0),
  prize_funded_by text not null check (prize_funded_by in ('house','sponsor')),
  sponsor_name    text,
  created_at      timestamptz not null default now(),
  constraint ends_after_start check (ends_at > starts_at),
  constraint sponsor_named check ((prize_funded_by = 'sponsor') = (sponsor_name is not null))
);

comment on table challenges is
  '§1/§7.3 as database rules: prize_type admits only coins and vouchers — never '
  'cash — and prize_funded_by admits only the house or a sponsor. There is no '
  'value that describes a pool funded by users, so no entry fee, no stake, and '
  'no user who can lose something they paid for can be represented here at all.';

-- §7.3: cached rankings. Recomputed on a cron; never ranked on read.
create table leaderboard_snap (
  scope       text not null check (scope in ('city','team','pakistan')),
  scope_key   text not null default '',
  period      text not null,   -- 'all', or the Monday of the ISO week as YYYY-MM-DD
  user_id     uuid not null references users(id) on delete cascade,
  steps       bigint not null default 0,
  rank        integer not null,
  computed_at timestamptz not null default now(),
  primary key (scope, scope_key, period, user_id)
);

create index leaderboard_snap_rank_idx on leaderboard_snap (scope, scope_key, period, rank);
create index leaderboard_snap_user_idx on leaderboard_snap (user_id, period);

comment on table leaderboard_snap is
  'Only the city / team / all-Pakistan boards are precomputed. The Friends board '
  'is per-user and tiny, so it is ranked on read (see leaderboard_friends).';

-- The Monday 00:00 PKT week the given moment falls in (§7.3).
create or replace function pkt_week_start(p_at timestamptz default now()) returns date
language sql stable as $$
  select date_trunc('week', pkt_date(p_at)::timestamp)::date;
$$;

-- ==========================================================================
-- Snapshot refresh. Run every 15 minutes (§7.3).
-- Only credited_steps count: what §6.1 rejected is excluded from ranking while
-- remaining visible in the user's own total.
-- ==========================================================================
create or replace function refresh_leaderboards(p_period text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, pkt_week_start()::text);
  v_from   date;
  v_to     date;
  v_rows   int := 0;
  v_n      int;
begin
  if v_period = 'all' then
    v_from := '2000-01-01'::date;
    v_to   := 'infinity'::date;
  else
    v_from := v_period::date;
    v_to   := v_from + 7;
  end if;

  -- The delete must be its own statement: a data-modifying CTE does not see the
  -- effects of its siblings, so a DELETE and an INSERT on the same table inside
  -- one statement collide on the primary key.
  delete from leaderboard_snap where period = v_period;

  with totals as (
    select ds.user_id, u.city, sum(ds.credited_steps)::bigint as steps
    from daily_steps ds
    join users u on u.id = ds.user_id
    where ds.date >= v_from and ds.date < v_to
      and u.status in ('active','flagged')
    group by ds.user_id, u.city
    having sum(ds.credited_steps) > 0
  ),
  ranked as (
    select 'pakistan'::text as scope, ''::text as scope_key, user_id, steps,
           rank() over (order by steps desc)::int as rank
    from totals
    union all
    select 'city', city, user_id, steps,
           rank() over (partition by city order by steps desc)::int
    from totals where city is not null
    union all
    select 'team', tm.team_id::text, t.user_id, t.steps,
           rank() over (partition by tm.team_id order by t.steps desc)::int
    from totals t
    join team_members tm on tm.user_id = t.user_id
  )
  insert into leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select scope, scope_key, v_period, user_id, steps, rank from ranked;

  get diagnostics v_rows = row_count;

  -- refresh_leaderboards() with no argument keeps the current week and the
  -- all-time board in step with each other.
  if p_period is null then
    select refresh_leaderboards('all') into v_n;
    v_rows := v_rows + v_n;
  end if;

  return v_rows;
end
$$;

-- §7.3: always show the user their own rank, pinned, with a percentile.
-- "4,382 — top 12%" keeps a mid-table user engaged; a bare rank does not.
create or replace function leaderboard_page(
  p_user   uuid,
  p_scope  text,
  p_period text default null,
  p_limit  int default 50
) returns table (
  user_id     uuid,
  name        text,
  city        text,
  steps       bigint,
  rank        integer,
  percentile  integer,
  is_me       boolean,
  pinned      boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, pkt_week_start()::text);
  v_key    text := '';
  v_total  int;
begin
  if p_scope = 'city' then
    select u.city into v_key from users u where u.id = p_user;
    v_key := coalesce(v_key, '');
  elsif p_scope = 'team' then
    select tm.team_id::text into v_key from team_members tm
    where tm.user_id = p_user order by tm.joined_at limit 1;
    v_key := coalesce(v_key, '');
  end if;

  select count(*) into v_total from leaderboard_snap ls
  where ls.scope = p_scope and ls.scope_key = v_key and ls.period = v_period;

  return query
  with board as (
    select ls.user_id, u.name, u.city, ls.steps, ls.rank
    from leaderboard_snap ls
    join users u on u.id = ls.user_id
    where ls.scope = p_scope and ls.scope_key = v_key and ls.period = v_period
  ),
  top as (
    select b.*, false as pinned from board b order by b.rank limit p_limit
  ),
  me as (
    select b.*, true as pinned from board b
    where b.user_id = p_user and b.rank > p_limit
  )
  select
    x.user_id, x.name, x.city, x.steps, x.rank,
    case when v_total = 0 then 100
         else greatest(1, ceil(100.0 * x.rank / v_total)::int) end as percentile,
    x.user_id = p_user as is_me,
    x.pinned
  from (select * from top union all select * from me) x
  order by x.pinned, x.rank;
end
$$;

-- The Friends board: small, per-user, ranked on read.
create or replace function leaderboard_friends(
  p_user   uuid,
  p_period text default null
) returns table (
  user_id uuid,
  name    text,
  steps   bigint,
  rank    integer,
  is_me   boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_period text := coalesce(p_period, pkt_week_start()::text);
  v_from   date := case when v_period = 'all' then '2000-01-01'::date else v_period::date end;
  v_to     date := case when v_period = 'all' then 'infinity'::date else v_period::date + 7 end;
begin
  return query
  with circle as (
    select p_user as id
    union
    select f.friend_id from friendships f where f.user_id = p_user and f.status = 'accepted'
    union
    select f.user_id from friendships f where f.friend_id = p_user and f.status = 'accepted'
  ),
  totals as (
    select c.id, u.name, coalesce(sum(ds.credited_steps), 0)::bigint as steps
    from circle c
    join users u on u.id = c.id
    left join daily_steps ds
      on ds.user_id = c.id and ds.date >= v_from and ds.date < v_to
    group by c.id, u.name
  )
  select t.id, t.name, t.steps,
         rank() over (order by t.steps desc)::int,
         t.id = p_user
  from totals t
  order by 4;
end
$$;
