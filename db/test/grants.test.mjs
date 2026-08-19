// The whole client-reachable surface, pinned.
//
// Two defaults conspire against a schema like this one:
//   * Postgres grants EXECUTE on a new function to PUBLIC
//   * Supabase grants on new tables to anon and authenticated
//
// Neither shows up locally, and neither is visible in a diff. So the surface is
// asserted here in full: adding a table, view or function means updating this
// list, which means someone has to decide whether a client should reach it.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback } from './helpers.mjs';

/**
 * Relations a client may reach at TABLE level, and with which privileges.
 *
 * Column-level grants do not appear here — information_schema.role_table_grants
 * only reports whole-table privileges. The three relations that are restricted
 * by column (users, products, order_items) are asserted separately below, which
 * is the stronger check: it pins the exact column list rather than the fact that
 * some restriction exists.
 */
const EXPECTED_TABLES = {
  // your own data
  users:            { authenticated: ['SELECT'] },
  daily_steps:      { authenticated: ['SELECT'] },
  coin_ledger:      { authenticated: ['SELECT'] },
  orders:           { authenticated: ['SELECT'] },
  ad_views:         { authenticated: ['SELECT'] },
  notifications:    { authenticated: ['SELECT'] },
  push_tokens:      { authenticated: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  // the shop — products and order_items are column-restricted, see below
  brands:           { anon: ['SELECT'], authenticated: ['SELECT'] },
  categories:       { anon: ['SELECT'], authenticated: ['SELECT'] },
  challenges:       { anon: ['SELECT'], authenticated: ['SELECT'] },
  // social
  teams:            { authenticated: ['SELECT'] },
  team_members:     { authenticated: ['SELECT', 'DELETE'] },
  friendships:      { authenticated: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
  leaderboard_snap: { authenticated: ['SELECT'] },
  // views
  coin_batches:             { authenticated: ['SELECT'] },
  public_profiles:          { authenticated: ['SELECT'] },
  product_discount_ceiling: { anon: ['SELECT'], authenticated: ['SELECT'] },
};

/**
 * Nothing else may be reachable. These are named rather than merely omitted
 * because each one is a specific thing that must not leak.
 */
const MUST_BE_UNREACHABLE = [
  'app_config',            // holds COIN_VALUE_PKR — §4 forbids publishing the rate
  'ad_reward_callbacks',   // AdMob transaction ids; a client must not see or seed them
  'fraud_events',        // tells an attacker which check caught them
  'order_confirmations', // a token here confirms or cancels an order
  'coin_liability',      // a rupee figure derived from the coin rate
  'order_economics',     // margin, per order
  'margin_breaches',     // margin, per order
  'catalogue_margins',   // margin, per category
  'fulfilment_health',   // internal RTO performance
  'referral_status',     // who referred whom, across all users
];

const CLIENT_FUNCTIONS = [
  'max_coin_discount_pkr', 'pkt_date', 'pkt_week_start',
  'coin_balance', 'affordable_discount_pkr', 'current_streak',
  'submit_steps', 'place_order',
  'leaderboard_page', 'leaderboard_friends',
  'create_team', 'join_team', 'team_roster',
  'rewarded_ads_left_today', 'my_referrals',
];

/** Reaching any of these from a client is a privilege escalation. */
const SERVER_ONLY_FUNCTIONS = [
  'config_num', 'config_int',
  'award_steps', 'credit_coins', 'spend_coins', 'refund_order_coins',
  'set_order_status', 'record_courier_status',
  'respond_to_confirmation', 'queue_order_confirmation', 'grant_verified_ad_reward',
  'queue_expiry_warnings', 'queue_streak_warnings', 'refresh_leaderboards',
  'gen_invite_code', 'gen_referral_code',
  'assert_basket_is_sane', 'assert_self',
];

async function tableGrants(c) {
  const { rows } = await c.query(`
    -- ::text throughout: information_schema columns are domains, and
    -- node-postgres hands an array of an unknown element type back as a string.
    select table_name::text as table_name,
           grantee::text    as grantee,
           array_agg(distinct privilege_type::text order by privilege_type::text) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated')
    group by table_name, grantee`);

  const map = {};
  for (const r of rows) {
    map[r.table_name] ??= {};
    map[r.table_name][r.grantee] = r.privs;
  }
  return map;
}

describe('the client-reachable surface is exactly what we intend', () => {
  test('no table or view is reachable that should not be', async () => {
    await withRollback(async (c) => {
      const actual = await tableGrants(c);
      const unexpected = Object.keys(actual).filter((t) => !(t in EXPECTED_TABLES));
      assert.deepEqual(
        unexpected.sort(), [],
        'these are reachable by a client and are not in the expected list — ' +
        'decide whether they should be, then update EXPECTED_TABLES',
      );
    });
  });

  test('each reachable relation carries only the privileges we granted', async () => {
    await withRollback(async (c) => {
      const actual = await tableGrants(c);
      for (const [table, expected] of Object.entries(EXPECTED_TABLES)) {
        for (const [role, privs] of Object.entries(expected)) {
          assert.deepEqual(
            (actual[table]?.[role] ?? []).sort(), [...privs].sort(),
            `${table} for ${role}`,
          );
        }
        for (const role of ['anon', 'authenticated']) {
          if (!(role in expected)) {
            assert.equal(actual[table]?.[role], undefined, `${table} must not be open to ${role}`);
          }
        }
      }
    });
  });

  test('the things that must never leak, do not', async () => {
    await withRollback(async (c) => {
      const actual = await tableGrants(c);
      for (const relation of MUST_BE_UNREACHABLE) {
        assert.equal(
          actual[relation], undefined,
          `${relation} is reachable by a client`,
        );
      }
    });
  });

  test('the column-restricted relations expose exactly the intended columns', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(`
        select table_name::text as table_name,
               grantee::text    as grantee,
               privilege_type::text as privilege,
               array_agg(distinct column_name::text order by column_name::text) as columns
        from information_schema.column_privileges
        where table_schema = 'public'
          and grantee in ('anon','authenticated')
          and table_name in ('users','products','order_items')
        group by 1, 2, 3`);

      const at = (table, grantee, privilege) =>
        rows.find((r) => r.table_name === table && r.grantee === grantee
          && r.privilege === privilege)?.columns ?? [];

      // name and city are the user's to change. status, device_hash,
      // referred_by, phone and referral_code are ours.
      assert.deepEqual(at('users', 'authenticated', 'UPDATE'), ['city', 'name']);

      // cost_pkr is absent from both, which is the whole point.
      assert.deepEqual(at('products', 'anon', 'SELECT'), [
        'affiliate_url', 'brand_id', 'category_id', 'created_at', 'id', 'images',
        'price_pkr', 'source', 'stock', 'title',
      ]);
      assert.deepEqual(at('order_items', 'authenticated', 'SELECT'), [
        'coin_eligible', 'discount_pkr', 'id', 'order_id', 'price_pkr', 'product_id', 'qty',
      ]);
    });
  });

  test('cost_pkr never reaches a client, on any relation', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(`
        select table_name::text as table_name from information_schema.column_privileges
        where table_schema = 'public' and column_name = 'cost_pkr'
          and grantee in ('anon','authenticated')`);
      assert.deepEqual(rows, [], 'our buying price is readable');
    });
  });
});

describe('function privileges', () => {
  test('anon can call only the three stateless helpers', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
        order by p.proname`);
      assert.deepEqual(
        [...new Set(rows.map((r) => r.proname))],
        ['max_coin_discount_pkr', 'pkt_date', 'pkt_week_start'],
      );
    });
  });

  test('an authenticated user can call only the client list', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
        order by p.proname`);
      assert.deepEqual([...new Set(rows.map((r) => r.proname))].sort(), [...CLIENT_FUNCTIONS].sort());
    });
  });

  test('the server-side functions are unreachable from a client', async () => {
    await withRollback(async (c) => {
      for (const fn of SERVER_ONLY_FUNCTIONS) {
        const { rows } = await c.query(`
          select bool_or(has_function_privilege('authenticated', p.oid, 'execute')
                      or has_function_privilege('anon', p.oid, 'execute')) as reachable
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = $1`, [fn]);
        assert.notEqual(rows[0]?.reachable, undefined, `${fn} does not exist`);
        assert.equal(rows[0].reachable, false, `${fn} is callable by a client`);
      }
    });
  });
});
