-- ===========================================================================
-- The catalogue pipeline — how the store gets big without stealing anything.
--
-- WHAT WAS ASKED FOR: "scrape the whole Daraz or Temu and the Qadam store
-- should have every product in it just like big stores."
--
-- README §8 is titled READ THIS BEFORE YOU SCRAPE ANYTHING, and it answers
-- exactly this, so the answer is not mine:
--
--   "Don't lift catalogues and photos from other retailers. Product images are
--    owned by the brand or the photographer, competitor terms of service
--    prohibit it, and affiliate accounts get terminated for exactly this. Worse,
--    it's operationally broken: if you scrape a listing you don't stock and
--    someone orders it, you have nothing to ship — and an unfulfilled order in a
--    COD market is a chargeback, a one-star review, and a dead customer."
--
-- And §7.4: "Curate hard. Twenty good SKUs beat five thousand dropshipped ones.
-- We cannot out-catalogue Daraz and must not try."
--
-- So this migration builds the four things §8 says DO work, which together are
-- the road to a large catalogue that we can actually ship:
--
--   1. public.supplier_feeds  — a named, licensed source behind every product.
--   2. private.import_feed_rows() — bulk ingest, row by row, with the reasons
--      for every rejection handed back for the supplier to fix.
--   3. private.price_benchmarks — what the market charges. Research, never
--      republished, never in the catalogue as content (§8.1).
--   4. private.brand_outreach — the Lahore brand list §8.2 calls the single
--      highest-value automation available to us.
--
-- And it closes the hole §8 warns about, structurally: an affiliate listing is
-- a link-out, we do not stock it, and until now public.place_order would have
-- happily sold one. A trigger on order_items now refuses. That is the sentence
-- "you have nothing to ship" turned into a constraint.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Where a product came from, and on what terms
-- ---------------------------------------------------------------------------
create table public.supplier_feeds (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  brand_id       uuid references public.brands(id) on delete restrict,
  kind           text not null check (kind in ('consignment','affiliate','wholesale')),
  -- The licence is not decoration. A feed with no agreement on record cannot be
  -- imported from, which is the only durable defence against someone pointing
  -- this importer at a competitor's sitemap on a deadline.
  licence        text not null,
  licence_url    text,
  contact        text,
  is_active      boolean not null default true,
  last_import_at timestamptz,
  created_at     timestamptz not null default now(),

  constraint licence_is_stated check (length(btrim(licence)) >= 8),
  constraint consignment_names_a_brand
    check (kind <> 'consignment' or brand_id is not null)
);

comment on table public.supplier_feeds is
  'README §8.3/§8.4. Every bulk-imported product traces to one of these. `licence` '
  'records what gives us the right to the words and the photographs — a signed '
  'consignment agreement, a published affiliate feed''s terms. A feed without one '
  'cannot be imported from, and that is the point of the column.';
comment on column public.supplier_feeds.kind is
  'consignment: the brand handed us their own photos and we ship it. wholesale: we '
  'bought it and hold it. affiliate: a licensed feed we LINK OUT to and never ship.';

alter table public.supplier_feeds enable row level security;

alter table public.products
  add column feed_id     uuid references public.supplier_feeds(id) on delete restrict,
  add column sku         text,
  add column description text,
  add column attributes  jsonb not null default '{}'::jsonb;

comment on column public.products.sku is
  'The supplier''s own identifier. Re-importing a feed matches on (feed_id, sku), so '
  'a nightly refresh updates prices and stock instead of creating a second copy of '
  'the catalogue every night.';

alter table public.products
  add constraint attributes_is_object check (jsonb_typeof(attributes) = 'object');

create unique index products_feed_sku on public.products (feed_id, sku)
  where feed_id is not null and sku is not null;

create index products_search_idx on public.products using gin (to_tsvector('simple', title))
  where is_active;

-- ---------------------------------------------------------------------------
-- §8, as a constraint: we only sell what we can ship
--
-- An affiliate row is a licensed listing we point at someone else. It has no
-- stock here, no parcel here, and no cost basis here. Ordering one is the
-- failure mode §8 describes in full — so the order line refuses it, at the same
-- layer §0 lives at, rather than in whichever checkout function is current.
-- ---------------------------------------------------------------------------
create or replace function private.order_item_is_fulfillable()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare v_source text;
begin
  select source into v_source from public.products where id = new.product_id;

  if v_source = 'affiliate' then
    raise exception
      'product % is an affiliate listing — we do not stock it and cannot ship it (README §8)',
      new.product_id
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger order_items_are_fulfillable
  before insert on public.order_items
  for each row execute function private.order_item_is_fulfillable();

