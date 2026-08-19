-- 20260818999700_close_idor.sql
--
-- Four client-callable functions took a user id and ran as SECURITY DEFINER,
-- which means they bypassed RLS and answered for whichever id they were given:
--
--   affordable_discount_pkr(other_user, product)  -> reveals their coin balance
--   current_streak(other_user)                    -> reveals their streak
--   leaderboard_page(other_user, ...)             -> reveals their city and rank
--   leaderboard_friends(other_user)               -> reveals their entire friends list
--
-- Individually small; together they are a directory of every user's habits,
-- readable by anyone with an account and a list of ids — and ids are visible on
-- a leaderboard.
--
-- The parameter stays, because Edge Functions and cron jobs legitimately call
-- these for other people. What changes is that a request carrying a JWT may only
-- ask about itself. service_role has no auth.uid(), so the server path is
-- unaffected.

create or replace function assert_self(p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  -- No JWT means service_role or a cron job: the server asking on someone's
  -- behalf, which is the whole point of these functions taking an id.
  if auth.uid() is null then
    return;
  end if;
  if p_user is distinct from auth.uid() then
    raise exception 'that is not your data' using errcode = 'insufficient_privilege';
  end if;
end
$$;

-- No client grant: it is only ever called from inside the SECURITY DEFINER
-- functions below, which run as the owner.
revoke all on function assert_self(uuid) from public, anon, authenticated;

create or replace function affordable_discount_pkr(p_user uuid, p_product uuid, p_qty int default 1)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_ceiling  int;
  v_eligible boolean;
  v_wallet   int;
  v_created  timestamptz;
begin
  perform assert_self(p_user);

  select max_coin_discount_pkr(p.price_pkr, p.cost_pkr) * p_qty,
         coalesce(c.coin_eligible, true)
    into v_ceiling, v_eligible
  from products p
  left join categories c on c.id = p.category_id
  where p.id = p_product;

  if v_ceiling is null or not v_eligible then
    return 0;
  end if;

  -- §6.1's redemption lock has to be visible here, not only at checkout: a shop
  -- that advertises a discount to an account that cannot yet redeem sends the
  -- user to a checkout that refuses them.
  select created_at into v_created from users where id = p_user;
  if v_created is null
     or v_created > now() - make_interval(days => config_int('REDEMPTION_LOCK_DAYS')) then
    return 0;
  end if;

  v_wallet := floor(coin_balance(p_user) * config_num('COIN_VALUE_PKR'))::int;
  return least(v_ceiling, v_wallet);
end
$$;

create or replace function current_streak(p_user uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_bar    int := config_int('STREAK_QUALIFYING_STEPS');
  v_today  date := pkt_date();
  v_cursor date;
  v_streak int := 0;
begin
  perform assert_self(p_user);

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

-- The leaderboard functions are self-scoped by adding the guard at the top; the
-- bodies are unchanged and stay in their original migrations.
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
  perform assert_self(p_user);

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
  perform assert_self(p_user);

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
