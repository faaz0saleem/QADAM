-- README §7.3 leaderboards, §7.6 teams and challenges.
--
-- Teams are the growth engine, not a feature: one captain recruits twenty people
-- for us. So joining is a deep link with no account required up front, and the
-- invite code is short enough to say out loud.
--
-- On prizes (§13.4): there is no entry fee column here, no stake column, no pooled
-- pot. A prize is funded by us or by a sponsor, and a user who loses a contest
-- loses nothing they put in. The CHECK on prize_funded_by is the structural form
-- of that rule, and a test asserts no column in this schema ever names a fee, a
-- stake or an entry.

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  captain_id  uuid not null references public.users(id) on delete restrict,
  invite_code text not null unique,
  member_min  integer not null default 5  check (member_min >= 1),
  member_max  integer not null default 30 check (member_max >= member_min and member_max <= 30),
  created_at  timestamptz not null default now(),

  constraint name_is_not_blank check (length(btrim(name)) > 0)
);

comment on column public.teams.invite_code is
  'Short, unambiguous, said out loud without spelling it. No 0/O or 1/I/L.';

create table public.team_members (
  team_id   uuid not null references public.teams(id) on delete cascade,
  user_id   uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),

  primary key (team_id, user_id)
);

-- One team per person. Office vs office only means anything if people belong to
-- one office, and a user split across five teams inflates five leaderboards.
create unique index team_members_one_team_per_user on public.team_members (user_id);

create index team_members_team_idx on public.team_members (team_id);

-- Ambiguity-free alphabet: no 0/O, no 1/I/L.
create or replace function private.generate_invite_code(p_length integer default 6)
returns text
language sql
volatile
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                           1 + floor(random() * 31)::int, 1), '')
    from generate_series(1, p_length)
$$;

create or replace function public.create_team(p_name text, p_city text default null)
returns public.teams
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_team public.teams;
  v_code text;
  v_try  integer := 0;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.team_members where user_id = v_user) then
    raise exception 'you are already in a team' using errcode = 'unique_violation';
  end if;

  loop
    v_try := v_try + 1;
    v_code := private.generate_invite_code();
    exit when not exists (select 1 from public.teams where invite_code = v_code);
    if v_try > 20 then
      raise exception 'could not allocate an invite code' using errcode = 'internal_error';
    end if;
  end loop;

  insert into public.teams (name, city, captain_id, invite_code)
  values (btrim(p_name), coalesce(p_city, (select city from public.users where id = v_user)),
          v_user, v_code)
  returning * into v_team;

  insert into public.team_members (team_id, user_id) values (v_team.id, v_user);
  return v_team;
end $$;

create or replace function public.join_team(p_invite_code text)
returns public.teams
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_team  public.teams;
  v_count integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into v_team from public.teams where invite_code = upper(btrim(p_invite_code));
  if not found then
    raise exception 'no team with that code' using errcode = 'no_data_found';
  end if;

  select count(*) into v_count from public.team_members where team_id = v_team.id;
  if v_count >= v_team.member_max then
    raise exception 'that team is full (% of %)', v_count, v_team.member_max
      using errcode = 'check_violation';
  end if;

  insert into public.team_members (team_id, user_id) values (v_team.id, v_user)
  on conflict do nothing;
  return v_team;
end $$;

-- ---------------------------------------------------------------------------
-- Friends — needed for the Friends leaderboard scope (§7.3). One row per pair.
-- ---------------------------------------------------------------------------
create table public.friendships (
  user_a     uuid not null references public.users(id) on delete cascade,
  user_b     uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (user_a, user_b),
  constraint stored_in_one_order check (user_a < user_b)
);

create index friendships_b_idx on public.friendships (user_b);

create or replace function public.friend_ids(p_user_id uuid)
returns setof uuid
language sql
stable
as $$
  select user_b from public.friendships where user_a = p_user_id
  union
  select user_a from public.friendships where user_b = p_user_id
$$;

-- ---------------------------------------------------------------------------
-- Challenges (§7.6)
-- ---------------------------------------------------------------------------
create table public.challenges (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  scope           text not null check (scope in ('city','team','friends','national')),
  scope_key       text not null default '',
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  prize_type      text not null check (prize_type in ('coins','voucher')),
  prize_value     integer not null check (prize_value > 0),
  prize_funded_by text not null check (prize_funded_by in ('house','sponsor')),
  sponsor_name    text,
  created_at      timestamptz not null default now(),

  constraint ends_after_start check (ends_at > starts_at),
  constraint sponsor_is_named check (prize_funded_by <> 'sponsor' or sponsor_name is not null)
);

comment on table public.challenges is
  'README §7.6, §13.4. Entry is free and there is no column here that could hold a fee '
  'or a stake. Prizes are funded by us or a sponsor — never out of a pool of user money — '
  'and are coins or store vouchers, never cash. A user who loses loses nothing they put in.';
