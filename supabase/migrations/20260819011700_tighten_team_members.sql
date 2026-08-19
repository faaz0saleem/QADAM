-- team_members was readable by every signed-in user.
--
-- `using (true)` was written so the You screen could read its own team by
-- querying the table directly. It also let any signed-in account enumerate every
-- membership in the country. There are no names in the table, so what leaks is a
-- graph of user ids to team ids — not catastrophic, and not something any part
-- of the product needs either.
--
-- The roster is served by public.team_roster(), which is security definer and
-- shows exactly one team: the caller's. The policy can therefore be as narrow as
-- the truth — a row about you.

drop policy if exists team_members_select_public on public.team_members;

create policy team_members_select_self on public.team_members
  for select to authenticated using (user_id = auth.uid());

comment on table public.team_members is
  'One row per person per team, and a person is in at most one. Direct reads see '
  'only your own row; the roster comes from public.team_roster(), which is '
  'security definer and scoped to the team you are in.';
