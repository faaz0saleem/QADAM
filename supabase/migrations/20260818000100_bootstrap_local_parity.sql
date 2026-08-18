-- 20260818000100_bootstrap_local_parity.sql
--
-- Makes a bare Postgres look enough like a Supabase database that every later
-- migration applies identically in both places.
--
-- ON A HOSTED SUPABASE PROJECT THIS FILE IS A NO-OP. The roles, the auth schema,
-- auth.users and auth.uid() all already exist there; every block below checks
-- before it creates and never replaces what it finds.
--
-- It exists so `npm test` can apply the real migration set to a throwaway local
-- database and prove the §0 constraint against the same SQL that ships.

create extension if not exists pgcrypto;

-- Supabase's three API roles ---------------------------------------------------
do $bootstrap$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
end
$bootstrap$;

-- service_role is the trusted server identity and bypasses RLS on Supabase.
-- Requires superuser, so only attempt it when it is actually missing (i.e. local).
do $bypassrls$
begin
  if not (select rolbypassrls from pg_roles where rolname = 'service_role') then
    alter role service_role bypassrls;
  end if;
exception
  when insufficient_privilege then
    raise notice 'service_role lacks BYPASSRLS and this role cannot grant it; ignoring';
end
$bypassrls$;

grant usage on schema public to anon, authenticated, service_role;

-- auth.users -------------------------------------------------------------------
-- Supabase owns this table. Locally we need just enough of it for public.users
-- to have something to reference.
create schema if not exists auth;

create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  phone        text unique,
  email        text unique,
  created_at   timestamptz not null default now()
);

-- auth.uid() -------------------------------------------------------------------
-- Every RLS policy in this schema is written against auth.uid(). Supabase's own
-- definition reads the verified JWT; the local stand-in reads the same GUC that
-- PostgREST sets, so policies can be exercised in tests with a plain SET LOCAL.
do $authuid$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    execute $create$
      create function auth.uid() returns uuid
      language sql stable
      as $body$
        select nullif(
          coalesce(
            current_setting('request.jwt.claim.sub', true),
            (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
          ),
          ''
        )::uuid;
      $body$;
    $create$;
  end if;
end
$authuid$;

grant usage on schema auth to anon, authenticated, service_role;
