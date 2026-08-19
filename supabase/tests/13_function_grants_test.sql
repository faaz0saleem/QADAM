-- ============================================================================
-- The complete inventory of what a client role may CALL.
--
-- The companion to 12_privileges_test.sql, and it exists for the same reason:
-- spot-checks find what someone thought to check. This enumerates.
--
-- The specific trap being guarded is Postgres's own default. EXECUTE on every
-- new function is granted to PUBLIC at creation, and anon and authenticated
-- inherit from PUBLIC — so revoking from those two does nothing, and a blanket
-- sweep only covers what existed when it ran.
-- ============================================================================
begin;
select plan(6);

create or replace function tests.callable_by(p_role text, p_schema text)
returns text language sql stable as $$
  select string_agg(p.proname, ', ' order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = p_schema
     and has_function_privilege(p_role, p.oid, 'EXECUTE')
     -- Extension-owned functions (pgTAP) are not ours to police.
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
$$;

-- ── nothing in private, ever ───────────────────────────────────────────────
select is(tests.callable_by('authenticated', 'private'), null,
  'a signed-in client can call nothing in the private schema');

select is(tests.callable_by('anon', 'private'), null,
  'nor can an anonymous one');

-- ── the public surface, enumerated ─────────────────────────────────────────
-- Changing this list means changing what a device can do. Allowed — but it has
-- to be deliberate enough to edit this line.
select is(
  tests.callable_by('authenticated', 'public'),
  'active_challenges, add_friend, apply_referral_code, cancel_my_order, '
  || 'create_team, current_leaderboard_period, hand_over_captaincy, join_team, '
  || 'leaderboard, leave_team, max_coin_discount_pkr, my_coin_balance, '
  || 'my_coin_batches, my_coins_expiring_within, my_discount_on, my_friends, '
  || 'my_orders, my_rank, my_referral_code, my_referrals, my_streak_days, '
  || 'my_team, order_coin_state, pkt_date, pkt_day_start, pkt_week_start, '
  || 'place_order, register_push_token, remove_friend, request_account_deletion, '
  || 'store_feed, team_roster',
  'the signed-in callable surface is exactly these thirty-two functions');

-- The earning path is the one that must not be reachable, and it is the one an
-- attacker would look for first.
select is(
  (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('submit_steps', 'credit_rewarded_ad', 'coin_balance',
                        'coin_batches', 'coins_expiring_soon', 'streak_days',
                        'issue_attestation_nonce', 'consume_attestation_nonce',
                        'rebuild_leaderboards', 'streaks_at_risk',
                        'product_max_discount_pkr', 'can_redeem', 'delete_account',
                        'set_order_status', 'line_discount_cap')
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE'))),
  null,
  'no client can call the ingestion, attestation, or any uuid-taking wallet function');

-- ── the service role can still do its job ──────────────────────────────────
select ok(
  has_function_privilege('service_role',
    'public.submit_steps(uuid, jsonb, text, text, boolean, jsonb)', 'EXECUTE'),
  'service_role can still call submit_steps — the Edge Function needs it');

select ok(
  has_function_privilege('service_role', 'public.credit_rewarded_ad(uuid, text, text)', 'EXECUTE'),
  'and credit_rewarded_ad, for the AdMob callback');

select * from finish();
rollback;