comment on function private.order_item_is_fulfillable() is
  'README §8. "If you scrape a listing you don''t stock and someone orders it, you '
  'have nothing to ship." Affiliate rows link out; they are never sold here. In the '
  'trigger rather than in checkout, so a new checkout path cannot forget it.';

-- ---------------------------------------------------------------------------
-- The bulk importer
--
-- A superset of private.import_products(): same row-by-row judgement and same
-- rejection reasons, plus a feed to trace against and a SKU to update on. Each
-- row is judged alone, because a brand's spreadsheet is always partly wrong and
-- rejecting the file over row 43 turns ten minutes back into a day (§8.4).
-- ---------------------------------------------------------------------------
create or replace function private.import_feed_rows(p_feed_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_feed     record;
  r          jsonb;
  v_row      integer := 0;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_reason   text;
  v_sku      text;
  v_title    text;
  v_price    integer;
  v_cost     integer;
  v_stock    integer;
  v_images   jsonb;
  v_attrs    jsonb;
  v_url      text;
  v_category uuid;
  v_existing uuid;
begin
  select * into v_feed from public.supplier_feeds where id = p_feed_id;
  if not found then
    raise exception 'no such feed' using errcode = 'foreign_key_violation';
  end if;
  if not v_feed.is_active then
    raise exception 'feed % is not active', v_feed.name using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = 'check_violation';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    v_row    := v_row + 1;
    v_reason := null;

    v_sku   := nullif(btrim(coalesce(r ->> 'sku', '')), '');
    v_title := nullif(btrim(coalesce(r ->> 'title', '')), '');
    v_url   := nullif(btrim(coalesce(r ->> 'url', '')), '');
    v_price := nullif(regexp_replace(coalesce(r ->> 'price', ''), '[^0-9-]', '', 'g'), '')::integer;
    v_cost  := nullif(regexp_replace(coalesce(r ->> 'cost',  ''), '[^0-9-]', '', 'g'), '')::integer;
    v_stock := coalesce(nullif(regexp_replace(coalesce(r ->> 'stock', ''), '[^0-9-]', '', 'g'), '')::integer, 0);

    v_images := case when jsonb_typeof(r -> 'images') = 'array' then r -> 'images' else '[]'::jsonb end;
    v_attrs  := case when jsonb_typeof(r -> 'attributes') = 'object' then r -> 'attributes' else '{}'::jsonb end;

    if v_sku is null then
      v_reason := 'no sku — a feed row needs an identifier we can update on next time';
    elsif v_title is null then
      v_reason := 'no title';
    elsif v_price is null or v_price <= 0 then
      v_reason := 'price is missing or not a number';
    elsif v_feed.kind = 'affiliate' then
      -- We never buy it, so there is no cost and no margin. It links out.
      if v_url is null then
        v_reason := 'an affiliate row must carry the url it links out to';
      end if;
    elsif v_cost is null then
      v_reason := 'no cost — without it §0 has no margin to work from and the row cannot be priced';
    elsif v_cost >= v_price then
      v_reason := format('cost %s is not below price %s', v_cost, v_price);
    elsif public.max_coin_discount_pkr(v_price, v_cost) = 0 then
      -- Not fatal, and not a rejection: §0 caps a 5%-margin phone near zero and
      -- that is correct. Worth saying out loud so the buyer is not surprised
      -- when the card offers no saving.
      v_reason := null;
    end if;

    if v_reason is not null then
      v_rejected := v_rejected || jsonb_build_object('row', v_row, 'sku', v_sku,
                                                     'title', v_title, 'reason', v_reason);
      continue;
    end if;

    select id into v_category from public.categories
     where lower(name) = lower(coalesce(r ->> 'category', '')) limit 1;

    select id into v_existing from public.products
     where feed_id = p_feed_id and sku = v_sku;

    if v_existing is not null then
      -- A refresh updates what moves — price, stock, photos — and never touches
      -- what a past order snapshotted. order_items keeps its own copy of both
      -- price and cost precisely so this is safe (§3.2).
      update public.products
         set title       = v_title,
             price_pkr   = v_price,
             cost_pkr    = case when v_feed.kind = 'affiliate' then 0 else v_cost end,
             stock       = v_stock,
             images      = case when jsonb_array_length(v_images) > 0 then v_images else images end,
             attributes  = v_attrs,
             description = coalesce(nullif(btrim(coalesce(r ->> 'description', '')), ''), description),
             category_id = coalesce(v_category, category_id),
             affiliate_url = case when v_feed.kind = 'affiliate' then v_url else affiliate_url end,
             is_active   = true
       where id = v_existing;
      v_updated := v_updated + 1;
    else
      insert into public.products
        (title, brand_id, category_id, price_pkr, cost_pkr, stock, source,
         affiliate_url, images, attributes, description, feed_id, sku)
      values
        (v_title, v_feed.brand_id, v_category, v_price,
         case when v_feed.kind = 'affiliate' then 0 else v_cost end,
         v_stock,
         case v_feed.kind when 'affiliate' then 'affiliate'
                          when 'wholesale' then 'owned'
                          else 'consignment' end,
         case when v_feed.kind = 'affiliate' then v_url else null end,
         v_images, v_attrs,
         nullif(btrim(coalesce(r ->> 'description', '')), ''),
         p_feed_id, v_sku);
      v_created := v_created + 1;
    end if;
  end loop;

  update public.supplier_feeds set last_import_at = now() where id = p_feed_id;

  return jsonb_build_object(
    'feed',      v_feed.name,
    'rows',      v_row,
    'created',   v_created,
    'updated',   v_updated,
    'rejected',  jsonb_array_length(v_rejected),
    'rejections', v_rejected);
end $$;

comment on function private.import_feed_rows(uuid, jsonb) is
  'README §8.3/§8.4. Idempotent on (feed_id, sku) so a nightly refresh updates the '
  'catalogue instead of duplicating it. Every rejection names the row and the reason, '
  'because the person fixing it is a brand owner looking at their own spreadsheet.';

-- ---------------------------------------------------------------------------
-- An affiliate row funds no discount
--
-- A pre-existing hole that the affiliate feed makes reachable. cost_pkr on an
-- affiliate listing is zero — we never bought it — so §0 computes
-- min(20% of price, 10% of price) = 10% of price and the card would advertise a
-- saving out of a margin we do not have, on a sale that is not ours.
--
-- The order trigger above already refuses to sell one. This stops us offering.
-- ---------------------------------------------------------------------------
create or replace function private.line_discount_cap(p_product_id uuid, p_qty integer)
returns integer
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
           when p.source = 'affiliate' then 0
           when not coalesce(c.coin_eligible, true) then 0
           else p_qty * public.max_coin_discount_pkr(p.price_pkr, p.cost_pkr)
         end
    from public.products p
    left join public.categories c on c.id = p.category_id
   where p.id = p_product_id
$$;

-- ---------------------------------------------------------------------------
-- §8.1 — price benchmarking. Research, not content.
--
-- "Scrape current market prices across Daraz and brand sites so we price
--  competitively and so cost_pkr vs market price is a real number, not a guess.
--  This is research, not republishing — it never enters the catalogue as
--  content."
--
-- Which is why this table holds a number and a URL and no photograph, no
-- description and no title we would ever display. It lives in `private`, so
-- PostgREST cannot expose it even by accident.
-- ---------------------------------------------------------------------------
create table private.price_benchmarks (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid references public.products(id) on delete cascade,
  -- Free text, for benchmarking something we do not stock yet. Never displayed.
  comparable       text not null,
  market           text not null,             -- 'daraz', 'brand site', 'retail'
  market_price_pkr integer not null check (market_price_pkr > 0),
  source_url       text,
  observed_at      timestamptz not null default now(),
  observed_by      uuid,

  constraint comparable_is_named check (length(btrim(comparable)) > 0)
);

comment on table private.price_benchmarks is
  'README §8.1. What the market charges, so our price is a decision rather than a '
  'guess. Research only: no titles we would display, no descriptions, no images, and '
  'in a schema PostgREST does not expose.';

create index price_benchmarks_product_idx on private.price_benchmarks (product_id, observed_at desc);

-- Are we competitive, and does §0 leave us room? One row per live SKU.
create or replace function private.pricing_report()
returns table (
  product_id      uuid,
  title           text,
  our_price_pkr   integer,
  market_median   integer,
  vs_market_pct   numeric,
  margin_pkr      integer,
  max_discount_pkr integer,
  discount_pct    numeric
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p.id, p.title, p.price_pkr,
         b.median,
         case when b.median is null then null
              else round(100.0 * (p.price_pkr - b.median) / b.median, 1) end,
         p.price_pkr - p.cost_pkr,
         public.max_coin_discount_pkr(p.price_pkr, p.cost_pkr),
         round(100.0 * public.max_coin_discount_pkr(p.price_pkr, p.cost_pkr) / p.price_pkr, 2)
    from public.products p
    left join lateral (
      select percentile_cont(0.5) within group (order by market_price_pkr)::integer as median
        from private.price_benchmarks pb
       where pb.product_id = p.id and pb.observed_at > now() - interval '90 days'
    ) b on true
   where p.is_active and p.source <> 'affiliate'
   -- Named output columns of a RETURNS TABLE function are not in scope here, so
   -- the sort repeats the expression. Dearest-relative-to-market first: that is
   -- the list the buyer needs on a Monday.
   order by case when b.median is null then null
                 else (p.price_pkr - b.median)::numeric / b.median end desc nulls last
$$;

comment on function private.pricing_report() is
  'README §3.3 and §8.1 together: what we charge, what the market charges, and what '
  '§0 leaves us to discount. The column to watch is discount_pct — if it is under 2% '
  'across the catalogue, the coin is not buying anything and the sourcing is wrong.';

-- ---------------------------------------------------------------------------
-- §8.2 — the brand outreach list
--
-- "Scrape Instagram and Facebook for Lahore clothing and accessory brands:
--  handle, follower count, whether they already sell online, contact. This is
--  the single highest-value automation available to us, and it feeds the human
--  task list in §11."
--
-- Public handles and follower counts of businesses. Not catalogue content, not
-- anybody's photographs, and private because a ranked list of who we are about
-- to approach is commercially ours.
-- ---------------------------------------------------------------------------
create table private.brand_outreach (
  id            uuid primary key default gen_random_uuid(),
  handle        text not null,
  platform      text not null check (platform in ('instagram','facebook','tiktok','web')),
  display_name  text,
  city          text,
  category      text,
  followers     integer check (followers >= 0),
  sells_online  boolean,
  contact       text,
  status        text not null default 'new'
                  check (status in ('new','contacted','replied','meeting','signed','declined')),
  brand_id      uuid references public.brands(id) on delete set null,
  notes         text,
  last_touch_at timestamptz,
  created_at    timestamptz not null default now(),

  unique (platform, handle)
);

create index brand_outreach_queue on private.brand_outreach (status, followers desc);

comment on table private.brand_outreach is
  'README §8.2 and §11. The prospect list, ranked. A brand here becomes a row in '
  'public.brands when they sign, and a supplier_feeds row when they hand over a '
  'catalogue — that is the whole path from a scraped handle to a shippable SKU.';

-- Who to call on Monday: reachable, sizeable, and not yet spoken to.
create or replace function private.outreach_queue(p_limit integer default 25)
returns table (handle text, platform text, followers integer, city text,
               sells_online boolean, contact text)
language sql
stable
security definer
set search_path = private, public, pg_temp
as $$
  select o.handle, o.platform, o.followers, o.city, o.sells_online, o.contact
    from private.brand_outreach o
   where o.status = 'new' and o.contact is not null
   order by o.followers desc nulls last
   limit greatest(1, least(p_limit, 200))
$$;

-- ---------------------------------------------------------------------------
-- Is the catalogue actually a shop?
-- ---------------------------------------------------------------------------
create or replace function private.catalogue_health()
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select jsonb_build_object(
    'live_skus',        count(*) filter (where is_active),
    'in_stock',         count(*) filter (where is_active and stock > 0),
    'out_of_stock',     count(*) filter (where is_active and stock = 0),
    'by_source',        (select jsonb_object_agg(source, n)
                           from (select source, count(*) as n from public.products
                                  where is_active group by source) s),
    'categories_live',  (select count(distinct category_id) from public.products where is_active),
    'brands_live',      (select count(distinct brand_id) from public.products where is_active),
    'median_price_pkr', percentile_cont(0.5) within group (order by price_pkr)::integer,
    -- The number that says whether a coin is worth walking for. §7.4: a shopper
    -- who sees "save PKR 12" on everything has learned the coin is a rounding
    -- error, and no amount of ticker animation fixes that.
    'median_saving_pkr',(select percentile_cont(0.5) within group
                                (order by public.max_coin_discount_pkr(price_pkr, cost_pkr))::integer
                           from public.products where is_active and source <> 'affiliate'),
    'feeds_active',     (select count(*) from public.supplier_feeds where is_active))
    from public.products
$$;

-- ---------------------------------------------------------------------------
-- Browsing a catalogue that is no longer twenty items
--
-- store_feed gains a sort and two affiliate columns, so the return type changes
-- and the old one has to go. p_sort is appended rather than inserted, so a
-- caller still passing four positional arguments resolves to the same thing it
-- always did.
-- ---------------------------------------------------------------------------
drop function if exists public.store_feed(uuid, text, integer, integer);

create or replace function public.store_feed(
  p_category uuid default null,
  p_search   text default null,
  p_limit    integer default 30,
  p_offset   integer default 0,
  p_sort     text default 'new'
) returns table (
  id uuid, title text, brand_name text,
  category_id uuid, category_name text,
  price_pkr integer, stock integer, images jsonb,
  my_discount_pkr integer,
  is_affiliate boolean, affiliate_url text
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with me as (
    select case when public.can_redeem(auth.uid())
                then floor(public.coin_balance(auth.uid()) * private.cfg('COIN_VALUE_PKR'))::integer
                else 0 end as affordable_pkr
  )
  select p.id, p.title, b.name, p.category_id, c.name,
         p.price_pkr, p.stock, p.images,
         least(coalesce(private.line_discount_cap(p.id, 1), 0), me.affordable_pkr),
         p.source = 'affiliate',
         p.affiliate_url
    from public.products p
    left join public.brands b     on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
    cross join me
   where p.is_active
     and (p_category is null or p.category_id = p_category)
     and (p_search is null or p.title ilike '%' || p_search || '%'
                           or p.description ilike '%' || p_search || '%')
   order by
     -- Out of stock sorts last under every sort, rather than disappearing: a
     -- catalogue that hides half of itself looks thinner than it is (§7.4).
     (p.stock > 0) desc,
     case when p_sort = 'price_asc'  then p.price_pkr end asc,
     case when p_sort = 'price_desc' then p.price_pkr end desc,
     case when p_sort = 'saving'
          then least(coalesce(private.line_discount_cap(p.id, 1), 0), me.affordable_pkr) end desc,
     case when p_sort = 'new' or p_sort is null then p.created_at end desc,
     p.id
   limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset)
$$;

comment on function public.store_feed(uuid, text, integer, integer, text) is
  'README §7.4. The saving shown is what this user can make today, capped by §0 and '
  'by their own balance — a rupee figure, never a rate (§4). Affiliate rows come back '
  'flagged with the url they link out to; they are never sold here (§8).';

-- The category rail, with live counts, so an empty category is not offered.
create or replace function public.store_categories()
returns table (id uuid, name text, sort_order integer, live_count integer)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select c.id, c.name, c.sort_order, count(p.id)::integer
    from public.categories c
    join public.products p on p.category_id = c.id and p.is_active
   group by c.id, c.name, c.sort_order
  having count(p.id) > 0
   order by c.sort_order, c.name
$$;

-- ---------------------------------------------------------------------------
-- Grants. Postgres hands EXECUTE on every new function to PUBLIC; anon and
-- authenticated inherit it, so the revoke has to name PUBLIC.
--
-- supplier_feeds gets no client grant. It carries our commercial terms.
-- ---------------------------------------------------------------------------
revoke all on function
  public.store_feed(uuid, text, integer, integer, text),
  public.store_categories(),
  private.import_feed_rows(uuid, jsonb),
  private.pricing_report(),
  private.outreach_queue(integer),
  private.catalogue_health(),
  private.order_item_is_fulfillable(),
  private.line_discount_cap(uuid, integer)
from public, anon, authenticated;

grant execute on function
  public.store_feed(uuid, text, integer, integer, text),
  public.store_categories()
to authenticated;

grant execute on function
  private.import_feed_rows(uuid, jsonb),
  private.pricing_report(),
  private.outreach_queue(integer),
  private.catalogue_health(),
  private.line_discount_cap(uuid, integer)
to service_role;
