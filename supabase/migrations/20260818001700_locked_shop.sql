-- 20260818001700_locked_shop.sql
-- docs/METRICS.md §1.5 — the locked shop, and the notify-me capture.
--
-- Phase 1 measures retention. It does NOT measure whether the people who enjoy
-- streaks and leaderboards are the same people who will browse a catalogue and
-- buy — and if those audiences do not overlap, Phase 1 can pass every gate and
-- Phase 2 can still fail.
--
-- So the shop ships in Phase 1 with real products, real prices and real coin
-- discounts, and an "opening soon" state instead of a buy button. What comes
-- back is a ranked list of what to stock and which brands to call, which makes
-- it worth building even if the numbers are fine.

insert into app_config (key, value, description) values
  ('SHOP_OPEN', 0, '0 = locked, browse-only with notify-me (§1.5). 1 = checkout live.');

-- Deliberately its own function rather than exposing app_config: the client
-- needs one boolean, and app_config holds COIN_VALUE_PKR (§4).
--
-- Granted to `authenticated` only. The catalogue itself is readable signed-out
-- so a shared product link works, but whether checkout is live is an operational
-- fact with no reason to be public.
create or replace function shop_is_open() returns boolean
language sql stable security definer set search_path = public as $$
  select config_num('SHOP_OPEN') >= 1;
$$;

create table notify_me (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  -- Optional: they are already signed in, so we can reach them. A number here
  -- means "message me on WhatsApp about this", which is a stronger signal than
  -- a tap and is the one §1.5 actually wants to count.
  contact    text,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index notify_me_product_idx on notify_me (product_id, created_at desc);

comment on table notify_me is
  'docs/METRICS.md §1.5: the strongest available proxy for purchase intent '
  'before a single brand is signed or a single unit of stock is bought.';

create or replace function register_interest(p_product uuid, p_contact text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into notify_me (user_id, product_id, contact)
  values (v_user, p_product, nullif(btrim(coalesce(p_contact, '')), ''))
  on conflict (user_id, product_id) do update
    set contact = coalesce(excluded.contact, notify_me.contact);
end
$$;

-- §1.5's table, ready to read: which categories get viewed, and what to stock
-- first. An operator's view, not a user's.
create view demand_signals with (security_invoker = true) as
select
  coalesce(c.name, 'Uncategorised')                        as category,
  p.title,
  p.price_pkr,
  count(distinct n.user_id)                                as notify_me_count,
  count(distinct n.user_id) filter (where n.contact is not null) as gave_a_number,
  min(n.created_at)                                        as first_interest,
  max(n.created_at)                                        as latest_interest
from notify_me n
join products p on p.id = n.product_id
left join categories c on c.id = p.category_id
group by 1, 2, 3
order by notify_me_count desc, latest_interest desc;

-- §1.5's headline: shop open rate among weekly actives, and notify-me rate.
create or replace function shop_interest_signals()
returns table (
  weekly_actives            bigint,
  opened_shop               bigint,
  opened_shop_pct           numeric,
  left_notify_me            bigint,
  left_notify_me_pct        numeric,
  products_per_shop_session numeric,
  verdict                   text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_actives  bigint;
  v_opened   bigint;
  v_notified bigint;
  v_ppv      numeric;
  v_open_pct numeric;
  v_note_pct numeric;
begin
  select count(distinct user_id) into v_actives
  from analytics_events
  where name = 'app_open' and occurred_at >= now() - interval '7 days';

  select count(distinct user_id) into v_opened
  from analytics_events
  where name in ('store_opened','shop_locked_viewed')
    and occurred_at >= now() - interval '7 days';

  select count(distinct user_id) into v_notified
  from analytics_events
  where name = 'notify_me_submitted' and occurred_at >= now() - interval '7 days';

  select coalesce(avg(views), 0) into v_ppv
  from (
    select session_id, count(*) filter (where name = 'product_viewed') as views
    from analytics_events
    where occurred_at >= now() - interval '7 days'
    group by session_id
    having bool_or(name in ('store_opened','shop_locked_viewed'))
  ) s;

  v_open_pct := round(100.0 * v_opened  / nullif(v_actives, 0), 1);
  v_note_pct := round(100.0 * v_notified / nullif(v_actives, 0), 1);

  return query select
    v_actives, v_opened, coalesce(v_open_pct, 0), v_notified, coalesce(v_note_pct, 0),
    round(v_ppv, 2),
    case
      -- §1.5: green is 30%+ opening and 8%+ leaving a notify-me.
      when coalesce(v_open_pct, 0) >= 30 and coalesce(v_note_pct, 0) >= 8 then 'green'
      when coalesce(v_open_pct, 0) < 15 then
        'warning — under 15% open rate, worth attention before a brand is signed'
      else 'amber'
    end;
end
$$;

alter table notify_me enable row level security;

create policy notify_me_own on notify_me
  for select to authenticated using (user_id = auth.uid());
