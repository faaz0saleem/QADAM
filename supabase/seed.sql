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
-- A catalogue, loaded the way a real one arrives (README §8).
--
-- Not typed straight into public.products. Every row below goes through
-- private.import_feed_rows() against a supplier_feeds row that names a licence,
-- because that is the only path a product is supposed to take into this shop and
-- a seed that skips it is a seed that stops testing the thing it should.
--
-- Six brands, eight categories, and enough SKUs that the store screen is a shop
-- rather than a demo. §7.4 still applies — "twenty good SKUs beat five thousand
-- dropshipped ones" — and these are the shape of a signed consignment list, not
-- a scrape: goods we could actually put in a box.
--
-- The phone is still the point: 5% margin, and §0 caps its discount near 1% with
-- no special-casing anywhere. The lawn kurta beside it carries 40%, and gets the
-- full 10%-of-price cap. One formula, two very different answers.
-- ---------------------------------------------------------------------------
insert into public.brands (id, name, contact, commission_pct, status) values
  ('00000000-0000-4000-8000-000000000010', 'Kanwal Clothing', 'kanwal@example.com', 22, 'active'),
  ('00000000-0000-4000-8000-000000000011', 'Ravi Electronics', 'ravi@example.com', 6, 'active'),
  ('00000000-0000-4000-8000-000000000012', 'Sahiwal Leather', 'sahiwal@example.com', 26, 'active'),
  ('00000000-0000-4000-8000-000000000013', 'Meher Home', 'meher@example.com', 24, 'active'),
  ('00000000-0000-4000-8000-000000000014', 'Zaib Beauty', 'zaib@example.com', 30, 'active'),
  ('00000000-0000-4000-8000-000000000015', 'Qadam Active', 'active@example.com', 28, 'active');

insert into public.categories (id, name, coin_eligible, sort_order) values
  ('00000000-0000-4000-8000-000000000020', 'Women''s clothing', true, 1),
  ('00000000-0000-4000-8000-000000000021', 'Men''s clothing', true, 2),
  ('00000000-0000-4000-8000-000000000022', 'Footwear', true, 3),
  ('00000000-0000-4000-8000-000000000023', 'Bags & accessories', true, 4),
  ('00000000-0000-4000-8000-000000000024', 'Home & kitchen', true, 5),
  ('00000000-0000-4000-8000-000000000025', 'Beauty', true, 6),
  ('00000000-0000-4000-8000-000000000026', 'Electronics', true, 7),
  ('00000000-0000-4000-8000-000000000027', 'Fitness', true, 8);

insert into public.supplier_feeds (id, name, brand_id, kind, licence, licence_url) values
  ('00000000-0000-4000-8000-000000000030', 'Kanwal Clothing consignment', '00000000-0000-4000-8000-000000000010', 'consignment', 'consignment agreement signed 2026-02-01', null),
  ('00000000-0000-4000-8000-000000000031', 'Ravi Electronics wholesale', '00000000-0000-4000-8000-000000000011', 'wholesale', 'purchase orders, stock held in our own warehouse', null),
  ('00000000-0000-4000-8000-000000000032', 'Sahiwal Leather consignment', '00000000-0000-4000-8000-000000000012', 'consignment', 'consignment agreement signed 2026-02-01', null),
  ('00000000-0000-4000-8000-000000000033', 'Meher Home consignment', '00000000-0000-4000-8000-000000000013', 'consignment', 'consignment agreement signed 2026-02-01', null),
  ('00000000-0000-4000-8000-000000000034', 'Zaib Beauty consignment', '00000000-0000-4000-8000-000000000014', 'consignment', 'consignment agreement signed 2026-02-01', null),
  ('00000000-0000-4000-8000-000000000035', 'Qadam Active consignment', '00000000-0000-4000-8000-000000000015', 'consignment', 'consignment agreement signed 2026-02-01', null),
  ('00000000-0000-4000-8000-00000000003f', 'Partner affiliate feed', null, 'affiliate',
   'affiliate programme terms, accepted 2026-03-11', 'https://partner.example/affiliates/terms');

