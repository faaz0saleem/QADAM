-- 20260818000400_catalogue.sql
-- §3.1, §5: brands, categories, products, and THE RULE (§0).

create table brands (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  contact        jsonb not null default '{}',
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  status         text not null default 'prospect'
                   check (status in ('prospect','signed','live','paused','ended')),
  created_at     timestamptz not null default now()
);

create table categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  parent_id     uuid references categories(id) on delete restrict,
  coin_eligible boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint no_self_parent check (parent_id is null or parent_id <> id),
  unique (parent_id, name)
);

comment on column categories.coin_eligible is
  'A hard off-switch for coin discounts in a category. §0 already caps low-margin '
  'goods to ~1% without any special-casing (§7.4); this flag is for categories where '
  'a discount is contractually disallowed, not for margin management.';

create table products (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(btrim(title)) > 0),
  brand_id      uuid references brands(id) on delete restrict,
  category_id   uuid references categories(id) on delete restrict,
  price_pkr     integer not null check (price_pkr > 0),
  cost_pkr      integer not null check (cost_pkr >= 0),
  stock         integer not null default 0 check (stock >= 0),
  source        text not null check (source in ('consignment','owned','affiliate')),
  affiliate_url text,
  images        jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  constraint price_above_cost check (price_pkr > cost_pkr),
  -- §8.3: affiliate rows link out and are never fulfilled by us, so the link is
  -- mandatory there and meaningless anywhere else.
  constraint affiliate_has_url check ((source = 'affiliate') = (affiliate_url is not null))
);

create index products_category_idx on products (category_id);
create index products_brand_idx    on products (brand_id);
create index products_in_stock_idx on products (category_id) where stock > 0;

-- ============================================================================
-- §0. THE ONE RULE THAT MUST NEVER BREAK
--
--   max_discount_pkr = MIN( 0.20 * (price - cost),  0.10 * price )
--
-- Computed, never stored, never overridable. IMMUTABLE so it can be used
-- directly inside a CHECK constraint (see the next migration) — which is what
-- makes the rule unbypassable by any future feature, admin panel or bug.
--
-- Arithmetic note: 0.20 and 0.10 are numeric literals, not floats, so this is
-- exact decimal arithmetic. floor() before the cast means we always round the
-- discount DOWN, i.e. always in the house's favour.
-- ============================================================================
create or replace function max_coin_discount_pkr(p_price int, p_cost int)
returns int language sql immutable parallel safe as $$
  select greatest(0, least(
    floor(0.20 * (p_price - p_cost))::int,
    floor(0.10 * p_price)::int
  ));
$$;

comment on function max_coin_discount_pkr(int, int) is
  '§0: the maximum coin discount in PKR for ONE unit at this price and cost. '
  'MIN(20%% of gross margin, 10%% of price), floored, never negative. '
  'Changing this function changes the single rule the business rests on.';

-- Convenience for the store (§7.4): what this product can be discounted by today.
-- Deliberately NOT security_invoker: this view exists to publish a number
-- derived from cost_pkr while keeping cost_pkr itself unreadable by any client.
-- Running it with the owner's rights is the whole point.
create view product_discount_ceiling as
select
  p.id                                             as product_id,
  p.price_pkr,
  max_coin_discount_pkr(p.price_pkr, p.cost_pkr)   as max_discount_pkr,
  coalesce(c.coin_eligible, true)                  as coin_eligible
from products p
left join categories c on c.id = p.category_id;

comment on view product_discount_ceiling is
  'Safe to expose: carries the discount ceiling and the price, never cost_pkr.';
