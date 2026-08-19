-- 20260818001200_growth.sql
-- §7.6 teams, §7.7 referrals, §7.8 rewarded video.

-- ==========================================================================
-- §7.6 — "Make creating and sharing a team take under 30 seconds, and make
-- joining work from a deep link."
--
-- Both of these are RPCs rather than direct table writes so the invite code is
-- resolved server-side: a client that could query teams by code could also
-- enumerate every team in the country.
-- ==========================================================================
create or replace function create_team(p_name text, p_city text default null)
returns table (team_id uuid, invite_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_id   uuid;
  v_code text;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into teams (name, city, captain_id)
  values (btrim(p_name), coalesce(p_city, (select city from users where id = v_user)), v_user)
  returning id, teams.invite_code into v_id, v_code;

  -- The captain is added by trigger; no second round trip.
  return query select v_id, v_code;
end
$$;

create or replace function join_team(p_code text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_team uuid;
  v_size int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select id into v_team from teams where invite_code = upper(btrim(p_code));
  if v_team is null then
    raise exception 'no team with that code' using errcode = 'no_data_found';
  end if;

  select count(*) into v_size from team_members where team_id = v_team;
  if v_size >= 30 then
    raise exception 'that team is full (30 members maximum)' using errcode = 'check_violation';
  end if;

  insert into team_members (team_id, user_id) values (v_team, v_user)
  on conflict do nothing;

  return v_team;
end
$$;

-- A roster a client may read: names and this week's steps, no phone numbers.
create or replace function team_roster(p_team uuid)
returns table (user_id uuid, name text, steps bigint, is_captain boolean)
language sql stable security definer set search_path = public as $$
  select
    u.id,
    u.name,
    coalesce(sum(ds.credited_steps), 0)::bigint,
    u.id = t.captain_id
  from team_members tm
  join teams t on t.id = tm.team_id
  join users u on u.id = tm.user_id
  left join daily_steps ds
    on ds.user_id = u.id and ds.date >= pkt_week_start() and ds.date < pkt_week_start() + 7
  where tm.team_id = p_team
  group by u.id, u.name, t.captain_id
  order by 3 desc;
$$;

-- ==========================================================================
-- §7.8 — rewarded video. The ONLY ad surface in the app.
--
-- There is deliberately no interstitial or banner function anywhere in this
-- schema: §13.5 forbids an ad in the shopping flow, and one abandoned PKR 2,500
-- order wipes out months of ad revenue from that user.
--
-- The cap is enforced here, not in the client, and the reward is minted here,
-- not sent up from the app (§13.2).
-- ==========================================================================
create table ad_views (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  date       date not null default pkt_date(),
  created_at timestamptz not null default now()
);

create index ad_views_user_day_idx on ad_views (user_id, date);

create or replace function claim_rewarded_ad()
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := auth.uid();
  v_limit int  := config_int('REWARDED_AD_DAILY_LIMIT');
  v_coins int  := config_int('REWARDED_AD_COINS');
  v_today int;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Serialise per user: without this, two taps land two rewards past the cap.
  perform 1 from users where id = v_user for update;

  select count(*) into v_today from ad_views
  where user_id = v_user and date = pkt_date();

  if v_today >= v_limit then
    raise exception 'you have watched all % videos today', v_limit
      using errcode = 'check_violation';
  end if;

  insert into ad_views (user_id) values (v_user);
  perform credit_coins(v_user, v_coins, 'rewarded_ad');
  return v_coins;
end
$$;

-- ==========================================================================
-- §7.7 — "Show pending referrals so the referrer keeps nudging."
-- ==========================================================================
create view referral_status with (security_invoker = true) as
select
  r.referred_by                                                as referrer_id,
  r.id                                                         as referee_id,
  r.name                                                       as referee_name,
  r.created_at                                                 as joined_at,
  exists (
    select 1 from orders o where o.user_id = r.id and o.status = 'delivered'
  )                                                            as has_ordered
from users r
where r.referred_by is not null;

create or replace function my_referrals()
returns table (referee_name text, joined_at timestamptz, has_ordered boolean, coins int)
language sql stable security definer set search_path = public as $$
  select
    rs.referee_name,
    rs.joined_at,
    rs.has_ordered,
    config_int('REFERRAL_COINS_REFERRER')
  from referral_status rs
  where rs.referrer_id = auth.uid()
  order by rs.joined_at desc;
$$;

alter table ad_views enable row level security;
create policy ad_views_own on ad_views
  for select to authenticated using (user_id = auth.uid());
grant select on ad_views to authenticated;

grant execute on function create_team(text, text)   to authenticated;
grant execute on function join_team(text)           to authenticated;
grant execute on function team_roster(uuid)         to authenticated;
grant execute on function claim_rewarded_ad()       to authenticated;
grant execute on function my_referrals()            to authenticated;

-- Direct table writes are no longer needed now that the RPCs exist, and the
-- RPCs enforce the team-size cap and resolve invite codes without exposing them.
revoke insert on teams        from authenticated;
revoke insert on team_members from authenticated;
