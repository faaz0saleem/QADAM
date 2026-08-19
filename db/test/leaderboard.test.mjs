// §7.3 — four scopes, a weekly reset, and a rank the user can always see.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser } from './helpers.mjs';

async function walk(c, user, steps, daysAgo = 1, attested = true) {
  await c.query(
    `select award_steps($1, pkt_date() - $2::int, $3, 'health_connect', $4)`,
    [user, daysAgo, steps, attested],
  );
}

const board = async (c, user, scope) =>
  (await c.query(`select * from leaderboard_page($1, $2)`, [user, scope])).rows;

describe('§7.3 scopes', () => {
  test('ranks all of Pakistan, a city and a team from one refresh', async () => {
    await withRollback(async (c) => {
      const lahore1 = await makeUser(c, { city: 'Lahore' });
      const lahore2 = await makeUser(c, { city: 'Lahore' });
      const karachi = await makeUser(c, { city: 'Karachi' });

      await walk(c, lahore1, 8000);
      await walk(c, lahore2, 12000);
      await walk(c, karachi, 15000);

      const { rows: t } = await c.query(
        `insert into teams (name, city, captain_id) values ('Office', 'Lahore', $1) returning id`,
        [lahore1],
      );
      await c.query('insert into team_members (team_id, user_id) values ($1, $2)', [t[0].id, lahore2]);

      await c.query('select refresh_leaderboards()');

      const pk = await board(c, lahore1, 'pakistan');
      assert.deepEqual(pk.map((r) => r.user_id), [karachi, lahore2, lahore1]);
      assert.deepEqual(pk.map((r) => r.rank), [1, 2, 3]);

      const city = await board(c, lahore1, 'city');
      assert.deepEqual(city.map((r) => r.user_id), [lahore2, lahore1], 'Karachi does not belong on a Lahore board');

      const team = await board(c, lahore1, 'team');
      assert.deepEqual(team.map((r) => r.user_id), [lahore2, lahore1]);
    });
  });

  test('ranks a friends circle on read, including the user themselves', async () => {
    await withRollback(async (c) => {
      const me = await makeUser(c);
      const friend = await makeUser(c);
      const stranger = await makeUser(c);
      await walk(c, me, 6000);
      await walk(c, friend, 9000);
      await walk(c, stranger, 14000);
      await c.query(
        `insert into friendships (user_id, friend_id, status) values ($1, $2, 'accepted')`,
        [me, friend],
      );

      const { rows } = await c.query('select * from leaderboard_friends($1)', [me]);
      assert.deepEqual(rows.map((r) => r.user_id), [friend, me]);
      assert.ok(rows.find((r) => r.is_me).user_id === me);
    });
  });
});

describe('§7.3 only attested steps rank', () => {
  test('excludes uncredited steps from the board but keeps them in the user’s own total', async () => {
    await withRollback(async (c) => {
      const honest = await makeUser(c, { city: 'Lahore' });
      const faker = await makeUser(c, { city: 'Lahore' });
      await walk(c, honest, 9000, 1, true);
      await walk(c, faker, 14000, 1, false);   // unattested

      await c.query('select refresh_leaderboards()');
      const rows = await board(c, honest, 'city');
      assert.deepEqual(rows.map((r) => r.user_id), [honest], 'unattested steps must not rank');

      const { rows: own } = await c.query(
        'select raw_steps from daily_steps where user_id = $1', [faker],
      );
      assert.equal(own[0].raw_steps, 14000, 'but the user still sees their own steps');
    });
  });

  test('leaves a suspended account off the board entirely', async () => {
    await withRollback(async (c) => {
      const ok = await makeUser(c, { city: 'Multan' });
      const banned = await makeUser(c, { city: 'Multan' });
      await walk(c, ok, 5000);
      await walk(c, banned, 15000);
      await c.query(`update users set status = 'suspended' where id = $1`, [banned]);

      await c.query('select refresh_leaderboards()');
      const rows = await board(c, ok, 'city');
      assert.deepEqual(rows.map((r) => r.user_id), [ok]);
    });
  });
});