comment on column public.challenges.prize_type is
  'coins or voucher. Never cash: cash out is the one thing that would drag this product '
  'into money-transmitter and gambling law simultaneously (§1, §13.3).';

-- ---------------------------------------------------------------------------
-- Leaderboards (§7.3)
--
-- Four scopes: City · Team · Friends · All Pakistan. Weekly, resetting Monday
-- 00:00 PKT, plus an all-time board — a permanent all-time-only board is dead to
-- anyone who joins in month three.
--
-- Ranks are snapshotted on a schedule, never computed on read. Friends is the
-- exception: every user has a different friend set, so it is filtered from the
-- national snapshot at read time rather than stored per user.
-- ---------------------------------------------------------------------------
create table public.leaderboard_snap (
  scope       text not null check (scope in ('national','city','team')),
  scope_key   text not null default '',
  period      text not null,              -- 'week:YYYY-MM-DD' (the Monday) or 'all_time'
  user_id     uuid not null references public.users(id) on delete cascade,
  steps       integer not null,
  rank        integer not null,
  computed_at timestamptz not null default now(),

  primary key (scope, scope_key, period, user_id)
);

create index leaderboard_snap_lookup on public.leaderboard_snap (scope, scope_key, period, rank);
create index leaderboard_snap_user   on public.leaderboard_snap (user_id, period);

comment on table public.leaderboard_snap is
  'README §7.3. Recomputed on a 15-minute cron; never ranked on read.';

-- Which step-days may rank. Flagged days are excluded from ranking but remain in
-- the user's own total, so a false positive never feels like theft (§7.3).
create or replace function private.rankable_steps(p_from date, p_to date)
returns table (user_id uuid, city text, steps bigint)
language sql
stable
as $$
  select d.user_id, u.city, sum(d.credited_steps)::bigint
    from public.daily_steps d
    join public.users u on u.id = d.user_id
   where d.date between p_from and p_to
     and d.attested
     and u.status = 'active'
     and not (d.flags && array['device_shared','rate_ceiling'])
   group by d.user_id, u.city
$$;

create or replace function private.rebuild_leaderboards()
returns integer
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_week_start date := public.pkt_week_start(now());
  v_period     text := 'week:' || v_week_start::text;
  v_rows       integer := 0;
  v_n          integer;
begin
  -- Weekly board: Monday 00:00 PKT to now.
  delete from public.leaderboard_snap where period = v_period;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'national', '', v_period, s.user_id, s.steps,
         rank() over (order by s.steps desc, s.user_id)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'city', s.city, v_period, s.user_id, s.steps,
         rank() over (partition by s.city order by s.steps desc, s.user_id)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s
   where s.city is not null;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'team', tm.team_id::text, v_period, s.user_id, s.steps,
         rank() over (partition by tm.team_id order by s.steps desc, s.user_id)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s
    join public.team_members tm on tm.user_id = s.user_id;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- All-time board, same three scopes.
  delete from public.leaderboard_snap where period = 'all_time';

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'national', '', 'all_time', s.user_id, s.steps,
         rank() over (order by s.steps desc, s.user_id)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'city', s.city, 'all_time', s.user_id, s.steps,
         rank() over (partition by s.city order by s.steps desc, s.user_id)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s
   where s.city is not null;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'team', tm.team_id::text, 'all_time', s.user_id, s.steps,
         rank() over (partition by tm.team_id order by s.steps desc, s.user_id)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s
    join public.team_members tm on tm.user_id = s.user_id;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  return v_rows;
end $$;

comment on function private.rebuild_leaderboards() is
  'Run every 15 minutes (§7.3: cache aggressively, do not rank on read). Rebuilds the '
  'current week and the all-time board across national, city and team scopes. Friends '
  'is derived at read time because every user''s friend set is different.';

create or replace function public.current_leaderboard_period()
returns text
language sql stable
as $$ select 'week:' || public.pkt_week_start(now())::text $$;