select private.import_feed_rows('00000000-0000-4000-8000-000000000030',
  $seed$[{"sku": "KC-101", "title": "Lawn kurta, navy", "price": "3200", "cost": "1900", "stock": "40", "category": "Women's clothing", "description": "Unstitched two-piece, printed lawn"}, {"sku": "KC-102", "title": "Lawn kurta, rust", "price": "3200", "cost": "1900", "stock": "26", "category": "Women's clothing", "description": "Unstitched two-piece, printed lawn"}, {"sku": "KC-103", "title": "Embroidered shawl", "price": "5500", "cost": "3100", "stock": "12", "category": "Women's clothing", "description": "Pashmina blend, hand-worked border"}, {"sku": "KC-104", "title": "Cotton shalwar kameez, olive", "price": "4200", "cost": "2500", "stock": "18", "category": "Women's clothing", "description": "Stitched, ready to wear"}, {"sku": "KC-105", "title": "Chiffon dupatta", "price": "1800", "cost": "950", "stock": "60", "category": "Women's clothing", "description": "Two metres, rolled edge"}, {"sku": "KC-106", "title": "Khaddar three-piece, winter", "price": "6400", "cost": "3800", "stock": "22", "category": "Women's clothing", "description": "Shirt, trouser and shawl"}, {"sku": "KC-107", "title": "Printed kaftan", "price": "3900", "cost": "2200", "stock": "15", "category": "Women's clothing", "description": "Loose fit, viscose"}, {"sku": "KC-108", "title": "Silk scarf", "price": "2200", "cost": "1200", "stock": "34", "category": "Women's clothing", "description": "Square, hand-rolled"}, {"sku": "KC-201", "title": "Men's kurta, white", "price": "3600", "cost": "2100", "stock": "30", "category": "Men's clothing", "description": "Cotton, mandarin collar"}, {"sku": "KC-202", "title": "Men's waistcoat, charcoal", "price": "5200", "cost": "3000", "stock": "14", "category": "Men's clothing", "description": "Wool blend, five button"}, {"sku": "KC-203", "title": "Kameez shalwar, grey", "price": "4800", "cost": "2800", "stock": "20", "category": "Men's clothing", "description": "Wash-and-wear"}, {"sku": "KC-204", "title": "Cotton shirt, checked", "price": "2900", "cost": "1650", "stock": "28", "category": "Men's clothing", "description": "Full sleeve, single pocket"}, {"sku": "KC-205", "title": "Fleece hoodie", "price": "3400", "cost": "1900", "stock": "25", "category": "Men's clothing", "description": "Brushed inside, kangaroo pocket"}]$seed$::jsonb);

select private.import_feed_rows('00000000-0000-4000-8000-000000000031',
  $seed$[{"sku": "RE-801", "title": "Wireless earbuds", "price": "6900", "cost": "5200", "stock": "25", "category": "Electronics", "description": "Bluetooth 5.3, charging case"}, {"sku": "RE-802", "title": "Smartphone 128GB", "price": "94000", "cost": "89000", "stock": "6", "category": "Electronics", "description": "Six point six inch, dual SIM"}, {"sku": "RE-803", "title": "Power bank 20000mAh", "price": "5400", "cost": "4300", "stock": "20", "category": "Electronics", "description": "Twenty watt fast charge"}, {"sku": "RE-804", "title": "Bluetooth speaker", "price": "4800", "cost": "3700", "stock": "16", "category": "Electronics", "description": "Six hour battery, splash proof"}, {"sku": "RE-805", "title": "Fitness band", "price": "7200", "cost": "5900", "stock": "14", "category": "Electronics", "description": "Heart rate, step counter"}, {"sku": "RE-806", "title": "USB-C cable, braided", "price": "900", "cost": "620", "stock": "80", "category": "Electronics", "description": "One and a half metres"}, {"sku": "RE-807", "title": "Laptop cooling pad", "price": "3900", "cost": "3000", "stock": "12", "category": "Electronics", "description": "Two fans, USB powered"}]$seed$::jsonb);

