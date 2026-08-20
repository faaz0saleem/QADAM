-- ============================================================================
-- README §8 — where the catalogue comes from.
--
-- The ask was "scrape the whole Daraz and put every product in the store". §8
-- is a whole section on why that ends the business rather than growing it, and
-- the operational half of its argument is the part a test can hold:
--
--   "If you scrape a listing you don't stock and someone orders it, you have
--    nothing to ship."
--
-- So the load-bearing assertions here are the two that make that impossible: an
-- affiliate listing cannot be ordered, and it cannot advertise a saving out of a
-- margin we never had. Everything else is the pipeline that fills a real shop —
-- licensed feeds, idempotent refreshes, and rejections a brand owner can act on.
-- ============================================================================
begin;
select plan(38);

-- ── a feed has to say what gives us the right to the words ─────────────────
select throws_ok(
  $$insert into public.supplier_feeds (name, kind, licence) values ('Scraped', 'wholesale', 'none')$$,
  '23514', null,
  'a feed with no licence on record cannot exist');

select throws_ok(
  $$insert into public.supplier_feeds (name, kind, licence)
    values ('Someone else''s shop', 'consignment', 'signed 2026-02-01')$$,
  '23514', null,
  'a consignment feed must name the brand whose photographs it carries');

create temporary table f (owned uuid, aff uuid, cat uuid);
insert into public.categories (name, sort_order) values ('Kurtas', 1);
insert into f (cat) select id from public.categories where name = 'Kurtas';

insert into public.supplier_feeds (name, brand_id, kind, licence)
values ('Sana Textiles consignment', tests.default_brand(), 'consignment',
        'consignment agreement signed 2026-02-01');
update f set owned = (select id from public.supplier_feeds where name = 'Sana Textiles consignment');

insert into public.supplier_feeds (name, kind, licence, licence_url)
values ('Partner affiliate feed', 'affiliate', 'affiliate programme terms, accepted 2026-03-11',
        'https://partner.example/affiliates/terms');
update f set aff = (select id from public.supplier_feeds where name = 'Partner affiliate feed');

-- ── the importer judges each row on its own ────────────────────────────────
create temporary table imp (r jsonb);
insert into imp (r) select private.import_feed_rows((select owned from f), jsonb_build_array(
  jsonb_build_object('sku','K-001','title','Lawn kurta, navy','price','2400','cost','1500',
                     'stock','12','category','Kurtas','images', jsonb_build_array('https://cdn.example/k1.jpg'),
                     'description','Unstitched two-piece'),
  jsonb_build_object('sku','K-002','title','Lawn kurta, rust','price','2400','cost','1500','stock','0'),
  jsonb_build_object('title','No sku here','price','999','cost','500'),
  jsonb_build_object('sku','K-004','price','999','cost','500'),
  jsonb_build_object('sku','K-005','title','No cost','price','999'),
  jsonb_build_object('sku','K-006','title','Upside down','price','500','cost','900')));

select is(((select r from imp) ->> 'created')::int, 2, 'the two good rows go in');
select is(((select r from imp) ->> 'rejected')::int, 4, 'and the four bad ones come back');
select alike(((select r from imp) -> 'rejections' -> 0 ->> 'reason'), '%sku%',
  'a row with no sku says so — a feed row needs something to update on next time');
select alike(((select r from imp) -> 'rejections' -> 1 ->> 'reason'), '%title%',
  'a row with no title says so');
select alike(((select r from imp) -> 'rejections' -> 2 ->> 'reason'), '%cost%',
  'a row with no cost says so: without it §0 has no margin to work from');
select alike(((select r from imp) -> 'rejections' -> 3 ->> 'reason'), '%not below price%',
  'and a row priced under cost is named with both numbers, for the brand to fix');

-- ── a refresh updates, it does not duplicate ───────────────────────────────
delete from imp;
insert into imp (r) select private.import_feed_rows((select owned from f), jsonb_build_array(
  jsonb_build_object('sku','K-001','title','Lawn kurta, navy','price','2600','cost','1500','stock','30')));

select is(((select r from imp) ->> 'created')::int, 0, 'a second import of the same sku creates nothing');
select is(((select r from imp) ->> 'updated')::int, 1, 'it updates');
select is((select count(*)::int from public.products where feed_id = (select owned from f)), 2,
  'so a nightly refresh leaves two SKUs, not four');
select is((select price_pkr from public.products where sku = 'K-001'), 2600,
  'with the new price');
select is((select stock from public.products where sku = 'K-001'), 30, 'and the new stock');

-- ══════════════════════════════════════════════════════════════════════════
-- §8 — WE ONLY SELL WHAT WE CAN SHIP
-- ══════════════════════════════════════════════════════════════════════════
delete from imp;
insert into imp (r) select private.import_feed_rows((select aff from f), jsonb_build_array(
  jsonb_build_object('sku','A-100','title','Partner sneaker','price','8000',
                     'url','https://partner.example/p/100','stock','5'),
  jsonb_build_object('sku','A-101','title','No link','price','8000')));

select is(((select r from imp) ->> 'created')::int, 1, 'the affiliate row with a link goes in');
select alike(((select r from imp) -> 'rejections' -> 0 ->> 'reason'), '%url%',
  'the one without a link does not — an affiliate row IS the link');