-- The board itself. Scope resolution is server-side: a client asks for "my city"
-- or "my team", it does not get to name someone else's.
create or replace function public.leaderboard(
  p_scope  text,
  p_period text default null,
  p_limit  integer default 50,
  p_offset integer default 0
) returns table (rank integer, user_id uuid, name text, city text, steps integer, is_me boolean)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_period text := coalesce(p_period, public.current_leaderboard_period());
  v_key    text;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_scope = 'friends' then
    return query
      select ls.rank, ls.user_id, u.name, u.city, ls.steps, ls.user_id = v_me
        from public.leaderboard_snap ls
        join public.users u on u.id = ls.user_id
       where ls.scope = 'national' and ls.period = v_period
         and (ls.user_id = v_me or ls.user_id in (select public.friend_ids(v_me)))
       order by ls.steps desc, ls.user_id
       limit p_limit offset p_offset;
    return;
  end if;

  v_key := case p_scope
             when 'national' then ''
             -- Fully qualified: RETURNS TABLE makes `city`, `steps`, `rank` and
             -- `user_id` PL/pgSQL variables, which collide with the columns.
             when 'city'     then coalesce((select u.city from public.users u where u.id = v_me), '')
             when 'team'     then coalesce((select tm.team_id::text from public.team_members tm
                                             where tm.user_id = v_me), '')
             else null
           end;
  if v_key is null then
    raise exception 'unknown leaderboard scope %', p_scope using errcode = 'check_violation';
  end if;

  return query
    select ls.rank, ls.user_id, u.name, u.city, ls.steps, ls.user_id = v_me
      from public.leaderboard_snap ls
      join public.users u on u.id = ls.user_id
     where ls.scope = p_scope and ls.scope_key = v_key and ls.period = v_period
     order by ls.rank
     limit p_limit offset p_offset;
end $$;

-- §7.3: always show the user their own rank, pinned, framed as a percentile.
-- "4,382 — top 12%" keeps a mid-table user engaged; a bare rank number does not.
create or replace function public.my_rank(p_scope text, p_period text default null)
returns table (rank integer, of_total integer, percentile integer, steps integer)
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_period text := coalesce(p_period, public.current_leaderboard_period());
  v_key    text;
  v_scope  text := p_scope;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_scope = 'friends' then
    return query
      with board as (
        select ls.user_id, ls.steps,
               rank() over (order by ls.steps desc, ls.user_id)::integer as r,
               count(*) over ()::integer as n
          from public.leaderboard_snap ls
         where ls.scope = 'national' and ls.period = v_period
           and (ls.user_id = v_me or ls.user_id in (select public.friend_ids(v_me)))
      )
      select b.r, b.n,
             greatest(1, ceil(100.0 * b.r / nullif(b.n, 0))::integer),
             b.steps
        from board b where b.user_id = v_me;
    return;
  end if;

  v_key := case v_scope
             when 'national' then ''
             -- Fully qualified: RETURNS TABLE makes `city`, `steps`, `rank` and
             -- `user_id` PL/pgSQL variables, which collide with the columns.
             when 'city'     then coalesce((select u.city from public.users u where u.id = v_me), '')
             when 'team'     then coalesce((select tm.team_id::text from public.team_members tm
                                             where tm.user_id = v_me), '')
             else null
           end;
  if v_key is null then
    raise exception 'unknown leaderboard scope %', v_scope using errcode = 'check_violation';
  end if;

  return query
    with board as (
      select ls.user_id, ls.rank, ls.steps, count(*) over ()::integer as n
        from public.leaderboard_snap ls
       where ls.scope = v_scope and ls.scope_key = v_key and ls.period = v_period
    )
    select b.rank, b.n,
           greatest(1, ceil(100.0 * b.rank / nullif(b.n, 0))::integer),
           b.steps
      from board b where b.user_id = v_me;
end $$;

comment on function public.my_rank(text, text) is
  '§7.3 — the pinned own-rank row, with the percentile that makes 4,382nd bearable.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.teams            enable row level security;
alter table public.team_members     enable row level security;
alter table public.friendships      enable row level security;
alter table public.challenges       enable row level security;
alter table public.leaderboard_snap enable row level security;

-- A team is public by design: joining from a deep link has to work before the
-- account exists, and a shareable weekly rank card is the growth mechanic (§7.6).
create policy teams_select_public on public.teams
  for select to anon, authenticated using (true);
create policy team_members_select_public on public.team_members
  for select to authenticated using (true);
create policy challenges_select_public on public.challenges
  for select to anon, authenticated using (true);
create policy friendships_select_self on public.friendships
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

grant select on public.teams, public.challenges to anon, authenticated;
grant select on public.team_members, public.friendships to authenticated;

-- leaderboard_snap is read only through the two functions above, which resolve
-- scope from the caller's own identity. No direct grant.

revoke all on function
  private.rebuild_leaderboards(),
  private.generate_invite_code(integer),
  private.rankable_steps(date, date)
from public, anon, authenticated;

revoke all on function public.leaderboard(text, text, integer, integer) from public;
revoke all on function public.my_rank(text, text) from public;
revoke all on function public.create_team(text, text) from public;
revoke all on function public.join_team(text) from public;
revoke all on function public.friend_ids(uuid) from public;

grant execute on function
  public.leaderboard(text, text, integer, integer),
  public.my_rank(text, text),
  public.create_team(text, text),
  public.join_team(text),
  public.current_leaderboard_period()
to authenticated;

grant execute on function private.rebuild_leaderboards() to service_role;
