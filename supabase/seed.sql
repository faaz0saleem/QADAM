-- Development data. Safe to run repeatedly; safe to skip entirely.
--
-- Deliberately small. §7.4: twenty good SKUs beat five thousand dropshipped
-- ones, and the prices below are placeholders until real cost_pkr figures land
-- from a signed brand (see HUMAN_TASKS.md).
--
-- Never run this against production.

insert into categories (name, coin_eligible, sort_order) values
  ('Clothing',    true,  10),
  ('Accessories', true,  20),
  ('Home',        true,  30),
  ('Electronics', true,  40)
on conflict do nothing;

insert into brands (name, commission_pct, status) values
  ('Sample Threads', 20, 'live'),
  ('Sample Leather', 25, 'live')
on conflict (name) do nothing;

-- price_pkr / cost_pkr are chosen to exercise both arms of §0:
-- the clothing rows are capped by the 10%-of-price arm, the electronics rows by
-- the 20%-of-margin arm at roughly 1% of price, exactly as §7.4 describes.
insert into products (title, brand_id, category_id, price_pkr, cost_pkr, stock, source)
select v.title, b.id, c.id, v.price, v.cost, v.stock, 'consignment'
from (values
  ('Lawn kurta, unstitched',      'Sample Threads', 'Clothing',    3200,  1600, 40),
  ('Cotton shalwar kameez',       'Sample Threads', 'Clothing',    4800,  2600, 25),
  ('Embroidered dupatta',         'Sample Threads', 'Accessories', 1800,   900, 60),
  ('Khaddar shirt',               'Sample Threads', 'Clothing',    2400,  1300, 35),
  ('Leather wallet',              'Sample Leather', 'Accessories', 2200,  1100, 50),
  ('Leather belt',                'Sample Leather', 'Accessories', 1900,   950, 45),
  ('Canvas tote',                 'Sample Threads', 'Accessories', 1400,   700, 30),
  ('Cotton bedsheet set',         'Sample Threads', 'Home',        5600,  3200, 20),
  ('Ceramic mug, pair',           'Sample Threads', 'Home',         900,   400, 80),
  ('Wireless earbuds',            'Sample Leather', 'Electronics', 6500,  6000, 15),
  ('Power bank 10,000 mAh',       'Sample Leather', 'Electronics', 4200,  3900, 22),
  ('Budget smartphone',           'Sample Leather', 'Electronics', 42000, 40300, 8)
) as v(title, brand, cat, price, cost, stock)
join brands b     on b.name = v.brand
join categories c on c.name = v.cat
where not exists (select 1 from products p where p.title = v.title);

-- A sanity read: what §0 allows on each row, and what that is as a percentage.
-- Clothing lands on 10.0%; the phone lands near 1%, with no special-casing.
select
  p.title,
  p.price_pkr,
  max_coin_discount_pkr(p.price_pkr, p.cost_pkr) as max_discount_pkr,
  round(100.0 * max_coin_discount_pkr(p.price_pkr, p.cost_pkr) / p.price_pkr, 1) as pct_of_price
from products p
order by pct_of_price desc, p.price_pkr desc;
