-- Development seed. NEVER run this against production.
--
-- Every screen in the app is an empty state on a fresh database, which makes it
-- impossible to see whether the leaderboard ranks correctly, whether the wallet
-- groups batches the way §7.2 asks, or what the ledger rule looks like at 60%.
-- This gives you a week of plausible data to look at.
--
--   ./scripts/seed.sh              seeds the local test database
--   supabase db reset             runs it automatically after migrations
--
-- The guard below is not decoration: this file mints coins and writes step
-- history, and doing that to real users would be unrecoverable.

do $$
begin
  if exists (select 1 from public.users limit 1)
     and current_setting('qadam.allow_seed', true) is distinct from 'yes' then
    raise exception
      'refusing to seed a database that already has users. '
      'If you are certain, set qadam.allow_seed = ''yes'' first.'
      using errcode = 'restrict_violation';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- People. The auth.users insert fires on_auth_user_created, which creates the
-- public.users row and its referral code, exactly as a real signup would.
-- ---------------------------------------------------------------------------
create temporary table seed_people (
  slot     int primary key,
  id       uuid default gen_random_uuid(),
  name     text,
  city     text,
  phone    text,
  joined   interval
);

insert into seed_people (slot, name, city, phone, joined) values
  (1, 'Ayesha Khan',    'Lahore',     '+923001000001', interval '120 days'),
  (2, 'Bilal Ahmed',    'Lahore',     '+923001000002', interval '95 days'),
  (3, 'Hina Raza',      'Lahore',     '+923001000003', interval '60 days'),
  (4, 'Usman Tariq',    'Lahore',     '+923001000004', interval '40 days'),
  (5, 'Sana Malik',     'Karachi',    '+923001000005', interval '80 days'),
  (6, 'Faisal Iqbal',   'Karachi',    '+923001000006', interval '30 days'),
  (7, 'Mahnoor Sheikh', 'Islamabad',  '+923001000007', interval '20 days'),
  (8, 'Zain Abbas',     'Lahore',     '+923001000008', interval '3 days');

insert into auth.users (id, phone) select id, phone from seed_people;

update public.users u
   set name = p.name, city = p.city, created_at = now() - p.joined
  from seed_people p where u.id = p.id;

-- ---------------------------------------------------------------------------
-- A week and a bit of walking.
--
-- Deliberately uneven: someone who hits the cap most days, someone who walks a
-- decent 6–9k, someone who misses days so their streak is broken, and a brand
-- new account with two days of history. A seed where everyone walks the same
-- amount tells you nothing about whether the board sorts.
-- ---------------------------------------------------------------------------
insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select p.id,
       public.pkt_date(now()) - d,
       steps.raw,
       least(steps.raw, 15000),
       (least(steps.raw, 15000) / 100)::int,
       'health_connect',
       true
  from seed_people p
  cross join generate_series(0, 9) d
  cross join lateral (
    select case
             -- Ayesha is the one at the top of the board.
             when p.slot = 1 then 14000 + (d * 137) % 2000
             when p.slot = 2 then 9000  + (d * 211) % 3000
             when p.slot = 3 then 6000  + (d * 173) % 2500
             -- Usman misses every third day, so his streak is broken.
             when p.slot = 4 then case when d % 3 = 0 then 900 else 7500 + (d * 91) % 1500 end
             when p.slot = 5 then 11000 + (d * 157) % 2000
             when p.slot = 6 then 5200  + (d * 119) % 1800
             when p.slot = 7 then 3000  + (d * 233) % 4000
             -- Zain joined three days ago; anything older would be a lie.
             else case when d <= 2 then 8000 + (d * 313) % 2000 else 0 end
           end as raw
  ) steps
 where steps.raw > 0;

-- Coins to match, in a few batches so the wallet has something to group (§7.2).
-- One of Ayesha's batches is dated to lapse in four days so the expiring-coins
-- card and the seven-day push both have something real to fire on.
insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date, meta)
select p.id,
       (select sum(coins_awarded) from public.daily_steps d
         where d.user_id = p.id and d.date > public.pkt_date(now()) - 5),
       'steps',
       now() + interval '86 days',
       public.pkt_date(now()) - 1,
       '{"seed": true}'::jsonb
  from seed_people p
 where exists (select 1 from public.daily_steps d where d.user_id = p.id);

