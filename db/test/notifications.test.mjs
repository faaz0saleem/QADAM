// §4, §12 — the expiry reminder fires, once.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, makeUser } from './helpers.mjs';

const queued = async (c, user, kind) =>
  (await c.query(
    'select payload, dedupe_key from notifications where user_id = $1 and kind = $2', [user, kind],
  )).rows;

describe('§12 the seven-days-out expiry notification', () => {
  test('queues a warning for a batch expiring inside the window', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 2400, 'steps', null, 5)`, [user]);
      assert.equal((await c.query('select queue_expiry_warnings() as n')).rows[0].n, 1);

      const rows = await queued(c, user, 'coins_expiring');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].payload.coins, 2400);
      assert.ok(rows[0].payload.days_left <= 7);
    });
  });

  test('says nothing about a batch that is not close to expiring', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 5000, 'steps', null, 60)`, [user]);
      await c.query('select queue_expiry_warnings()');
      assert.equal((await queued(c, user, 'coins_expiring')).length, 0);
    });
  });

  test('does not nag: a daily sweep queues each batch exactly once', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 3000, 'steps', null, 4)`, [user]);
      await c.query('select queue_expiry_warnings()');
      await c.query('select queue_expiry_warnings()');
      await c.query('select queue_expiry_warnings()');
      assert.equal((await queued(c, user, 'coins_expiring')).length, 1);
    });
  });

  test('stays quiet about a handful of coins', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 40, 'steps', null, 3)`, [user]);
      await c.query('select queue_expiry_warnings()');
      assert.equal((await queued(c, user, 'coins_expiring')).length, 0);
    });
  });

  test('counts only what is left after a spend', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 30 });
      await c.query(`select credit_coins($1, 3000, 'steps', null, 5)`, [user]);
      const { rows: o } = await c.query(
        `insert into orders (user_id, payment_method, address, phone)
         values ($1, 'cod', '{}', '+923001234567') returning id`, [user],
      );
      await c.query(`select spend_coins($1, 1000, 'order_hold', $2)`, [user, o[0].id]);
      await c.query('select queue_expiry_warnings()');
      const rows = await queued(c, user, 'coins_expiring');
      assert.equal(rows[0].payload.coins, 2000, 'spent coins must not be warned about');
    });
  });
});

describe('§7.1 streak-break reminders', () => {
  test('warns a user whose streak is alive but unfed today', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 30 });
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         select $1, pkt_date() - g, 9000, 9000, 90, 'health_connect', true
         from generate_series(1, 6) g`, [user],
      );
      await c.query('select queue_streak_warnings()');
      const rows = await queued(c, user, 'streak_at_risk');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].payload.streak, 6);
    });
  });

  test('says nothing once today already qualifies', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 30 });
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         select $1, pkt_date() - g, 9000, 9000, 90, 'health_connect', true
         from generate_series(0, 6) g`, [user],
      );
      await c.query('select queue_streak_warnings()');
      assert.equal((await queued(c, user, 'streak_at_risk')).length, 0);
    });
  });
});
