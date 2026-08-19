-- Row level security, and the grants that decide what a device can ever see.
--
-- The posture is default-deny. Every table has RLS on, including tables with no
-- client-facing policy at all, so a forgotten policy fails closed. Clients read
-- through views and call through functions; they hold almost no direct table
-- privileges.
--
-- Two things must never reach a device, whatever else changes:
--   products.cost_pkr        — our margin
--   private.app_config       — above all COIN_VALUE_PKR, the coin-to-rupee rate,
--                              which §4 says is never published in the UI
--
-- Both are protected structurally rather than by policy: cost_pkr is not in any
-- granted view, and `private` is not in PostgREST's exposed schemas at all.

-- ---------------------------------------------------------------------------
-- Identity: a public.users row appears with the auth.users row, not later.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  insert into public.users (id, phone)
  values (new.id, coalesce(new.phone, new.email, new.id::text))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Nothing is granted by default, now or in future migrations.
-- ---------------------------------------------------------------------------
revoke create on schema public from public;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all tables    in schema private from anon, authenticated;
revoke all on all functions in schema private from anon, authenticated;
revoke usage on schema private from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema private
  revoke all on tables from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS on everything. Default deny; policies open the narrowest door that works.
-- ---------------------------------------------------------------------------
alter table public.users        enable row level security;
alter table public.daily_steps  enable row level security;
alter table public.coin_ledger  enable row level security;
alter table public.fraud_events enable row level security;
alter table public.brands       enable row level security;
alter table public.categories   enable row level security;
alter table public.products     enable row level security;
alter table public.orders       enable row level security;
alter table public.order_items  enable row level security;

-- users: read yourself, edit the three fields that are yours to edit.
create policy users_select_self on public.users
  for select to authenticated using (id = auth.uid());
create policy users_update_self on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select on public.users to authenticated;
-- Column-level, so status, device_hash and referred_by are not self-servable.
grant update (name, city, locale) on public.users to authenticated;

-- daily_steps and coin_ledger: yours to read, never yours to write. Every write
-- goes through submit_steps or the ledger functions, as service_role.
create policy daily_steps_select_self on public.daily_steps
  for select to authenticated using (user_id = auth.uid());
grant select on public.daily_steps to authenticated;

create policy coin_ledger_select_self on public.coin_ledger
  for select to authenticated using (user_id = auth.uid());
grant select on public.coin_ledger to authenticated;

-- fraud_events: no policy, no grant. A user learning which control caught them
-- is a user learning how to get past it (§6.1).

-- Catalogue: readable, minus the one column that is our margin.
--
-- The grant enumerates the safe columns rather than excluding the unsafe one, so
-- a column added to products tomorrow is private until someone deliberately adds
-- it here. `select *` on products fails for a client, by design — the expansion
-- includes cost_pkr.
create policy brands_select_public on public.brands
  for select to anon, authenticated using (status in ('signed','active'));
create policy categories_select_public on public.categories
  for select to anon, authenticated using (true);
create policy products_select_active on public.products
  for select to anon, authenticated using (is_active);

grant select (id, name, status) on public.brands to anon, authenticated;
grant select on public.categories to anon, authenticated;
grant select (id, title, brand_id, category_id, price_pkr, stock, source,
              affiliate_url, images, is_active, created_at)
  on public.products to anon, authenticated;

-- Orders: read your own. Writes are Phase 2 and will go through a checkout RPC,
-- because a client that can INSERT an order line is a client that can try to
-- write its own discount.
create policy orders_select_self on public.orders
  for select to authenticated using (user_id = auth.uid());
create policy order_items_select_self on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
grant select on public.orders, public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- The store view. security_invoker so the caller's RLS applies — a plain view
-- would run as its owner and quietly bypass every policy above.
-- ---------------------------------------------------------------------------
create view public.store_products
with (security_invoker = true) as
select p.id,
       p.title,
       p.brand_id,
       b.name as brand_name,
       p.category_id,
       p.price_pkr,
       p.stock,
       p.source,
       p.affiliate_url,
       p.images,
       p.created_at
  from public.products p
  left join public.brands b on b.id = p.brand_id
 where p.is_active;

comment on view public.store_products is
  'The catalogue as a client may see it. security_invoker means the caller''s own RLS and '
  'column grants apply through the view rather than the view owner''s — so this cannot be '
  'used to launder a column the caller is not entitled to. cost_pkr is absent from both '
  'the view and the grant beneath it.';

grant select on public.store_products to anon, authenticated;

-- order_economics carries COGS. Admin only — no grant to any client role.
revoke all on public.order_economics from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions: the client gets first-person wrappers only.
--
-- coin_balance(uuid) would let any authenticated user read anyone's balance, and
-- it is security definer, so RLS would not stop them. The uuid forms stay
-- server-side; clients call the my_* forms, which can only ever mean themselves.
-- ---------------------------------------------------------------------------
create or replace function public.my_coin_balance()
returns integer
language sql stable
as $$ select public.coin_balance(auth.uid()) $$;

create or replace function public.my_coin_batches()
returns table (batch_id uuid, minted_at timestamptz, reason text,
               minted integer, remaining integer, expires_at timestamptz, days_left integer)
language sql stable
as $$ select * from public.coin_batches(auth.uid()) $$;

create or replace function public.my_coins_expiring_within(p_days integer)
returns integer
language sql stable
as $$ select public.coins_expiring_within(auth.uid(), p_days) $$;

create or replace function public.my_streak_days()
returns integer
language sql stable
as $$ select public.streak_days(auth.uid()) $$;

comment on function public.my_coin_balance() is
  'First-person only. The uuid-taking form is security definer and would otherwise let '
  'any signed-in user read any other user''s balance.';

-- Postgres grants EXECUTE on every new function to PUBLIC. Revoking from anon and
-- authenticated alone therefore does nothing: they inherit it. PUBLIC is the grant
-- that has to go.
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function
  public.coin_balance(uuid),
  public.coin_batches(uuid),
  public.coins_expiring_within(uuid, integer),
  public.streak_days(uuid, date),
  public.streak_multiplier(integer),
  public.can_redeem(uuid),
  public.redemption_unlocks_at(uuid),
  public.product_max_discount_pkr(uuid),
  public.submit_steps(uuid, jsonb, text, text, boolean, jsonb)
from public, anon, authenticated;

grant execute on function
  public.my_coin_balance(),
  public.my_coin_batches(),
  public.my_coins_expiring_within(integer),
  public.my_streak_days(),
  public.pkt_date(timestamptz)
to authenticated;

-- submit_steps is called by the ingest-steps Edge Function, which holds the
-- service role key and has already verified a Play Integrity / App Attest token.
-- A device must never reach it directly.
grant execute on function
  public.submit_steps(uuid, jsonb, text, text, boolean, jsonb),
  public.coin_balance(uuid),
  public.coin_batches(uuid),
  public.coins_expiring_within(uuid, integer),
  public.streak_days(uuid, date),
  public.can_redeem(uuid),
  public.product_max_discount_pkr(uuid)
to service_role;
