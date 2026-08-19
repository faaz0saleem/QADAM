-- README §7.3 — two people who walked exactly the same distance are tied.
--
-- The first version of rebuild_leaderboards ranked on (steps desc, user_id),
-- which is a stable sort but not a ranking: it silently broke every tie by UUID.
-- With a prize attached — §7.6 challenges award coins and vouchers — "you came
-- second because your account id sorts later" is not a defensible answer.
--
-- So the RANK is computed on steps alone, which is what rank() is for, and the
-- ORDER for display is (rank, user_id), which keeps pagination stable without
-- letting the tiebreak leak into the number anyone is shown.

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
         rank() over (order by s.steps desc)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'city', s.city, v_period, s.user_id, s.steps,
         rank() over (partition by s.city order by s.steps desc)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s
   where s.city is not null;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'team', tm.team_id::text, v_period, s.user_id, s.steps,
         rank() over (partition by tm.team_id order by s.steps desc)
    from private.rankable_steps(v_week_start, public.pkt_date(now())) s
    join public.team_members tm on tm.user_id = s.user_id;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  -- All-time board, same three scopes.
  delete from public.leaderboard_snap where period = 'all_time';

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'national', '', 'all_time', s.user_id, s.steps,
         rank() over (order by s.steps desc)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'city', s.city, 'all_time', s.user_id, s.steps,
         rank() over (partition by s.city order by s.steps desc)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s
   where s.city is not null;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  insert into public.leaderboard_snap (scope, scope_key, period, user_id, steps, rank)
  select 'team', tm.team_id::text, 'all_time', s.user_id, s.steps,
         rank() over (partition by tm.team_id order by s.steps desc)
    from private.rankable_steps('epoch'::date, public.pkt_date(now())) s
    join public.team_members tm on tm.user_id = s.user_id;
  get diagnostics v_n = row_count; v_rows := v_rows + v_n;

  return v_rows;
end $$;

-- Display order: rank first, then a stable tiebreak so pagination does not
-- shuffle people between pages. The tiebreak decides where a row is drawn, never
-- what number it is given.
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
     order by ls.rank, ls.user_id
     limit p_limit offset p_offset;
end $$;

revoke all on function public.leaderboard(text, text, integer, integer) from public, anon;
grant execute on function public.leaderboard(text, text, integer, integer) to authenticated;
