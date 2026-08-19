-- ============================================================================
-- The complete inventory of what a client role may touch.
--
-- Every other test in this suite asks "can a client reach this particular
-- thing?" — which only ever catches what someone thought to ask about. This one
-- asks the opposite question: here is EVERYTHING anon and authenticated can
-- reach; is all of it meant to be there?
--
-- A future migration that widens client access has to come here and say so. That
-- is the point. This test existing is how the order_items.cost_pkr leak was
-- found: products.cost_pkr had a careful column-level grant, and order_items had
-- `grant select on ... to authenticated`, which is every column including our
-- cost on everything a customer ever bought.
-- ============================================================================
begin;
select plan(11);

-- ── the two things that must never be reachable ────────────────────────────
select is(
  (select string_agg(distinct c.grantee || ':' || c.table_name || '.' || c.column_name, ', ')
     from information_schema.column_privileges c
    where c.grantee in ('anon', 'authenticated')
      and c.table_schema = 'public'
      and c.column_name = 'cost_pkr'),
  null,
  'NO client role can read cost_pkr on ANY table — not products, not order lines');

select is(
  (select count(*)::int
     from information_schema.table_privileges
    where grantee in ('anon', 'authenticated') and table_schema = 'private'),
  0,
  'no client role holds any privilege in the private schema');

select is(
  (select count(*)::int
     from information_schema.role_usage_grants
    where grantee in ('anon', 'authenticated') and object_schema = 'private'),
  0,
  'nor even USAGE on it, which is what keeps COIN_VALUE_PKR off every device');

-- ── nothing is writable except the three fields that are yours ─────────────
select is(
  (select coalesce(string_agg(
            grantee || ' ' || privilege_type || ' ' || table_name, ', ' order by table_name), '')
     from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated')
      and table_schema = 'public'
      and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  '',
  'no client role can INSERT or DELETE anything, anywhere — every write is an RPC');

select is(
  (select string_agg(c.table_name || '.' || c.column_name, ', ' order by c.column_name)
     from information_schema.column_privileges c
    where c.grantee = 'authenticated' and c.table_schema = 'public'
      and c.privilege_type = 'UPDATE'),
  'users.city, users.locale, users.name',
  'the only updatable columns anywhere are the three that belong to the user');

select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee = 'anon' and table_schema = 'public'
      and privilege_type <> 'SELECT'),
  0,
  'an anonymous caller can only read, never write');

-- ── the full readable surface, enumerated ──────────────────────────────────
-- If this list changes, a migration changed what a device can see. That is
-- allowed — it just has to be deliberate enough to edit this line.
-- Column-level grants do not appear in role_table_grants at all, which is a trap
-- worth stating: querying only that view reports a table whose every column is
-- granted, one column at a time, as ungranted.
create or replace function tests.readable_by(p_role text)
returns text language sql stable as $$
  select string_agg(distinct t, ', ' order by t) from (
    select table_name as t from information_schema.role_table_grants
     where grantee = p_role and table_schema = 'public' and privilege_type = 'SELECT'
    union
    select table_name from information_schema.column_privileges
     where grantee = p_role and table_schema = 'public' and privilege_type = 'SELECT'
  ) x
$$;

select is(
  tests.readable_by('anon'),
  'brands, categories, challenges, products, store_products, teams',
  'the anonymous readable surface is exactly the catalogue and the public team info');

select is(
  tests.readable_by('authenticated'),
  'ad_impressions, brands, categories, challenges, coin_ledger, daily_steps, '
  || 'friendships, order_items, orders, products, push_tokens, referrals, '
  || 'store_products, team_members, teams, users',
  'and the signed-in readable surface is exactly these sixteen');

-- ── the sensitive tables are absent from both ──────────────────────────────
select is(
  (select coalesce(string_agg(distinct t, ', '), '') from (
     select table_name as t from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated') and table_schema = 'public'
     union
     select table_name from information_schema.column_privileges
      where grantee in ('anon', 'authenticated') and table_schema = 'public'
   ) x where t in ('fraud_events', 'leaderboard_snap', 'order_economics', 'notifications_sent')),
  '',
  'fraud_events, leaderboard_snap, order_economics and notifications_sent are '
  'reachable only through functions, never directly');

-- ── no policy is wider than the thing it protects ──────────────────────────
-- `using (true)` is correct for the catalogue and for public team info, and
-- wrong for anything about a person. Listing the exceptions means a new one has
-- to be argued for here rather than written in passing.
select is(
  (select string_agg(tablename, ', ' order by tablename)
     from pg_policies
    where schemaname = 'public' and qual = 'true'),
  'categories, challenges, teams',
  'only the catalogue and public team info are readable without a WHERE clause');

-- Every other policy has to mention the caller. A policy on a per-person table
-- that never says auth.uid() is a policy that is not scoping anything.
select is(
  (select string_agg(tablename || '.' || policyname, ', ' order by tablename)
     from pg_policies
    where schemaname = 'public'
      and tablename not in ('categories', 'challenges', 'teams', 'brands', 'products')
      and coalesce(qual, '') not like '%auth.uid()%'),
  null,
  'every per-person policy scopes on auth.uid()');

select * from finish();
rollback;