select private.import_feed_rows('00000000-0000-4000-8000-000000000032',
  $seed$[{"sku": "SL-301", "title": "Leather sandals, tan", "price": "4600", "cost": "2700", "stock": "22", "category": "Footwear", "description": "Buffalo leather, stitched sole"}, {"sku": "SL-302", "title": "Peshawari chappal, brown", "price": "5400", "cost": "3200", "stock": "18", "category": "Footwear", "description": "Hand-stitched, leather sole"}, {"sku": "SL-303", "title": "Canvas sneakers, white", "price": "3800", "cost": "2200", "stock": "35", "category": "Footwear", "description": "Vulcanised rubber sole"}, {"sku": "SL-304", "title": "Suede loafers", "price": "7200", "cost": "4300", "stock": "10", "category": "Footwear", "description": "Leather lined"}, {"sku": "SL-305", "title": "Ladies flats, black", "price": "3300", "cost": "1900", "stock": "26", "category": "Footwear", "description": "Cushioned insole"}, {"sku": "SL-401", "title": "Leather tote", "price": "8900", "cost": "5200", "stock": "12", "category": "Bags & accessories", "description": "Full grain, cotton lining"}, {"sku": "SL-402", "title": "Card holder", "price": "1900", "cost": "950", "stock": "45", "category": "Bags & accessories", "description": "Six card slots"}, {"sku": "SL-403", "title": "Belt, reversible", "price": "2600", "cost": "1400", "stock": "30", "category": "Bags & accessories", "description": "Black and brown, brass buckle"}, {"sku": "SL-404", "title": "Laptop sleeve, 14 inch", "price": "4100", "cost": "2400", "stock": "20", "category": "Bags & accessories", "description": "Felt lined, magnetic flap"}, {"sku": "SL-405", "title": "Backpack, canvas and leather", "price": "9800", "cost": "5800", "stock": "9", "category": "Bags & accessories", "description": "Laptop compartment, 22 litre"}, {"sku": "SL-406", "title": "Travel duffel", "price": "11500", "cost": "6900", "stock": "6", "category": "Bags & accessories", "description": "Fifty litre, cabin friendly"}]$seed$::jsonb);

select private.import_feed_rows('00000000-0000-4000-8000-000000000033',
  $seed$[{"sku": "MH-501", "title": "Cotton bedsheet set, double", "price": "6200", "cost": "3600", "stock": "18", "category": "Home & kitchen", "description": "Two pillowcases, 180 thread"}, {"sku": "MH-502", "title": "Hand block cushion covers, pair", "price": "2400", "cost": "1300", "stock": "40", "category": "Home & kitchen", "description": "Sixteen inch"}, {"sku": "MH-503", "title": "Ceramic mug set of four", "price": "2900", "cost": "1600", "stock": "25", "category": "Home & kitchen", "description": "Dishwasher safe"}, {"sku": "MH-504", "title": "Copper water bottle", "price": "3400", "cost": "1900", "stock": "22", "category": "Home & kitchen", "description": "One litre, leak proof"}, {"sku": "MH-505", "title": "Jute floor rug", "price": "7800", "cost": "4600", "stock": "8", "category": "Home & kitchen", "description": "Four by six feet, hand woven"}, {"sku": "MH-506", "title": "Cast iron tawa", "price": "3600", "cost": "2100", "stock": "16", "category": "Home & kitchen", "description": "Pre-seasoned, 26cm"}, {"sku": "MH-507", "title": "Bamboo chopping board", "price": "1800", "cost": "950", "stock": "30", "category": "Home & kitchen", "description": "With juice groove"}, {"sku": "MH-508", "title": "Storage jars, set of three", "price": "2200", "cost": "1200", "stock": "28", "category": "Home & kitchen", "description": "Airtight, borosilicate"}, {"sku": "MH-509", "title": "Table lamp, rattan shade", "price": "5400", "cost": "3200", "stock": "11", "category": "Home & kitchen", "description": "E27 fitting, cable switch"}]$seed$::jsonb);

select private.import_feed_rows('00000000-0000-4000-8000-000000000034',
  $seed$[{"sku": "ZB-601", "title": "Rose face mist", "price": "1600", "cost": "850", "stock": "50", "category": "Beauty", "description": "One hundred millilitres"}, {"sku": "ZB-602", "title": "Argan hair oil", "price": "2200", "cost": "1200", "stock": "42", "category": "Beauty", "description": "Cold pressed, one hundred millilitres"}, {"sku": "ZB-603", "title": "Vitamin C serum", "price": "3400", "cost": "1900", "stock": "26", "category": "Beauty", "description": "Thirty millilitres, amber glass"}, {"sku": "ZB-604", "title": "Clay mask", "price": "1900", "cost": "1000", "stock": "38", "category": "Beauty", "description": "Multani mitti and neem"}, {"sku": "ZB-605", "title": "Lip balm, set of three", "price": "1400", "cost": "700", "stock": "55", "category": "Beauty", "description": "Beeswax base"}, {"sku": "ZB-606", "title": "Body butter, shea", "price": "2600", "cost": "1450", "stock": "24", "category": "Beauty", "description": "Two hundred millilitres"}, {"sku": "ZB-607", "title": "Kohl pencil", "price": "900", "cost": "420", "stock": "60", "category": "Beauty", "description": "Smudge proof"}]$seed$::jsonb);