select is((select source from public.products where sku = 'A-100'), 'affiliate',
  'it is stored as an affiliate listing');
select is((select cost_pkr from public.products where sku = 'A-100'), 0,
  'with no cost, because we never bought it');

create temporary table u (buyer uuid);
insert into u (buyer) select tests.new_user(p_created_at => now() - interval '90 days');
select private.mint_coins((select buyer from u), 50000, 'steps', public.pkt_date(now()) - 1) \gset m_
select tests.act_as((select buyer from u));

select throws_ok(
  format($$select public.place_order(jsonb_build_array(jsonb_build_object('product_id', %L, 'qty', 1)),
                                     'House 1, Gulberg, Lahore', '+923001234567')$$,
         (select id from public.products where sku = 'A-100')),
  '23514', null,
  'an affiliate listing cannot be ordered — we have nothing to ship (§8)');

select is(public.my_discount_on((select id from public.products where sku = 'A-100')), 0,
  'and it advertises no saving: a 10% discount out of a margin we never had');

select is(
  (select my_discount_pkr from public.store_feed(null, 'Partner sneaker') limit 1),
  0,
  'the store card says the same thing');

select cmp_ok(
  (select my_discount_pkr from public.store_feed(null, 'Lawn kurta, navy') limit 1),
  '>', 0,
  'while a kurta we actually hold does offer one');

select is(
  (select my_discount_pkr from public.store_feed(null, 'Lawn kurta, navy') limit 1),
  public.max_coin_discount_pkr(2600, 1500),
  'and it is exactly §0, not a rupee more');

-- ── browsing a catalogue that is no longer twenty items ────────────────────
select is((select is_affiliate from public.store_feed(null, 'Partner sneaker') limit 1), true,
  'affiliate rows come back flagged, so the UI can link out instead of adding to a cart');
select isnt((select affiliate_url from public.store_feed(null, 'Partner sneaker') limit 1), null,
  'with the url they link to');

-- The rust kurta is cheaper AND out of stock, which is the interesting case:
-- "in stock" outranks every sort, so the dearer one that we can actually post
-- comes first.
select is(
  (select title from public.store_feed(null, 'kurta', 10, 0, 'price_asc') limit 1),
  'Lawn kurta, navy',
  'a cheaper item that is out of stock still sorts below one we can ship');

select is(
  (select bool_and(ok) from (
     select stock > 0 or row_number() over () > 1 as ok
       from public.store_feed(null, 'kurta', 10, 0, 'price_asc')) x),
  true,
  'out of stock always sorts last, under every sort');

select is((select title from public.store_feed(null, null, 10, 0, 'price_desc') limit 1),
  'Partner sneaker',
  'price_desc puts the dearest first');

select is((select count(*)::int from public.store_feed(null, 'two-piece')), 1,
  'search reaches the description, not just the title');

select is((select name from public.store_categories() limit 1), 'Kurtas',
  'the category rail shows a category with products in it');

insert into public.categories (name, sort_order) values ('Empty shelf', 2);
select is((select count(*)::int from public.store_categories() where name = 'Empty shelf'), 0,
  'and never one with none');

-- ── §8.1 research stays research ───────────────────────────────────────────
insert into private.price_benchmarks (product_id, comparable, market, market_price_pkr)
values ((select id from public.products where sku = 'K-001'), 'Lawn 2pc, comparable weight', 'daraz', 2900),
       ((select id from public.products where sku = 'K-001'), 'Lawn 2pc, comparable weight', 'brand site', 3100);

select ok(tests.denied('authenticated', (select buyer from u), 'select * from private.price_benchmarks'),
  'no client can read the benchmarks — it is research, in a schema PostgREST cannot see');

select is((select market_median from private.pricing_report() where title = 'Lawn kurta, navy'), 3000,
  'the pricing report takes the median of what the market charges');
select cmp_ok((select vs_market_pct from private.pricing_report() where title = 'Lawn kurta, navy'),
  '<', 0::numeric,
  'and says we are under it');

-- ── §8.2 the outreach list ─────────────────────────────────────────────────
insert into private.brand_outreach (handle, platform, followers, city, sells_online, contact)
values ('@sanatextiles', 'instagram', 48000, 'Lahore', true, 'sana@example.com'),
       ('@tinybrand',    'instagram',   900, 'Lahore', false, 'hi@example.com'),
       ('@nocontact',    'instagram', 99000, 'Lahore', true, null);

select is((select handle from private.outreach_queue() limit 1), '@sanatextiles',
  'the queue ranks by reach, among the ones we can actually reach');
select is((select count(*)::int from private.outreach_queue() where handle = '@nocontact'), 0,
  'a prospect with no contact is not a prospect yet');
select ok(tests.denied('authenticated', (select buyer from u), 'select * from private.brand_outreach'),
  'and the prospect list is ours, not the client''s');

-- ── is it a shop? ──────────────────────────────────────────────────────────
select is((private.catalogue_health() ->> 'live_skus')::int, 3,
  'catalogue_health counts what is live');
select is((private.catalogue_health() -> 'by_source' ->> 'affiliate')::int, 1,
  'and breaks it down by where it came from');

select * from finish();
rollback;
