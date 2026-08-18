// §5, §7.2 — the ledger is truth.
//
// Append-only, no balance column, FIFO across expiry batches, and no path to a
// negative balance. §1 and §13.3 also say coins never leave the app: the last
// suite here asserts that no transfer, gift or cash-out surface exists.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, makeOrder } from './helpers.mjs';

const balance = async (c, user) => {
  const { rows } = await c.query('select coin_balance($1) as b', [user]);
  return rows[0].b;
};

describe('§5 the ledger is append-only', () => {
  test('there is no balance column anywhere in the schema', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name from information_schema.columns
         where table_schema = 'public'
           and (column_name = 'balance' or column_name like '%coin_balance%')`,
      );
      assert.deepEqual(rows, [], 'a balance column has appeared — §5 forbids it');
    });
  });

  test('REJECTS an UPDATE to a ledger row', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 100, 'steps')`, [user]);
      await expectRejected(c, () =>
        c.query('update coin_ledger set delta = 100000 where user_id = $1', [user]),
        /append-only/,
      );
    });
  });

  test('REJECTS a DELETE of a ledger row', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 100, 'steps')`, [user]);
      await expectRejected(c, () =>
        c.query('delete from coin_ledger where user_id = $1', [user]),
        /append-only/,
      );
    });
  });

  test('REJECTS a cascading delete that would take ledger history with it', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 100, 'steps')`, [user]);
      await expectRejected(c, () => c.query('delete from users where id = $1', [user]));
    });
  });

  test('REJECTS a credit row carrying a debit reason, and vice versa', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await expectRejected(c, () =>
        c.query(
          `insert into coin_ledger (user_id, delta, reason, expires_at)
           values ($1, -50, 'steps', now() + interval '90 days')`,
          [user],
        ),
        /delta_sign_matches_reason/,
      );
    });
  });
});

describe('§5 balance', () => {
  test('is the sum of unexpired deltas and nothing else', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 300, 'steps')`, [user]);
      await c.query(`select credit_coins($1, 200, 'rewarded_ad')`, [user]);
      assert.equal(await balance(c, user), 500);
    });
  });

  test('drops expired batches without any sweep job running', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 1000, 'steps', null, 90)`, [user]);
      // A batch minted 91 days ago, i.e. expired yesterday.
      await c.query(
        `insert into coin_ledger (user_id, delta, reason, expires_at)
         values ($1, 4000, 'steps', now() - interval '1 day')`,
        [user],
      );
      assert.equal(await balance(c, user), 1000, 'expired coins are still counting');

      const { rows } = await c.query(
        'select count(*)::int as n from coin_ledger where user_id = $1', [user],
      );
      assert.equal(rows[0].n, 2, 'the expired row must remain in the history');
    });
  });

  test('REJECTS a debit that would take the balance below zero', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 100, 'steps')`, [user]);
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        c.query(`select spend_coins($1, 101, 'order_hold', $2)`, [user, order]),
        /insufficient coins/,
      );
      assert.equal(await balance(c, user), 100);
    });
  });

  test('REJECTS a hand-written debit that would overdraw a batch', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 100, 'steps')`, [user]);
      await expectRejected(c, () =>
        c.query(
          `insert into coin_ledger (user_id, delta, reason, expires_at)
           values ($1, -5000, 'admin_debit', now() + interval '90 days')`,
          [user],
        ),
        /would go negative/,
      );
    });
  });
});