select private.import_feed_rows('00000000-0000-4000-8000-000000000035',
  $seed$[{"sku": "QA-701", "title": "Walking shoes, mesh", "price": "7900", "cost": "4700", "stock": "20", "category": "Fitness", "description": "Breathable upper, EVA midsole"}, {"sku": "QA-702", "title": "Running shorts", "price": "2800", "cost": "1550", "stock": "32", "category": "Fitness", "description": "Zip pocket, seven inch"}, {"sku": "QA-703", "title": "Dry-fit tee", "price": "2200", "cost": "1200", "stock": "44", "category": "Fitness", "description": "Moisture wicking"}, {"sku": "QA-704", "title": "Yoga mat, 6mm", "price": "4200", "cost": "2400", "stock": "18", "category": "Fitness", "description": "TPE, carry strap"}, {"sku": "QA-705", "title": "Resistance band set", "price": "2600", "cost": "1400", "stock": "26", "category": "Fitness", "description": "Five levels"}, {"sku": "QA-706", "title": "Steel water bottle, 750ml", "price": "2900", "cost": "1600", "stock": "30", "category": "Fitness", "description": "Vacuum insulated"}, {"sku": "QA-707", "title": "Skipping rope, weighted", "price": "1700", "cost": "880", "stock": "40", "category": "Fitness", "description": "Ball bearing handles"}]$seed$::jsonb);

-- §8.3 — "where a merchant publishes a product feed or API for affiliates,
-- ingest it. Tag those rows source = 'affiliate' and LINK OUT rather than
-- fulfilling ourselves." These three are exactly that: licensed listings we
-- point at. order_items' trigger refuses to sell one, and line_discount_cap
-- returns zero for them, because neither the parcel nor the margin is ours.
select private.import_feed_rows('00000000-0000-4000-8000-00000000003f',
  $seed$[{"sku": "AF-901", "title": "Partner running shoe", "price": "12500", "url": "https://partner.example/p/901", "stock": "20", "category": "Footwear", "description": "Listed by our affiliate partner"}, {"sku": "AF-902", "title": "Partner smart watch", "price": "18900", "url": "https://partner.example/p/902", "stock": "12", "category": "Electronics", "description": "Listed by our affiliate partner"}, {"sku": "AF-903", "title": "Partner protein powder", "price": "7400", "url": "https://partner.example/p/903", "stock": "30", "category": "Fitness", "description": "Listed by our affiliate partner"}]$seed$::jsonb);

-- §8.1 — price benchmarking. Research, never republished: a number and a
-- source, no titles we would display and no photographs. This is what makes
-- private.pricing_report() say something useful on a Monday morning.
insert into private.price_benchmarks (product_id, comparable, market, market_price_pkr)
select p.id, p.title || ', comparable', m.market, (p.price_pkr * m.factor)::integer
  from public.products p
  cross join (values ('daraz', 1.12), ('brand site', 1.21), ('retail', 1.30)) as m(market, factor)
 where p.source <> 'affiliate';

-- §8.2 — the outreach list. Public handles and follower counts of businesses,
-- which is the single highest-value automation available to us and feeds §11.
insert into private.brand_outreach (handle, platform, display_name, city, category,
                                    followers, sells_online, contact, status)
values
  ('@kanwalclothing', 'instagram', 'Kanwal Clothing',  'Lahore', 'Womenswear', 48200, true,  'kanwal@example.com', 'signed'),
  ('@sahiwalleather', 'instagram', 'Sahiwal Leather',  'Lahore', 'Leather',    31400, true,  'sahiwal@example.com','signed'),
  ('@meherhome',      'instagram', 'Meher Home',       'Lahore', 'Home',       22800, false, 'meher@example.com',  'signed'),
  ('@lahorethreads',  'instagram', 'Lahore Threads',   'Lahore', 'Womenswear', 96500, true,  'hello@example.com',  'new'),
  ('@gulbergatelier', 'instagram', 'Gulberg Atelier',  'Lahore', 'Womenswear', 61200, false, 'atelier@example.com','new'),
  ('@dhastudio',      'instagram', 'DHA Studio',       'Lahore', 'Accessories',44300, true,  'studio@example.com', 'contacted'),
  ('@ichrafabrics',   'facebook',  'Ichra Fabrics',    'Lahore', 'Fabric',     18900, false, null,                 'new'),
  ('@karachikicks',   'instagram', 'Karachi Kicks',    'Karachi','Footwear',   73100, true,  'kicks@example.com',  'new');

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
  raise notice 'catalogue: %', private.catalogue_health();
end $$;
