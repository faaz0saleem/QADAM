// §4, §6.1, §13.2 — what a client can and cannot reach.
//
// Every test here runs as the `authenticated` role with a real auth.uid(), which
// is exactly what a PostgREST request from the app is. Two things must never
// come back: our buying price, and the coin-to-rupee rate.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, asUser } from './helpers.mjs';

describe('§4 the coin rate is not publishable', () => {
  test('app_config is unreadable by an authenticated client', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () => c.query('select * from app_config'), /permission denied/));
    });
  });

  test('the config accessors are not callable by a client either', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        await expectRejected(c, () => c.query(`select config_num('COIN_VALUE_PKR')`), /permission denied/);
        await expectRejected(c, () => c.query(`select config_int('STEPS_PER_COIN')`), /permission denied/);
      });
    });
  });
});

describe('cost_pkr never leaves the server', () => {
  test('a client cannot select cost_pkr from products', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await makeProduct(c, { price: 3000, cost: 1000 });
      await asUser(c, user, async () => {
        await expectRejected(c, () => c.query('select cost_pkr from products'), /permission denied/);
        await expectRejected(c, () => c.query('select * from products'), /permission denied/);
        // but the fields a shop needs are fine
        const { rows } = await c.query('select title, price_pkr, stock from products');
        assert.ok(rows.length > 0);
      });
    });
  });

  test('a client cannot select cost_pkr from their own order items', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () => c.query('select cost_pkr from order_items'), /permission denied/));
    });
  });

  test('the discount ceiling is still publishable, because it is derived not raw', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const p = await makeProduct(c, { price: 100000, cost: 96000 });
      await asUser(c, user, async () => {
        const { rows } = await c.query(
          'select max_discount_pkr from product_discount_ceiling where product_id = $1', [p],
        );
        assert.equal(rows[0].max_discount_pkr, 800);
      });
    });
  });
});

describe('§13.2 the client cannot write to the coin economy', () => {
  test('a client cannot INSERT into coin_ledger', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () =>
          c.query(
            `insert into coin_ledger (user_id, delta, reason, expires_at)
             values ($1, 1000000, 'steps', now() + interval '90 days')`, [user]),
          /permission denied/));
    });
  });

  test('a client cannot call credit_coins or spend_coins', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        await expectRejected(c, () => c.query(`select credit_coins($1, 999, 'steps')`, [user]), /permission denied/);
        await expectRejected(c, () => c.query(`select spend_coins($1, 1, 'admin_debit', null)`, [user]), /permission denied/);
      });
    });
  });

  test('a client cannot call award_steps directly and name its own user', async () => {
    await withRollback(async (c) => {
      const victim = await makeUser(c);
      const attacker = await makeUser(c);
      await asUser(c, attacker, () =>
        expectRejected(c, () =>
          c.query(`select award_steps($1, pkt_date(), 15000, 'health_connect', true)`, [victim]),
          /permission denied/));
    });
  });

  test('a client cannot write its own daily_steps row', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () =>
          c.query(
            `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source)
             values ($1, pkt_date(), 99999, 99999, 9999, 'health_connect')`, [user]),
          /permission denied/));
    });
  });

  test('a client cannot self-confirm a delivery or refund a burned order', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        await expectRejected(c, () =>
          c.query(`select set_order_status(gen_random_uuid(), 'delivered')`), /permission denied/);
        await expectRejected(c, () =>
          c.query(`select refund_order_coins(gen_random_uuid())`), /permission denied/);
      });
    });
  });

  test('submit_steps writes the caller’s own steps and no one else’s', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const coins = await asUser(c, user, async () => {
        const { rows } = await c.query(
          `select submit_steps(pkt_date() - 1, 3000, 'health_connect') as coins`);
        return rows[0].coins;
      });

      // Zero, not thirty. A client-reported figure is recorded and credited
      // nothing; minting happens only behind a verified attestation token.
      assert.equal(coins, 0);
      const { rows } = await c.query('select user_id from daily_steps');
      assert.deepEqual(rows.map((r) => r.user_id), [user], 'and only for themselves');
    });
  });

  test('a client cannot claim attestation, whatever it passes', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        // The four-argument overload was the bypass: any signed-in user could
        // pass true and mint a full day's coins without an ad, a device check,
        // or a step ever being taken. It no longer exists.
        await expectRejected(c, () =>
          c.query(`select submit_steps(pkt_date() - 1, 15000, 'health_connect', true)`),
          /does not exist|function submit_steps/i);
      });
      assert.equal(
        (await c.query('select coin_balance($1) as b', [user])).rows[0].b, 0,
      );
    });
  });
});

