// §6.1, §7.1 — the server decides everything.
//
// The client reports a raw step count and nothing else. These tests call
// award_steps directly, which is the closest an attacker could ever get to the
// coin logic, and show that none of the §6.1 rules can be talked out of.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, asUser } from './helpers.mjs';

const today = async (c) => (await c.query('select pkt_date() as d')).rows[0].d;
const yesterday = async (c) => (await c.query('select pkt_date() - 1 as d')).rows[0].d;

const submit = async (c, user, date, raw, opts = {}) => {
  const { rows } = await c.query(
    `select award_steps($1, $2, $3, $4, $5, $6) as coins`,
    [user, date, raw, opts.source ?? 'health_connect', opts.attested ?? true, opts.flags ?? []],
  );
  return rows[0].coins;
};

const dayRow = async (c, user, date) =>
  (await c.query('select * from daily_steps where user_id = $1 and date = $2', [user, date])).rows[0];

const balance = async (c, user) =>
  (await c.query('select coin_balance($1) as b', [user])).rows[0].b;

const fraudKinds = async (c, user) =>
  (await c.query('select kind from fraud_events where user_id = $1 order by kind', [user]))
    .rows.map((r) => r.kind);

describe('§4 the earning rate', () => {
  test('1,000 steps mints exactly 10 coins on day one — the promise we keep forever', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const coins = await submit(c, user, await today(c), 1000);
      assert.equal(coins, 10);
      assert.equal(await balance(c, user), 10);
    });
  });

  test('coins carry the configured expiry, not a hardcoded one', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await submit(c, user, await today(c), 5000);
      const { rows } = await c.query(
        `select (expires_at - date_trunc('day', now()))::text as life
         from coin_ledger where user_id = $1`, [user],
      );
      assert.match(rows[0].life, /^90 days/);
    });
  });
});

describe('§6.1 attestation', () => {
  test('a rooted emulator submitting 500,000 steps earns ZERO coins (§12)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      const coins = await submit(c, user, day, 500000, {
        attested: false,
        flags: ['emulator', 'rooted'],
      });

      assert.equal(coins, 0, 'an unattested submission must never mint a coin');
      assert.equal(await balance(c, user), 0);

      const row = await dayRow(c, user, day);
      assert.equal(row.credited_steps, 0);
      assert.equal(row.attested, false);

      const kinds = await fraudKinds(c, user);
      assert.ok(kinds.includes('unattested_submission'));
      assert.ok(kinds.includes('emulator'));
      assert.ok(kinds.includes('rooted'));
    });
  });

  test('the caller is told nothing about which check it failed', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      // An honest zero-step day and a rejected fraud attempt are indistinguishable
      // from the outside: both simply return 0.
      const honest = await submit(c, user, await today(c), 0, { attested: true });
      const fraud = await submit(c, await makeUser(c), await today(c), 90000, { attested: false });
      assert.equal(honest, fraud);
    });
  });

  test('still records what the device claimed, so the user keeps their own total (§7.3)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      await submit(c, user, day, 12000, { attested: false });
      const row = await dayRow(c, user, day);
      assert.equal(row.raw_steps, 12000, 'the user should still see their steps');
      assert.equal(row.credited_steps, 0, 'but none of them rank or earn');
    });
  });
});

describe('§6.1 the daily cap', () => {
  test('credits at most DAILY_STEP_CAP however much is submitted', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      const coins = await submit(c, user, day, 60000);
      const row = await dayRow(c, user, day);
      assert.equal(row.credited_steps, 15000);
      assert.equal(coins, 150);
      assert.ok(row.flags.includes('daily_cap'));
    });
  });

  test('reads the cap from app_config rather than a literal', async () => {
    await withRollback(async (c) => {
      await c.query(`update app_config set value = 8000 where key = 'DAILY_STEP_CAP'`);
      const user = await makeUser(c);
      const day = await yesterday(c);
      await submit(c, user, day, 60000);
      assert.equal((await dayRow(c, user, day)).credited_steps, 8000);
    });
  });
});

describe('§6.1 backfill and the rate ceiling', () => {
  test('refuses step data older than the backfill window', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const { rows } = await c.query('select pkt_date() - 5 as d');
      const coins = await submit(c, user, rows[0].d, 9000);
      assert.equal(coins, 0);
      assert.equal(await dayRow(c, user, rows[0].d), undefined, 'no row should be written at all');
      assert.ok((await fraudKinds(c, user)).includes('stale_backfill'));
    });
  });

  test('REJECTS a future-dated submission outright', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const { rows } = await c.query('select pkt_date() + 1 as d');
      await expectRejected(c, () => submit(c, user, rows[0].d, 1000), /in the future/);
    });
  });

  test('clamps anything implying more than 200 steps a minute', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await today(c);
      await submit(c, user, day, 1000);
      await submit(c, user, day, 400000);   // more steps than the day has had minutes
      const row = await dayRow(c, user, day);

      assert.ok(row.raw_steps < 400000, 'the impossible portion must not stick');
      assert.ok(row.raw_steps <= 288000, 'a full day allows at most 1440 x 200');
      assert.ok(row.credited_steps <= 15000, 'and the daily cap still binds');
      assert.ok(row.flags.includes('rate_clamped'));
      assert.ok((await fraudKinds(c, user)).includes('rate_ceiling'));
    });
  });

  test('leaves a batched Health Connect delivery alone — a big jump between syncs is normal', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);   // a full day of elapsed time to draw on
      const coins = await submit(c, user, day, 12000);
      assert.equal((await dayRow(c, user, day)).credited_steps, 12000);
      assert.equal(coins, 120);
    });
  });
});

