-- A margin leak, closed.
--
-- products.cost_pkr was carefully protected by a column-level grant that
-- enumerates the safe columns. order_items.cost_pkr was not: the grant there was
-- `grant select on public.orders, public.order_items to authenticated`, which is
-- every column including the snapshot of what we paid.
--
-- RLS limits the rows to the caller's own orders, so this is not "anyone can
-- read our costs" — it is "every customer can read our cost on everything they
-- have ever bought", which is the same data with a slower collection rate. Buy
-- one of each and you have the margin on the catalogue.
--
-- The lesson generalises, and it is why 12_privileges_test.sql now exists: a
-- table-level GRANT is a promise about every column the table will ever have,
-- including the ones added next year.

revoke select on public.order_items from authenticated;

grant select (id, order_id, product_id, qty, price_pkr, discount_pkr, created_at)
  on public.order_items to authenticated;

-- While here: device_hash is a fraud control (§6.1), and a farmer who can read
-- what we fingerprint is a farmer who knows what to change. A user has no reason
-- to see it, not even their own.
revoke select on public.users from authenticated;

grant select (id, phone, name, city, created_at, referred_by, status, locale,
              phone_verified_at, referral_code)
  on public.users to authenticated;

comment on column public.order_items.cost_pkr is
  'What the item cost us, snapshot at purchase. NEVER granted to a client — not '
  'even to the customer whose order it is. Enumerate columns when granting on '
  'this table; a table-level grant hands over every column it will ever have.';
