-- Test-only fixture helpers. Applied after the migrations, never in production.
-- Everything lives in the `tests` schema so it can never be confused for app code.
create schema if not exists tests;

-- A user, with the auth.users row Supabase would have created at signup.
create or replace function tests.new_user(
  p_phone       text default null,
  p_city        text default 'Lahore',
  p_device_hash text default null,
  p_created_at  timestamptz default now()
) returns uuid
language plpgsql as $$
declare
  v_id    uuid := gen_random_uuid();
  v_phone text := coalesce(p_phone, '+9230' || lpad((random() * 99999999)::bigint::text, 8, '0'));
begin
  insert into auth.users (id, phone) values (v_id, v_phone);
  insert into public.users (id, phone, name, city, device_hash, created_at)
  values (v_id, v_phone, 'Test User', p_city, p_device_hash, p_created_at);
  return v_id;
end $$;

create or replace function tests.default_brand() returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.brands where name = 'Test Brand';
  if v_id is null then
    insert into public.brands (name, contact, commission_pct)
    values ('Test Brand', 'test@example.com', 20) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function tests.default_category(p_coin_eligible boolean default true) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from public.categories where name = 'Test Category';
  if v_id is null then
    insert into public.categories (name, coin_eligible)
    values ('Test Category', p_coin_eligible) returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function tests.new_product(p_price int, p_cost int, p_stock int default 100)
returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.products (title, brand_id, category_id, price_pkr, cost_pkr, stock, source)
  values ('Test Product', tests.default_brand(), tests.default_category(),
          p_price, p_cost, p_stock, 'owned')
  returning id into v_id;
  return v_id;
end $$;

create or replace function tests.new_order(p_user uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.orders (user_id, status, payment_method, address, phone)
  values (p_user, 'pending_confirmation', 'cod', 'House 1, Gulberg, Lahore', '+923001234567')
  returning id into v_id;
  return v_id;
end $$;

-- Run a statement as a PostgREST role with a given user's JWT, the way the client would.
create or replace function tests.as_user(p_user uuid, p_role text default 'authenticated')
returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user::text, 'role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function tests.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
end $$;