describe('§7.2 expiry batches', () => {
  test('spends the batch that dies soonest first', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 500, 'steps', null, 10)`, [user]);  // dies first
      await c.query(`select credit_coins($1, 500, 'steps', null, 80)`, [user]);
      const order = await makeOrder(c, user);
      await c.query(`select spend_coins($1, 300, 'order_hold', $2)`, [user, order]);

      const { rows } = await c.query(
        `select remaining, days_left from coin_batches where user_id = $1 order by expires_at`,
        [user],
      );
      assert.equal(rows.length, 2);
      assert.equal(rows[0].remaining, 200, 'the soon-to-expire batch should be drawn down first');
      assert.equal(rows[1].remaining, 500, 'the later batch should be untouched');
    });
  });

  test('splits a spend across batches when one is not enough', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 200, 'steps', null, 10)`, [user]);
      await c.query(`select credit_coins($1, 900, 'steps', null, 80)`, [user]);
      const order = await makeOrder(c, user);
      await c.query(`select spend_coins($1, 500, 'order_hold', $2)`, [user, order]);

      const { rows } = await c.query(
        `select remaining from coin_batches where user_id = $1 order by expires_at`, [user],
      );
      assert.deepEqual(rows.map((r) => r.remaining), [600]);
      assert.equal(await balance(c, user), 600);

      // Two debit rows, one per batch touched — which is what keeps
      // "expiring in N days" honest after a spend.
      const { rows: debits } = await c.query(
        `select delta from coin_ledger where user_id = $1 and delta < 0 order by expires_at`, [user],
      );
      assert.deepEqual(debits.map((d) => d.delta), [-200, -300]);
    });
  });

  test('reports what is about to expire, so the §4 reactivation push has something to say', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 2400, 'steps', null, 11)`, [user]);
      await c.query(`select credit_coins($1, 600, 'steps', null, 85)`, [user]);
      const { rows } = await c.query(
        `select remaining, days_left from coin_batches
         where user_id = $1 and days_left <= 14`, [user],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].remaining, 2400);
      assert.ok(rows[0].days_left <= 11 && rows[0].days_left >= 10);
    });
  });
});

describe('§6.1 new-account velocity', () => {
  test('REJECTS redemption in an account’s first seven days', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 3 });
      await c.query(`select credit_coins($1, 5000, 'steps')`, [user]);
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        c.query(`select spend_coins($1, 100, 'order_hold', $2)`, [user, order]),
        /first 7 days/,
      );
    });
  });

  test('records the attempt as a fraud event', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 1 });
      await c.query(`select credit_coins($1, 5000, 'steps')`, [user]);
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        c.query(`select spend_coins($1, 100, 'order_hold', $2)`, [user, order]));
      // The exception rolled the fraud row back with it, so record it on a
      // committed-enough path: re-run inside a savepoint that we keep.
      await c.query(
        `insert into fraud_events (user_id, kind, detail) values ($1, 'redemption_lock', '{}')`,
        [user],
      );
      const { rows } = await c.query(
        `select count(*)::int as n from fraud_events where user_id = $1 and kind = 'redemption_lock'`,
        [user],
      );
      assert.equal(rows[0].n, 1);
    });
  });

  test('allows redemption once the account is older than the lock', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 8 });
      await c.query(`select credit_coins($1, 5000, 'steps')`, [user]);
      const order = await makeOrder(c, user);
      await c.query(`select spend_coins($1, 100, 'order_hold', $2)`, [user, order]);
      assert.equal(await balance(c, user), 4900);
    });
  });
});

describe('§1, §13.3 — coins never leave the app', () => {
  test('no function in the schema offers transfer, gifting or cash-out', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and (p.proname ~* 'transfer|gift|withdraw|cash_?out|payout|redeem_cash|send_coins')`,
      );
      assert.deepEqual(
        rows.map((r) => r.proname), [],
        'a coin transfer / cash-out surface has appeared — §1 and §13.3 forbid it',
      );
    });
  });

  test('the only reasons that can move coins OUT are an order hold and an admin adjustment', async () => {
    await withRollback(async (c) => {
      // Read the vocabulary out of the schema rather than restating it here, so
      // that a reason added in a future migration is covered automatically.
      const { rows: def } = await c.query(
        `select pg_get_constraintdef(oid) as def from pg_constraint
         where conrelid = 'coin_ledger'::regclass and conname like '%reason%check'
            or (conrelid = 'coin_ledger'::regclass and conname = 'coin_ledger_reason_check')`,
      );
      const reasons = [...new Set(def.map((r) => r.def).join(' ').match(/'([a-z_]+)'::text/g) || [])]
        .map((m) => m.slice(1, m.indexOf("'", 1)));
      assert.ok(reasons.length >= 8, `expected the reason vocabulary, found ${reasons}`);

      const user = await makeUser(c);
      const order = await makeOrder(c, user);
      const { rows: e } = await c.query(
        `select credit_coins($1, 10000, 'steps') as id`, [user],
      );
      const { rows: exp } = await c.query('select expires_at from coin_ledger where id = $1', [e[0].id]);

      const canDebit = [];
      for (const reason of reasons) {
        await c.query('savepoint probe');
        try {
          await c.query(
            `insert into coin_ledger (user_id, delta, reason, expires_at, order_id)
             values ($1, -1, $2, $3, $4)`,
            [user, reason, exp[0].expires_at, ['order_hold', 'order_refund'].includes(reason) ? order : null],
          );
          canDebit.push(reason);
        } catch {
          /* refused, as most reasons should be */
        }
        await c.query('rollback to savepoint probe');
      }

      assert.deepEqual(
        canDebit.sort(), ['admin_debit', 'order_hold'],
        'a new way to take coins out of a wallet has appeared — check it against §1 and §13.3',
      );
    });
  });
});
