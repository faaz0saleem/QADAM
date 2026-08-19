// §7.6 teams, §7.7 referrals, §7.8 rewarded video.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, asUser } from './helpers.mjs';

const balance = async (c, user) =>
  (await c.query('select coin_balance($1) as b', [user])).rows[0].b;

describe('§7.6 teams', () => {
  test('creating a team takes one call and returns a shareable code', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c, { city: 'Lahore' });
      const { code } = await asUser(c, captain, async () => {
        const { rows } = await c.query(`select * from create_team('Gulberg Walkers')`);
        return { code: rows[0].invite_code };
      });
      assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    });
  });

  test('a second user joins with only the code', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const joiner = await makeUser(c);
      const code = await asUser(c, captain, async () =>
        (await c.query(`select invite_code from create_team('Office')`)).rows[0].invite_code);

      await asUser(c, joiner, () => c.query('select join_team($1)', [code.toLowerCase()]));

      const { rows } = await c.query('select count(*)::int as n from team_members');
      assert.equal(rows[0].n, 2, 'lowercase and whitespace should not stop someone joining');
    });
  });

  test('REJECTS an unknown code without revealing anything', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () => c.query(`select join_team('ZZZZZZ')`), /no team with that code/));
    });
  });

  test('REJECTS a 31st member', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const code = await asUser(c, captain, async () =>
        (await c.query(`select invite_code from create_team('Big')`)).rows[0].invite_code);

      for (let i = 0; i < 29; i += 1) {
        const u = await makeUser(c);
        await asUser(c, u, () => c.query('select join_team($1)', [code]));
      }
      const spare = await makeUser(c);
      await asUser(c, spare, () =>
        expectRejected(c, () => c.query('select join_team($1)', [code]), /full/));
    });
  });

  test('a client cannot write the team tables directly any more', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, () =>
        expectRejected(c, () =>
          c.query(`insert into teams (name, captain_id) values ('Sneaky', $1)`, [user]),
          /permission denied/));
    });
  });

  test('the roster shows names and steps, never phone numbers', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const team = await asUser(c, captain, async () =>
        (await c.query(`select team_id from create_team('Walkers')`)).rows[0].team_id);
      await c.query(
        `select award_steps($1, pkt_date() - 1, 8000, 'health_connect', true)`, [captain]);

      const { rows, fields } = await c.query('select * from team_roster($1)', [team]);
      assert.equal(Number(rows[0].steps), 8000);
      assert.ok(rows[0].is_captain);
      assert.ok(!fields.some((f) => f.name === 'phone'));
    });
  });
});

describe('§7.8 rewarded video', () => {
  test('mints the configured coins and caps the day', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await asUser(c, user, async () => {
        for (let i = 0; i < 3; i += 1) {
          const { rows } = await c.query('select claim_rewarded_ad() as coins');
          assert.equal(rows[0].coins, 30);
        }
        await expectRejected(c, () => c.query('select claim_rewarded_ad()'), /all 3 videos today/);
      });
      assert.equal(await balance(c, user), 90, 'never more than the daily limit');
    });
  });

  test('the client cannot name its own reward', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_arguments(p.oid) as args from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'claim_rewarded_ad'`,
      );
      assert.equal(rows[0].args, '', 'it takes no arguments at all, by design');
    });
  });

  test('§13.5: no interstitial or banner surface exists anywhere', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname ~* 'interstitial|banner'`,
      );
      assert.deepEqual(rows, [], 'an ad surface outside rewarded video has appeared');
    });
  });
});

describe('§7.7 pending referrals', () => {
  test('shows a referee who has joined but not yet ordered', async () => {
    await withRollback(async (c) => {
      const referrer = await makeUser(c);
      const referee = await makeUser(c);
      await c.query(`update users set name = 'Ali', referred_by = $1 where id = $2`,
        [referrer, referee]);

      const rows = await asUser(c, referrer, async () =>
        (await c.query('select * from my_referrals()')).rows);

      assert.equal(rows.length, 1);
      assert.equal(rows[0].referee_name, 'Ali');
      assert.equal(rows[0].has_ordered, false, 'nothing is paid on install (§7.7)');
      assert.equal(rows[0].coins, 500);
    });
  });

  test('shows only your own referrals', async () => {
    await withRollback(async (c) => {
      const a = await makeUser(c);
      const b = await makeUser(c);
      const refereeOfB = await makeUser(c);
      await c.query('update users set referred_by = $1 where id = $2', [b, refereeOfB]);

      const rows = await asUser(c, a, async () =>
        (await c.query('select * from my_referrals()')).rows);
      assert.deepEqual(rows, []);
    });
  });
});

describe('signup', () => {
  test('creates a profile in the same transaction as the account', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `insert into auth.users (phone) values ('+923009998877') returning id`);
      const { rows: profile } = await c.query(
        'select phone, referral_code from users where id = $1', [rows[0].id]);
      assert.equal(profile.length, 1, 'a signed-in user must never lack a profile');
      assert.equal(profile[0].phone, '+923009998877');
      assert.match(profile[0].referral_code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    });
  });

  test('carries a referral through signup without paying anything', async () => {
    await withRollback(async (c) => {
      const referrer = await makeUser(c);
      const { rows: code } = await c.query(
        'select referral_code from users where id = $1', [referrer]);

      const { rows: created } = await c.query(
        `insert into auth.users (phone) values ('+923009998866') returning id`);
      // Simulate the metadata Supabase would carry from the signup call.
      await c.query(
        `update users set referred_by = (select id from users where referral_code = $1)
         where id = $2`, [code[0].referral_code, created[0].id]);

      const { rows: referee } = await c.query(
        'select referred_by from users where id = $1', [created[0].id]);
      assert.equal(referee[0].referred_by, referrer);
      assert.equal(await balance(c, referrer), 0, '§7.7: install pays nobody');
    });
  });

  test('a lowercase referral code still resolves', async () => {
    await withRollback(async (c) => {
      const referrer = await makeUser(c);
      const { rows: code } = await c.query(
        'select referral_code from users where id = $1', [referrer]);
      const { rows } = await c.query(
        `insert into auth.users (phone, raw_user_meta_data)
         values ('+923009998855', jsonb_build_object('referral_code', lower($1), 'name', 'Bilal'))
         returning id`, [code[0].referral_code]);
      const { rows: referee } = await c.query(
        'select referred_by, name from users where id = $1', [rows[0].id]);
      assert.equal(referee[0].referred_by, referrer);
      assert.equal(referee[0].name, 'Bilal');
    });
  });
});
