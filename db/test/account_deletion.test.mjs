// docs/OPERATIONS.md §1.2 — in-app account deletion.
//
// The hard part is that coin_ledger is append-only by trigger, so "delete the
// user" is not available. What has to be true instead: everything personal is
// gone, the financial record survives with the person scrubbed out of it, and
// the account can never act again.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, asUser, flushDeferred } from './helpers.mjs';

const deleteAccount = (c, user) =>
  asUser(c, user, () => c.query('select * from delete_my_account()'));

describe('§1.2 what deletion removes', () => {
  test('erases health data, behaviour, social graph and reachability', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const friend = await makeUser(c);

      await c.query(`select award_steps($1, pkt_date() - 1, 9000, 'health_connect', true)`, [user]);
      await c.query(
        `insert into analytics_events (user_id, session_id, name) values ($1, gen_random_uuid(), 'app_open')`,
        [user]);
      await c.query(
        `insert into friendships (user_id, friend_id, status) values ($1, $2, 'accepted')`,
        [user, friend]);
      await c.query(
        `insert into push_tokens (user_id, token, platform) values ($1, 'tok', 'android')`, [user]);
      await c.query('select refresh_leaderboards()');

      await deleteAccount(c, user);

      const count = async (table) =>
        (await c.query(`select count(*)::int as n from ${table} where user_id = $1`, [user])).rows[0].n;

      assert.equal(await count('daily_steps'), 0, 'health data must go');
      assert.equal(await count('analytics_events'), 0, 'behaviour must go');
      assert.equal(await count('push_tokens'), 0, 'reachability must go');
      assert.equal(await count('leaderboard_snap'), 0);
      const { rows: f } = await c.query(
        'select count(*)::int as n from friendships where user_id = $1 or friend_id = $1', [user]);
      assert.equal(f[0].n, 0, 'the social graph must go in both directions');
    });
  });

  test('scrubs the person out of the row the financial records point at', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { city: 'Lahore' });
      await c.query(`update users set device_hash = 'abc', name = 'Ayesha' where id = $1`, [user]);

      await deleteAccount(c, user);

      const { rows } = await c.query(
        'select name, city, device_hash, referral_code, phone, status from users where id = $1',
        [user]);
      const u = rows[0];
      assert.equal(u.name, null);
      assert.equal(u.city, null);
      assert.equal(u.device_hash, null);
      assert.equal(u.referral_code, null);
      assert.equal(u.status, 'deleted');
      assert.match(u.phone, /^deleted:/,
        'the number must not be freed for reuse — a new owner would inherit the history');
    });
  });

  test('keeps the ledger intact, because it is append-only and must be', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 500, 'steps')`, [user]);

      const { rows } = await deleteAccount(c, user);
      assert.equal(Number(rows[0].ledger_rows_retained), 1);

      const { rows: ledger } = await c.query(
        'select count(*)::int as n from coin_ledger where user_id = $1', [user]);
      assert.equal(ledger[0].n, 1, 'a ledger that can be erased is not a ledger');
    });
  });

  test('keeps orders as anonymous accounting entries', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await asUser(c, user, async () =>
        (await c.query(
          `select place_order($1::jsonb, '{}'::jsonb, '+923001234567', 'cod', 0) as id`,
          [JSON.stringify([{ product_id: shirt, qty: 1 }])])).rows[0].id);
      await flushDeferred(c);

      await deleteAccount(c, user);

      const { rows } = await c.query('select gross_profit_pkr from order_economics where id = $1', [id]);
      assert.equal(Number(rows[0].gross_profit_pkr), 2000,
        '§3.3 margin reporting must survive a deletion');
    });
  });

  test('hands a team to its longest-standing member rather than deleting it', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const member = await makeUser(c);
      const code = await asUser(c, captain, async () =>
        (await c.query(`select invite_code from create_team('Walkers')`)).rows[0].invite_code);
      await asUser(c, member, () => c.query('select join_team($1)', [code]));

      await deleteAccount(c, captain);

      const { rows } = await c.query('select captain_id from teams');
      assert.equal(rows.length, 1, 'the other members did not ask to lose their team');
      assert.equal(rows[0].captain_id, member);
    });
  });

  test('deletes a team that had nobody else in it', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      await asUser(c, captain, () => c.query(`select create_team('Solo')`));
      await deleteAccount(c, captain);
      const { rows } = await c.query('select count(*)::int as n from teams');
      assert.equal(rows[0].n, 0);
    });
  });
});

describe('§1.2 a deleted account cannot act again', () => {
  test('REJECTS a step submission even with a live session', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await deleteAccount(c, user);
      await asUser(c, user, () =>
        expectRejected(c, () =>
          c.query(`select submit_steps(pkt_date() - 1, 5000, 'health_connect')`),
          /account has been deleted/));
    });
  });

  test('REJECTS spending whatever coins the ledger still shows', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 5000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      await deleteAccount(c, user);

      await asUser(c, user, () =>
        expectRejected(c, () =>
          c.query(
            `select place_order($1::jsonb, '{}'::jsonb, '+923001234567', 'cod', 5000)`,
            [JSON.stringify([{ product_id: shirt, qty: 1 }])])));
    });
  });

  test('drops off every leaderboard', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { city: 'Lahore' });
      const other = await makeUser(c, { city: 'Lahore' });
      await c.query(`select award_steps($1, pkt_date() - 1, 14000, 'health_connect', true)`, [user]);
      await c.query(`select award_steps($1, pkt_date() - 1, 3000, 'health_connect', true)`, [other]);

      await deleteAccount(c, user);
      await c.query('select refresh_leaderboards()');

      const { rows } = await c.query(`select * from leaderboard_page($1, 'city')`, [other]);
      assert.deepEqual(rows.map((r) => r.user_id), [other]);
    });
  });
});
