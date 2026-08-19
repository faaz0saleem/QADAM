-- README §7.6 — surfacing a live challenge.
--
-- Viewing only. Creating and sponsoring challenges is Phase 3 (§10), and the
-- admin path for it does not exist yet — deliberately, because a challenge that
-- can be created before there is anyone to enter it is a feature built for
-- nobody.
--
-- Note what is NOT here: no entry, no join, no accept. §13.4 — entry is free and
-- there is nothing to opt into, because there is nothing at stake. A user is in
-- their city's challenge by being in that city.

create or replace function public.active_challenges()
returns table (
  id              uuid,
  title           text,
  scope           text,
  ends_at         timestamptz,
  days_left       integer,
  prize_type      text,
  prize_value     integer,
  prize_funded_by text,
  sponsor_name    text,
  applies_to_me   boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.id,
         c.title,
         c.scope,
         c.ends_at,
         greatest(0, public.pkt_date(c.ends_at) - public.pkt_date(now()))::integer,
         c.prize_type,
         c.prize_value,
         c.prize_funded_by,
         c.sponsor_name,
         -- A challenge is yours if it is national, or if its scope matches
         -- something you are already part of. There is nothing to join.
         case c.scope
           when 'national' then true
           when 'city'     then c.scope_key = '' or c.scope_key
                                 = coalesce((select u.city from public.users u where u.id = auth.uid()), '')
           when 'team'     then exists (select 1 from public.team_members m where m.user_id = auth.uid())
           when 'friends'  then exists (select 1 from public.friendships f
                                         where f.user_a = auth.uid() or f.user_b = auth.uid())
           else false
         end
    from public.challenges c
   where c.starts_at <= now() and c.ends_at > now()
   order by c.ends_at
$$;

comment on function public.active_challenges() is
  'README §7.6. Live challenges, flagged with whether they apply to the caller. '
  'There is no join or entry step: entry is free and nothing is at stake (§13.4).';

revoke all on function public.active_challenges() from public, anon;
grant execute on function public.active_challenges() to authenticated;
