-- README §7.4 — the catalogue as a shopper sees it.
--
-- "On each product card, show the coin discount available to this user RIGHT
--  NOW, given their balance. Not a hypothetical maximum. 'Save PKR 180 with your
--  coins' beats 'up to 10% off' every time."
--
-- One call rather than one per card. Asking my_discount_on() for thirty products
-- is thirty round trips on a connection that §9.7 says may be a three-year-old
-- Android on mobile data.
--
-- Note what comes back and what does not: a discount in rupees, never a rate,
-- never a cost. §4 — the coin-to-rupee conversion is not published, and a per-
-- card rate would publish it thirty times a screen.
create or replace function public.store_feed(
  p_category uuid default null,
  p_search   text default null,
  p_limit    integer default 30,
  p_offset   integer default 0
) returns table (
  id uuid, title text, brand_name text, category_id uuid,
  price_pkr integer, stock integer, images jsonb,
  my_discount_pkr integer
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
  select p.id, p.title, b.name, p.category_id,
         p.price_pkr, p.stock, p.images,
         least(coalesce(private.line_discount_cap(p.id, 1), 0), me.affordable_pkr)
    from public.products p
    left join public.brands b on b.id = p.brand_id
    cross join me
   where p.is_active
     and (p_category is null or p.category_id = p_category)
     and (p_search is null or p.title ilike '%' || p_search || '%')
   order by p.stock > 0 desc, p.created_at desc
   limit greatest(1, least(p_limit, 60)) offset greatest(0, p_offset)
$$;

comment on function public.store_feed(uuid, text, integer, integer) is
  'README §7.4. The saving shown is what this user can make today, capped by §0 and '
  'by their own balance. Out-of-stock items sort last rather than disappearing — '
  '"curate hard, twenty good SKUs" means a thin catalogue, and hiding half of it '
  'makes it look thinner still.';

revoke all on function public.store_feed(uuid, text, integer, integer) from public, anon;
grant execute on function public.store_feed(uuid, text, integer, integer) to authenticated;
