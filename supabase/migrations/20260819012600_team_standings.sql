-- README §7.6 — "Office vs office, university vs university, neighbourhood vs
-- neighbourhood."
--
-- The leaderboard so far ranks PEOPLE, including people within a team. That is
-- not what office-vs-office means, and a shareable card of "the team's weekly
-- rank" needs a rank for the team itself.
--
-- Totals rather than averages, deliberately. An average rewards a team for
-- keeping its numbers small, which is the opposite of the growth mechanic: §7.6
-- exists so one captain recruits twenty people for us.

create or replace function public.team_standings(p_limit integer default 50)
returns table (
  rank integer, team_id uuid, name text, city text,
  members integer, steps bigint, is_mine boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with weekly as (
    select tm.team_id, sum(s.steps)::bigint as steps, count(distinct tm.user_id)::integer as members
      from private.rankable_steps(public.pkt_week_start(now()), public.pkt_date(now())) s
      join public.team_members tm on tm.user_id = s.user_id
     group by tm.team_id
  ),
  ranked as (
    select t.id, t.name, t.city,
           coalesce(w.members, 0) as members,
           coalesce(w.steps, 0) as steps,
           rank() over (order by coalesce(w.steps, 0) desc) as rnk
      from public.teams t
      left join weekly w on w.team_id = t.id
  )
  select r.rnk::integer, r.id, r.name, r.city, r.members, r.steps,
         r.id = (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
    from ranked r
   order by r.rnk, r.name
   limit greatest(1, least(p_limit, 100))
$$;

comment on function public.team_standings(integer) is
  'README §7.6. Teams ranked by this week''s total steps. Totals, not averages — an '
  'average rewards a team for staying small, and the whole point of teams is that one '
  'captain recruits twenty people.';

create or replace function public.my_team_standing()
returns table (rank integer, of_total integer, name text, members integer, steps bigint)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with all_teams as (select * from public.team_standings(100))
  select a.rank, (select count(*)::integer from all_teams), a.name, a.members, a.steps
    from all_teams a where a.is_mine
$$;

revoke all on function
  public.team_standings(integer), public.my_team_standing() from public, anon;
grant execute on function
  public.team_standings(integer), public.my_team_standing() to authenticated;
