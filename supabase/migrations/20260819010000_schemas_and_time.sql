-- Foundations: the private schema, and the Asia/Karachi business day.
--
-- Pakistan is UTC+5 with no daylight saving. Every "day" in this product — the
-- daily step cap, the streak, the Monday leaderboard reset — is a PKT day. Cast a
-- timestamptz straight to date anywhere and the day rolls over at 5am local time,
-- which silently breaks every streak in the country.

create schema if not exists private;

comment on schema private is
  'Server-only. Never added to PostgREST''s exposed schemas. Anything a client must '
  'not see — the coin conversion rate, cost prices, fraud thresholds — lives here.';

-- Nothing is readable in here by default. Grants are explicit, in the RLS migration.
revoke all on schema private from public;

create or replace function public.pkt_date(p_ts timestamptz default now())
returns date
language sql
stable
as $$ select (p_ts at time zone 'Asia/Karachi')::date $$;

comment on function public.pkt_date(timestamptz) is
  'The Pakistan business day a moment falls in. Use this instead of ::date, always.';

-- Monday 00:00 PKT is the leaderboard reset. Returns the PKT date of that Monday.
create or replace function public.pkt_week_start(p_ts timestamptz default now())
returns date
language sql
stable
as $$
  select public.pkt_date(p_ts) - ((extract(isodow from public.pkt_date(p_ts))::int - 1))
$$;

comment on function public.pkt_week_start(timestamptz) is
  'PKT date of the Monday that opens the leaderboard week containing p_ts (README §7.3).';

-- The moment a PKT date begins, as a real timestamptz.
create or replace function public.pkt_day_start(p_date date)
returns timestamptz
language sql
stable
as $$ select (p_date::timestamp at time zone 'Asia/Karachi') $$;
