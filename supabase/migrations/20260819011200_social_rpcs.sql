-- README §7.3 friends, §7.6 teams — the write paths the app needs.
--
-- friendships and team_members are readable but not writable by a client: the
-- policies grant SELECT and nothing else. That is deliberate. Every mutation
-- goes through a function here so the rules — no self-friending, one team per
-- person, a full team is full — live in one place instead of being re-derived by
-- whichever screen happens to be doing the writing.
--
-- A person's referral code doubles as their friend code. One code to share, one
-- thing to explain, and it already exists on every account from signup.

-- ---------------------------------------------------------------------------
-- Friends
-- ---------------------------------------------------------------------------
create or replace function public.add_friend(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_friend record;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select u.id, u.name into v_friend
    from public.users u
   where u.referral_code = upper(btrim(p_code)) and u.status <> 'banned';

  if v_friend.id is null then
    raise exception 'no one has that code' using errcode = 'no_data_found';
  end if;
  if v_friend.id = v_me then
    raise exception 'you cannot add yourself' using errcode = 'check_violation';
  end if;

  -- Stored once, in a fixed order, so the pair cannot exist twice under two
  -- different spellings of the same friendship.
  insert into public.friendships (user_a, user_b)
  values (least(v_me, v_friend.id), greatest(v_me, v_friend.id))
  on conflict do nothing;

  return jsonb_build_object('added', true, 'name', v_friend.name);
end $$;

create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;
  delete from public.friendships
   where user_a = least(v_me, p_friend_id) and user_b = greatest(v_me, p_friend_id);
end $$;

create or replace function public.my_friends()
returns table (user_id uuid, name text, city text)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select u.id, u.name, u.city
    from public.users u
   where u.id in (select public.friend_ids(auth.uid()))
   order by u.name nulls last
$$;

-- ---------------------------------------------------------------------------
-- Teams
-- ---------------------------------------------------------------------------
create or replace function public.my_team()
returns table (
  team_id     uuid,
  name        text,
  city        text,
  invite_code text,
  is_captain  boolean,
  member_count integer,
  member_max  integer
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select t.id, t.name, t.city, t.invite_code,
         t.captain_id = auth.uid(),
         (select count(*)::integer from public.team_members m where m.team_id = t.id),
         t.member_max
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
   where tm.user_id = auth.uid()
$$;

create or replace function public.team_roster()
returns table (user_id uuid, name text, joined_at timestamptz, is_captain boolean, is_me boolean)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select u.id, u.name, tm.joined_at, t.captain_id = u.id, u.id = auth.uid()
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    join public.users u on u.id = tm.user_id
   where tm.team_id = (select m.team_id from public.team_members m where m.user_id = auth.uid())
   order by tm.joined_at
$$;

-- Leaving. The captain cannot walk out on a team that still has people in it —
-- a team whose captain_id points at a non-member is a team nobody can
-- administer. They hand over first, or they are the last one out and the team
-- goes with them.
create or replace function public.leave_team()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_team    record;
  v_others  integer;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select t.* into v_team
    from public.teams t
    join public.team_members tm on tm.team_id = t.id
   where tm.user_id = v_me;
  if not found then return; end if;

  select count(*) into v_others
    from public.team_members where team_id = v_team.id and user_id <> v_me;

  if v_team.captain_id = v_me and v_others > 0 then
    raise exception 'hand the team over before you leave it'
      using errcode = 'check_violation';
  end if;

  delete from public.team_members where team_id = v_team.id and user_id = v_me;
  if v_others = 0 then
    delete from public.teams where id = v_team.id;
  end if;
end $$;

create or replace function public.hand_over_captaincy(p_to_user uuid)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  update public.teams t
     set captain_id = p_to_user
   where t.captain_id = v_me
     and exists (select 1 from public.team_members m
                  where m.team_id = t.id and m.user_id = p_to_user);

  if not found then
    raise exception 'only the captain can hand over, and only to a member'
      using errcode = 'check_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
revoke all on function
  public.add_friend(text),
  public.remove_friend(uuid),
  public.my_friends(),
  public.my_team(),
  public.team_roster(),
  public.leave_team(),
  public.hand_over_captaincy(uuid)
from public, anon;

grant execute on function
  public.add_friend(text),
  public.remove_friend(uuid),
  public.my_friends(),
  public.my_team(),
  public.team_roster(),
  public.leave_team(),
  public.hand_over_captaincy(uuid)
to authenticated;
