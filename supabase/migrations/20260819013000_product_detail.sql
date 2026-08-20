-- One product, by id.
--
-- The product screen was fetching store_feed(p_limit => 60) and searching the
-- result for the id it wanted. That worked while the catalogue was four items.
-- It stops working at the 61st: the product exists, the screen says it does not,
-- and the failure scales with how well the sourcing is going.
--
-- Same security posture as store_feed and for the same reasons — security
-- definer over column grants, a rupee saving rather than a rate (§4), cost_pkr
-- never in the output, and affiliate rows flagged rather than hidden (§8.3).
create or replace function public.product_detail(p_id uuid)
returns table (
  id uuid, title text, description text, brand_name text,
  category_id uuid, category_name text,
  price_pkr integer, stock integer, images jsonb, attributes jsonb,
  my_discount_pkr integer,
  is_affiliate boolean, affiliate_url text
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select p.id, p.title, p.description, b.name, p.category_id, c.name,
         p.price_pkr, p.stock, p.images, p.attributes,
         least(
           coalesce(private.line_discount_cap(p.id, 1), 0),
           case when public.can_redeem(auth.uid())
                then floor(public.coin_balance(auth.uid()) * private.cfg('COIN_VALUE_PKR'))::integer
                else 0 end),
         p.source = 'affiliate',
         p.affiliate_url
    from public.products p
    left join public.brands b     on b.id = p.brand_id
    left join public.categories c on c.id = p.category_id
   where p.id = p_id and p.is_active
$$;

comment on function public.product_detail(uuid) is
  'README §7.4. One product for the product screen. The saving is what this user '
  'can make today under §0 and their own balance — rupees, never a rate.';

revoke all on function public.product_detail(uuid) from public, anon;
grant execute on function public.product_detail(uuid) to authenticated;