insert into public.coin_ledger (user_id, delta, reason, expires_at, step_date, meta)
select p.id, 2400, 'steps', now() + interval '4 days', public.pkt_date(now()) - 88,
       '{"seed": true, "note": "about to lapse"}'::jsonb
  from seed_people p where p.slot = 1;

-- ---------------------------------------------------------------------------
-- A team, some friends, and a live challenge.
-- ---------------------------------------------------------------------------
insert into public.teams (id, name, city, captain_id, invite_code)
select '00000000-0000-4000-8000-000000000001', 'Gulberg Walkers', 'Lahore', p.id, 'GULB27'
  from seed_people p where p.slot = 1;

insert into public.team_members (team_id, user_id)
select '00000000-0000-4000-8000-000000000001', p.id
  from seed_people p where p.slot in (1, 2, 3, 4, 8);

insert into public.friendships (user_a, user_b)
select least(a.id, b.id), greatest(a.id, b.id)
  from seed_people a, seed_people b
 where (a.slot, b.slot) in ((1, 5), (1, 2), (2, 7))
on conflict do nothing;

insert into public.challenges (title, scope, scope_key, starts_at, ends_at,
                               prize_type, prize_value, prize_funded_by, sponsor_name)
values
  ('Lahore vs Karachi', 'city', '', public.pkt_day_start(public.pkt_week_start(now())),
   public.pkt_day_start(public.pkt_week_start(now())) + interval '7 days',
   'coins', 5000, 'house', null),
  ('Office league', 'team', '', now() - interval '2 days', now() + interval '12 days',
   'voucher', 3000, 'sponsor', 'A Lahore Brand');

-- ---------------------------------------------------------------------------
-- A little catalogue, so §0 is visible rather than theoretical.
--
-- The phone is the point: 5% margin, and the formula caps its discount near 1%
-- with no special-casing anywhere.
-- ---------------------------------------------------------------------------
insert into public.brands (id, name, contact, commission_pct, status) values
  ('00000000-0000-4000-8000-000000000010', 'Kanwal Clothing', 'kanwal@example.com', 22, 'active'),
  ('00000000-0000-4000-8000-000000000011', 'Ravi Electronics', 'ravi@example.com', 6, 'active');

insert into public.categories (id, name, coin_eligible, sort_order) values
  ('00000000-0000-4000-8000-000000000020', 'Clothing', true, 1),
  ('00000000-0000-4000-8000-000000000021', 'Electronics', true, 2);

insert into public.products (title, brand_id, category_id, price_pkr, cost_pkr, stock, source, images)
values
  ('Lawn kurta',        '00000000-0000-4000-8000-000000000010',
                        '00000000-0000-4000-8000-000000000020', 3200, 1900, 40, 'consignment', '[]'),
  ('Embroidered shawl', '00000000-0000-4000-8000-000000000010',
                        '00000000-0000-4000-8000-000000000020', 5500, 3100, 12, 'consignment', '[]'),
  ('Wireless earbuds',  '00000000-0000-4000-8000-000000000011',
                        '00000000-0000-4000-8000-000000000021', 6900, 5200, 25, 'owned', '[]'),
  ('Smartphone 128GB',  '00000000-0000-4000-8000-000000000011',
                        '00000000-0000-4000-8000-000000000021', 94000, 89000, 6, 'owned', '[]');

select private.rebuild_leaderboards();

-- What you just got.
do $$
declare
  v_users int; v_days int; v_coins bigint; v_products int;
begin
  select count(*) into v_users from public.users;
  select count(*) into v_days from public.daily_steps;
  select coalesce(sum(delta), 0) into v_coins from public.coin_ledger where delta > 0;
  select count(*) into v_products from public.products;
  raise notice 'seeded: % users, % step-days, % coins minted, % products',
    v_users, v_days, v_coins, v_products;
end $$;
