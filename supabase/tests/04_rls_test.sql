-- ============================================================================
-- What a device can reach.
--
-- Two facts this file exists to keep true:
--   products.cost_pkr   never reaches a client — it is our margin
--   private.app_config  never reaches a client — above all COIN_VALUE_PKR, the
--                       coin-to-rupee rate, which §4 says is never published
--
-- Plus the ordinary one: no user can read another user's coins or steps.
-- ============================================================================
begin;
select plan(27);

create temporary table t (a uuid, b uuid, prod uuid);
insert into t (a, b, prod) values (
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_user(p_created_at => now() - interval '90 days'),
  tests.new_product(2000, 1200));
select private.mint_coins((select a from t), 750, 'steps', public.pkt_date(now()) - 1) \gset m_
insert into public.daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
select a, public.pkt_date(now()) - 1, 7500, 7500, 75, 'health_connect', true from t;

-- ── RLS is on everywhere, so a forgotten policy fails closed ───────────────
select is(
  (select string_agg(c.relname, ', ' order by c.relname)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'every table in public has row level security enabled');

-- ── the margin ─────────────────────────────────────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       'select cost_pkr from public.products'),
  'a signed-in user cannot read products.cost_pkr');

select ok(tests.denied('anon', null,
       'select cost_pkr from public.products'),
  'nor can an anonymous one');

select ok(tests.denied('authenticated', (select a from t),
       'select * from public.products'),
  'the products table itself is not readable — the catalogue comes from a view');

select hasnt_column('public', 'store_products', 'cost_pkr',
  'store_products has no cost_pkr column at all');

select is(
  tests.count_as('anon', null, 'select id from public.store_products'),
  1,
  'the store view is readable anonymously, so the shop works before signup');

select is(
  tests.count_as('anon', null, 'select id from public.categories'),
  1,
  'categories are readable anonymously');

-- ── the coin rate ──────────────────────────────────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       'select value from private.app_config'),
  'a signed-in user cannot read private.app_config');

select ok(tests.denied('authenticated', (select a from t),
       $q$select private.cfg('COIN_VALUE_PKR')$q$),
  'nor call the accessor that would read it');

select ok(tests.denied('anon', null,
       $q$select private.cfg_int('STEPS_PER_COIN')$q$),
  'nor can an anonymous caller');

-- ── one user, one wallet ───────────────────────────────────────────────────
select is(
  tests.count_as('authenticated', (select a from t),
                 'select id from public.coin_ledger'),
  1,
  'a user sees their own ledger rows');

select is(
  tests.count_as('authenticated', (select b from t),
                 'select id from public.coin_ledger'),
  0,
  'and sees nothing of anyone else''s — RLS, not a WHERE clause the app remembers');

select is(
  tests.count_as('authenticated', (select b from t),
                 'select user_id from public.daily_steps'),
  0,
  'the same for step history');

select is(
  tests.count_as('authenticated', (select b from t),
                 'select id from public.users'),
  1,
  'a user sees exactly one row in users: their own');

select ok(tests.denied('authenticated', (select b from t),
       format('select public.coin_balance(%L)', (select a from t))),
  'the uuid-taking balance function is not callable by a client at all');

select is(
  tests.count_as('authenticated', (select a from t),
                 'select public.my_coin_balance()'),
  1,
  'the first-person wrapper is callable');

-- ── the ledger is not writable from a device ───────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       format('insert into public.coin_ledger (user_id, delta, reason, expires_at) '
              || 'values (%L, 1000000, ''adjustment_credit'', now() + interval ''90 days'')',
              (select a from t))),
  'a user cannot mint themselves coins');

select ok(tests.denied('authenticated', (select a from t),
       'delete from public.coin_ledger'),
  'nor delete ledger rows');

select ok(tests.denied('authenticated', (select a from t),
       format('insert into public.daily_steps (user_id, date, raw_steps, credited_steps, source) '
              || 'values (%L, current_date, 999999, 999999, ''manual'')', (select a from t))),
  'nor write step rows directly, going round every fraud control');

select ok(tests.denied('authenticated', (select a from t),
       format('select public.submit_steps(%L, ''[]''::jsonb, ''health_connect'')', (select a from t))),
  'nor call submit_steps — that is the Edge Function''s job, after attestation');

-- ── a user cannot promote themselves out of a flag ─────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       'update public.users set status = ''active'''),
  'a user cannot edit their own status');

select ok(tests.denied('authenticated', (select a from t),
       'update public.users set device_hash = ''fresh-device'''),
  'nor their device hash');

select ok(not tests.denied('authenticated', (select a from t),
       'update public.users set city = ''Karachi'''),
  'but they can change their own city');

-- ── COGS reporting is admin-only ───────────────────────────────────────────
select ok(tests.denied('authenticated', (select a from t),
       'select cogs_pkr from public.order_economics'),
  'order_economics is not readable by a client — it carries COGS');

-- ── fraud events tell an attacker which control caught them ────────────────
select ok(tests.denied('authenticated', (select a from t),
       'select kind from public.fraud_events'),
  'fraud_events is unreadable, even for your own rows');

-- ── views must not launder RLS ─────────────────────────────────────────────
-- A view without security_invoker runs as its owner and silently bypasses every
-- policy on the tables beneath it.
select is(
  (select string_agg(c.relname, ', ')
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and has_table_privilege('authenticated', c.oid, 'select')
      and coalesce((select option_value from pg_options_to_table(c.reloptions)
                     where option_name = 'security_invoker'), 'false') <> 'true'
      -- pgTAP ships its own views into this database; they are not ours to police.
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')),
  null,
  'every client-readable view in public is security_invoker');

select ok(tests.denied('anon', null, 'select id from public.orders'),
  'an anonymous caller cannot read orders');

select * from finish();
rollback;