describe('§7.1 resubmission', () => {
  test('tops up rather than double-crediting when a day is submitted again', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      assert.equal(await submit(c, user, day, 5000), 50);
      assert.equal(await submit(c, user, day, 8000), 30, 'only the difference should be minted');
      assert.equal(await balance(c, user), 80);
      assert.equal((await dayRow(c, user, day)).coins_awarded, 80);
    });
  });

  test('is idempotent when the same total arrives twice', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      await submit(c, user, day, 7000);
      assert.equal(await submit(c, user, day, 7000), 0);
      assert.equal(await balance(c, user), 70);
    });
  });

  test('keeps the higher total when a device reports a lower one', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const day = await yesterday(c);
      await submit(c, user, day, 9000);
      await submit(c, user, day, 2000);   // reinstall, clock change, or a lie
      const row = await dayRow(c, user, day);
      assert.equal(row.raw_steps, 9000);
      assert.equal(await balance(c, user), 90);
      assert.ok(row.flags.includes('raw_regressed'));
    });
  });
});

describe('§4 streaks', () => {
  test('a 30-day streak reaches the configured maximum multiplier', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 60 });
      // 29 qualifying days behind us, written straight to the table.
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         select $1, pkt_date() - g, 9000, 9000, 90, 'health_connect', true
         from generate_series(1, 29) g`,
        [user],
      );
      const coins = await submit(c, user, await today(c), 10000);
      const { rows } = await c.query('select current_streak($1) as s', [user]);
      assert.equal(rows[0].s, 30);
      assert.equal(coins, 150, '10,000 steps at a 30-day streak should mint 100 x 1.5');
    });
  });

  test('a broken streak resets to the day-one rate', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 60 });
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         select $1, pkt_date() - g, 9000, 9000, 90, 'health_connect', true
         from generate_series(3, 20) g`,   // a two-day gap
        [user],
      );
      assert.equal(await submit(c, user, await today(c), 10000), 100);
    });
  });

  test('does not break at midnight before the user has had a chance to walk', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { ageDays: 30 });
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         select $1, pkt_date() - g, 9000, 9000, 90, 'health_connect', true
         from generate_series(1, 5) g`,
        [user],
      );
      const { rows } = await c.query('select current_streak($1) as s', [user]);
      assert.equal(rows[0].s, 5, 'yesterday must still hold the streak open');
    });
  });
});

describe('§13.2 the client cannot price its own steps', () => {
  test('submit_steps takes no coin, balance or discount argument', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'submit_steps'`,
      );
      assert.doesNotMatch(rows[0].args, /coin|balance|discount|multiplier|reward/i);
    });
  });

  test('a suspended account keeps its history and earns nothing', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { status: 'suspended' });
      const day = await yesterday(c);
      assert.equal(await submit(c, user, day, 10000), 0);
      assert.equal((await dayRow(c, user, day)).raw_steps, 10000);
      assert.equal(await balance(c, user), 0);
    });
  });
});

describe('§6.1 the client cannot claim its own attestation', () => {
  test('submit_steps has no attested argument at all', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_arguments(p.oid) as args from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'submit_steps'`,
      );
      assert.equal(rows.length, 1, 'exactly one overload — an old one would be a way back in');
      assert.doesNotMatch(rows[0].args, /attest|flag/i);
      assert.equal(rows[0].args, 'p_date date, p_raw integer, p_source text');
    });
  });

  test('steps sent by a client are recorded and credited nothing', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const { rows: day } = await c.query('select pkt_date() - 1 as d');

      const coins = await asUser(c, user, async () =>
        (await c.query(`select submit_steps($1, 12000, 'health_connect') as coins`, [day[0].d]))
          .rows[0].coins);

      assert.equal(coins, 0, 'a client-reported figure must never mint');
      const row = await dayRow(c, user, day[0].d);
      assert.equal(row.raw_steps, 12000, 'but the user still sees their own total (§7.3)');
      assert.equal(row.credited_steps, 0);
      assert.equal(await balance(c, user), 0);
    });
  });

  test('an attested submission later the same day tops the day up', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const { rows: day } = await c.query('select pkt_date() - 1 as d');

      // The offline queue lands here while the Edge Function is unreachable.
      await asUser(c, user, () =>
        c.query(`select submit_steps($1, 12000, 'health_connect')`, [day[0].d]));
      assert.equal(await balance(c, user), 0);

      // Then ingest-steps verifies a real token and calls award_steps.
      const coins = await submit(c, user, day[0].d, 12000, { attested: true });
      assert.equal(coins, 120, 'the queued steps become creditable, once');
      assert.equal(await balance(c, user), 120);
    });
  });
});