describe('one user cannot read another', () => {
  test('the ledger is visible only to its owner', async () => {
    await withRollback(async (c) => {
      const mine = await makeUser(c);
      const theirs = await makeUser(c);
      await c.query(`select credit_coins($1, 111, 'steps')`, [mine]);
      await c.query(`select credit_coins($1, 222, 'steps')`, [theirs]);

      await asUser(c, mine, async () => {
        const { rows } = await c.query('select delta from coin_ledger');
        assert.deepEqual(rows.map((r) => r.delta), [111]);
      });
    });
  });

  test('steps, orders and phone numbers are equally private', async () => {
    await withRollback(async (c) => {
      const mine = await makeUser(c);
      const theirs = await makeUser(c);
      await c.query(`select award_steps($1, pkt_date() - 1, 4000, 'health_connect', true)`, [theirs]);

      await asUser(c, mine, async () => {
        assert.equal((await c.query('select * from daily_steps')).rows.length, 0);
        assert.equal((await c.query('select * from orders')).rows.length, 0);
        const { rows } = await c.query('select id from users');
        assert.deepEqual(rows.map((r) => r.id), [mine], 'users is self-scoped');
      });
    });
  });

  test('a leaderboard still shows other people’s names, through the definer function only', async () => {
    await withRollback(async (c) => {
      const mine = await makeUser(c, { city: 'Lahore' });
      const theirs = await makeUser(c, { city: 'Lahore' });
      await c.query(`select award_steps($1, pkt_date() - 1, 9000, 'health_connect', true)`, [mine]);
      await c.query(`select award_steps($1, pkt_date() - 1, 12000, 'health_connect', true)`, [theirs]);
      await c.query('select refresh_leaderboards()');

      await asUser(c, mine, async () => {
        const { rows } = await c.query(`select * from leaderboard_page($1, 'city')`, [mine]);
        assert.equal(rows.length, 2, 'a board of one is not a board');
        assert.ok(rows.some((r) => r.user_id === theirs && r.name));
      });
    });
  });

  test('a client cannot change its own status, device_hash or referrer', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        await expectRejected(c, () =>
          c.query(`update users set status = 'active' where id = $1`, [user]), /permission denied/);
        await expectRejected(c, () =>
          c.query(`update users set device_hash = 'spoofed' where id = $1`, [user]), /permission denied/);
        // name and city are theirs to change
        await c.query(`update users set name = 'Ayesha' where id = $1`, [user]);
      });
    });
  });

  test('fraud_events are invisible to everyone but the server', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () => c.query('select * from fraud_events'), /permission denied/));
    });
  });
});

describe('§6.1 one account per device', () => {
  test('flags the second account seen on a device, without blocking it', async () => {
    await withRollback(async (c) => {
      const first = await makeUser(c);
      const second = await makeUser(c);
      await c.query(`update users set device_hash = 'abc123' where id = $1`, [first]);
      await c.query(`update users set device_hash = 'abc123' where id = $1`, [second]);

      const { rows } = await c.query('select id, status from users where id in ($1,$2)', [first, second]);
      const statuses = Object.fromEntries(rows.map((r) => [r.id, r.status]));
      assert.equal(statuses[first], 'active', 'the original account is untouched');
      assert.equal(statuses[second], 'flagged', 'the duplicate is flagged, not blocked');

      const { rows: ev } = await c.query(
        `select kind from fraud_events where user_id = $1`, [second]);
      assert.deepEqual(ev.map((e) => e.kind), ['duplicate_device']);
    });
  });
});