describe('§7.3 the weekly reset', () => {
  test('a week starts on Monday, Pakistan time', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select to_char(pkt_week_start('2026-08-20T09:00:00Z'::timestamptz), 'YYYY-MM-DD Dy') as w`,
      );
      assert.equal(rows[0].w, '2026-08-17 Mon');
    });
  });

  test('last week’s steps do not carry into this week’s board, but do into all-time', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { city: 'Quetta', ageDays: 60 });
      // 10 days ago is last week and outside the backfill window, so write it directly.
      await c.query(
        `insert into daily_steps (user_id, date, raw_steps, credited_steps, coins_awarded, source, attested)
         values ($1, pkt_date() - 10, 20000, 15000, 150, 'health_connect', true)`,
        [user],
      );
      await walk(c, user, 3000);   // this week

      await c.query('select refresh_leaderboards()');

      const thisWeek = await board(c, user, 'city');
      assert.equal(Number(thisWeek[0].steps), 3000);

      const { rows: allTime } = await c.query(
        `select * from leaderboard_page($1, 'city', 'all')`, [user],
      );
      assert.equal(Number(allTime[0].steps), 18000);
    });
  });

  test('a refresh can be run twice without duplicating a board', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c, { city: 'Sialkot' });
      await walk(c, user, 7000);
      await c.query('select refresh_leaderboards()');
      await c.query('select refresh_leaderboards()');
      const rows = await board(c, user, 'city');
      assert.equal(rows.length, 1, 'a cron running every 15 minutes must be idempotent');
    });
  });
});

describe('§7.3 the user always sees their own rank', () => {
  test('pins a user outside the top of the board and gives them a percentile', async () => {
    await withRollback(async (c) => {
      const city = 'Faisalabad';
      const users = [];
      for (let i = 0; i < 12; i += 1) {
        const u = await makeUser(c, { city });
        await walk(c, u, 1000 + i * 500);
        users.push(u);
      }
      const slowest = users[0];
      await c.query('select refresh_leaderboards()');

      const { rows } = await c.query(
        `select * from leaderboard_page($1, 'city', null, 5)`, [slowest],
      );
      assert.equal(rows.length, 6, 'five ranked rows plus the pinned self row');
      assert.equal(rows[5].user_id, slowest);
      assert.equal(rows[5].pinned, true);
      assert.equal(rows[5].rank, 12);
      assert.equal(rows[5].percentile, 100, 'last of twelve is the 100th percentile');
    });
  });

  test('does not duplicate the user when they are already in the top', async () => {
    await withRollback(async (c) => {
      const city = 'Peshawar';
      const leader = await makeUser(c, { city });
      await walk(c, leader, 14000);
      for (let i = 0; i < 3; i += 1) {
        await walk(c, await makeUser(c, { city }), 1000 + i * 100);
      }
      await c.query('select refresh_leaderboards()');
      const rows = await board(c, leader, 'city');
      assert.equal(rows.filter((r) => r.user_id === leader).length, 1);
      assert.equal(rows[0].percentile, 25, 'first of four is the top 25%');
    });
  });
});

describe('§1, §7.3 — nobody can stake anything on a contest', () => {
  test('a challenge prize can only be coins or a voucher, never cash', async () => {
    await withRollback(async (c) => {
      await expectRejected(c, () =>
        c.query(
          `insert into challenges (title, scope, starts_at, ends_at, prize_type, prize_value, prize_funded_by)
           values ('Cash dash', 'city', now(), now() + interval '7 days', 'cash', 5000, 'house')`),
        /prize_type_check/);
    });
  });

  test('a prize can only be funded by the house or a named sponsor', async () => {
    await withRollback(async (c) => {
      await expectRejected(c, () =>
        c.query(
          `insert into challenges (title, scope, starts_at, ends_at, prize_type, prize_value, prize_funded_by)
           values ('Pool', 'city', now(), now() + interval '7 days', 'coins', 5000, 'entry_fees')`),
        /prize_funded_by_check/);

      await c.query(
        `insert into challenges (title, scope, starts_at, ends_at, prize_type, prize_value,
                                 prize_funded_by, sponsor_name)
         values ('Sponsored', 'city', now(), now() + interval '7 days', 'voucher', 5000,
                 'sponsor', 'A Brand')`);
    });
  });
});

describe('§7.6 teams', () => {
  test('adds the captain automatically and issues a readable invite code', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const { rows } = await c.query(
        `insert into teams (name, city, captain_id) values ('Gulberg Walkers', 'Lahore', $1)
         returning id, invite_code`, [captain],
      );
      assert.match(rows[0].invite_code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
        'no O/0 or I/1/L — codes get read aloud and typed by hand');
      const { rows: m } = await c.query(
        'select user_id from team_members where team_id = $1', [rows[0].id]);
      assert.deepEqual(m.map((r) => r.user_id), [captain]);
    });
  });

  test('caps a team at 30 members (§7.6)', async () => {
    await withRollback(async (c) => {
      const captain = await makeUser(c);
      const { rows } = await c.query(
        `insert into teams (name, captain_id) values ('Big', $1) returning id`, [captain]);
      for (let i = 0; i < 29; i += 1) {
        await c.query('insert into team_members (team_id, user_id) values ($1, $2)',
          [rows[0].id, await makeUser(c)]);
      }
      await expectRejected(c, async () =>
        c.query('insert into team_members (team_id, user_id) values ($1, $2)',
          [rows[0].id, await makeUser(c)]),
        /is full/);
    });
  });
});
