-- README §3.1 — the catalogue, and the function §0 is built on.

create table public.brands (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  contact        text,
  commission_pct numeric(5,2) check (commission_pct >= 0 and commission_pct <= 100),
  status         text not null default 'prospect'
                   check (status in ('prospect','signed','active','paused','ended')),
  created_at     timestamptz not null default now()
);

create table public.categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  parent_id     uuid references public.categories(id) on delete restrict,
  coin_eligible boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  constraint no_self_parent check (parent_id is distinct from id),
  unique (parent_id, name)
);

comment on column public.categories.coin_eligible is
  'false blocks coin spending in this category entirely. Note this is NOT how low-margin '
  'goods are handled — §0 already caps a phone at ~1% with no special-casing. Reserve this '
  'for categories where a discount is contractually forbidden by the brand.';

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  brand_id      uuid references public.brands(id) on delete restrict,
  category_id   uuid references public.categories(id) on delete restrict,
  price_pkr     integer not null check (price_pkr > 0),
  cost_pkr      integer not null check (cost_pkr >= 0),
  stock         integer not null default 0 check (stock >= 0),
  source        text not null check (source in ('consignment','owned','affiliate')),
  affiliate_url text,
  images        jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint price_above_cost check (price_pkr > cost_pkr),
  constraint affiliate_needs_url
    check (source <> 'affiliate' or affiliate_url is not null),
  constraint images_is_array check (jsonb_typeof(images) = 'array')
);

comment on column public.products.cost_pkr is
  'What we pay. NEVER granted to anon or authenticated — see the RLS migration, which '
  'enumerates client-visible columns explicitly so a new column is private by default.';

create index products_category_idx on public.products (category_id) where is_active;
create index products_brand_idx    on public.products (brand_id) where is_active;

create trigger products_touch
  before update on public.products
  for each row execute function private.touch_updated_at();

-- ==========================================================================
-- §0 — THE ONE RULE THAT MUST NEVER BREAK
--
--   max_discount_pkr = MIN( 0.20 * (price - cost),  0.10 * price )
--
-- A discount funded out of realised margin can never produce a loss. A discount
-- funded out of price can, and will, on any low-margin category.
--
-- IMMUTABLE is load-bearing: order_items has a CHECK constraint that calls this,
-- and a CHECK may only be trusted if the function it calls means the same thing
-- forever. Do not make this stable or volatile. Do not add a config lookup to it.
--
-- floor(), not round(): rounding up can exceed the cap by a rupee, and the cap is
-- not a suggestion.
-- ==========================================================================
create or replace function public.max_coin_discount_pkr(p_price int, p_cost int)
returns int
language sql
immutable
parallel safe
as $$
  select greatest(0, least(
    floor(0.20 * (p_price - p_cost))::int,
    floor(0.10 * p_price)::int
  ));
$$;

comment on function public.max_coin_discount_pkr(int, int) is
  'README §0. The maximum coin discount, in whole PKR, fundable on one unit of an item '
  'priced p_price that cost us p_cost. Enforced as a CHECK on order_items — this is not '
  'application logic and must never be reimplemented in the app.';

-- The coin discount a product can carry, for display in the store (§7.4).
create or replace function public.product_max_discount_pkr(p_product_id uuid)
returns int
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
           when not p.is_active then 0
           when not c.coin_eligible then 0
           else public.max_coin_discount_pkr(p.price_pkr, p.cost_pkr)
         end
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.id = p_product_id
$$;

comment on function public.product_max_discount_pkr(uuid) is
  'Store-facing cap for one product. security definer so the client learns the cap '
  'without ever being able to read cost_pkr and derive our margin.';
