set client_min_messages = warning;

-- Local-only shims so the migrations can be applied to a bare Postgres cluster.
--
-- On a real Supabase project every object below already exists and every statement
-- here is a no-op. This file is NEVER a migration — it must not be applied to
-- production, and nothing in supabase/migrations/ may depend on it doing anything.

create extension if not exists pgtap;
create extension if not exists pgcrypto;

-- Supabase's PostgREST roles ---------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  grant anon, authenticated, service_role to authenticator;
  grant anon, authenticated, service_role to postgres;
end $$;

-- Supabase's auth schema, reduced to what we actually use ----------------------
create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  id             uuid primary key default gen_random_uuid(),
  phone          text unique,
  email          text unique,
  created_at     timestamptz not null default now()
);

-- Identical semantics to Supabase's: read the subject out of the request JWT.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;
