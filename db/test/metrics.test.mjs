// docs/METRICS.md §1.2 and §1.3 — the gates, and the rule that stops Phase 2.
//
// These thresholds are the only thing in the project that tells the human to
// stop building. If they compute wrongly, they will say "green" on a product
// nobody uses, which is the single most expensive possible bug here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, makeUser, asUser, expectRejected } from './helpers.mjs';

/**
 * Seeds a cohort in bulk: `size` users installing `daysAgo` ago, of whom some
 * come back on D1, D7 and D30.
 *
 * Set-based on purpose — a 300-user cohort one round-trip at a time takes long
 * enough to time the suite out, and §1.1 asks for a 300-install sample, so the
 * realistic case is the one that has to be fast.
 */
async function seedCohort(c, {
  size, daysAgo = 40, returnOnD1 = 0, returnOnD7 = 0, returnOnD30 = 0,
  joinedTeam = 0, invitesEach = 0, permissionGranted = null, sessionSeconds = 60,
  // How many users open the app regularly, and how often. The band tests use
  // the exact returnOnDn counts; the realistic pass/fail test uses this.
  habitualUsers = 0, opensEveryDays = 1,
}) {
  const { rows } = await c.query(
    `with created as (
       insert into auth.users (phone)
       select '+92' || lpad((floor(random() * 1e9)::bigint + g)::text, 10, '0')
       from generate_series(1, $1::int) g
       returning id
     ),
     numbered as (select id, row_number() over () - 1 as n from created)
     insert into users (id, phone, name, city, created_at)
     select n.id, '+92' || lpad((900000000 + n.n)::text, 10, '0'),
            'User ' || n.n, 'Lahore', now() - make_interval(days => $2::int + 1)
     from numbered n
     returning id`,
    [size, daysAgo],
  );
  const users = rows.map((r) => r.id);

  // first_open, and two app_opens `sessionSeconds` apart in one session.
  await c.query(
    `insert into analytics_events (user_id, session_id, name, platform, occurred_at)
     select u.id, s.sid, x.name, 'android',
            now() - make_interval(days => $2::int) + x.at_offset
     from unnest($1::uuid[]) with ordinality as u(id, n)
     cross join lateral (select gen_random_uuid() as sid) s
     cross join lateral (values
       ('first_open', interval '0 seconds'),
       ('app_open',   interval '0 seconds'),
       ('app_open',   make_interval(secs => $3::int))
     ) as x(name, at_offset)`,
    [users, daysAgo, sessionSeconds],
  );

  for (const [day, count] of [[1, returnOnD1], [7, returnOnD7], [30, returnOnD30]]) {
    if (count > 0 && daysAgo >= day) {
      // Two events per return visit. A single-event session has zero duration
      // by definition, and seeding those would drag the median to zero and
      // report a red gate that the data does not support.
      await c.query(
        `insert into analytics_events (user_id, session_id, name, platform, occurred_at)
         select u.id, s.sid, 'app_open', 'android',
                now() - make_interval(days => $2::int) + make_interval(days => $3::int)
                      + x.at_offset
         from unnest($1::uuid[]) with ordinality as u(id, n)
         cross join lateral (select gen_random_uuid() as sid) s
         cross join lateral (values (interval '0 seconds'),
                                    (make_interval(secs => $5::int))) as x(at_offset)
         where u.n <= $4::int`,
        [users, daysAgo, day, count, sessionSeconds],
      );
    }
  }

  if (habitualUsers > 0) {
    // A regular user, opening every few days from install until now. This is
    // what a passing cohort actually looks like, and it is what makes
    // sessions-per-week a meaningful number rather than an artefact of two
    // isolated visits.
    await c.query(
      `insert into analytics_events (user_id, session_id, name, platform, occurred_at)
       select u.id, s.sid, 'app_open', 'android',
              now() - make_interval(days => $2::int) + make_interval(days => d.d) + x.at_offset
       from unnest($1::uuid[]) with ordinality as u(id, n)
       cross join generate_series(1, $2::int, $4::int) as d(d)
       cross join lateral (select gen_random_uuid() as sid) s
       cross join lateral (values (interval '0 seconds'),
                                  (make_interval(secs => $5::int))) as x(at_offset)
       where u.n <= $3::int`,
      [users, daysAgo, habitualUsers, opensEveryDays, sessionSeconds],
    );
  }

  if (joinedTeam > 0) {
    await c.query(
      `insert into analytics_events (user_id, session_id, name, platform)
       select u.id, gen_random_uuid(), 'team_joined', 'android'
       from unnest($1::uuid[]) with ordinality as u(id, n) where u.n <= $2::int`,
      [users, joinedTeam],
    );
  }

  if (invitesEach > 0) {
    await c.query(
      `insert into analytics_events (user_id, session_id, name, platform)
       select u.id, gen_random_uuid(), 'team_invite_shared', 'android'
       from unnest($1::uuid[]) as u(id), generate_series(1, $2::int)`,
      [users, invitesEach],
    );
  }

  if (permissionGranted !== null) {
    await c.query(
      `insert into analytics_events (user_id, session_id, name, platform)
       select u.id, gen_random_uuid(),
              case when u.n <= $2::int then 'health_permission_granted'
                   else 'health_permission_denied' end,
              'android'
       from unnest($1::uuid[]) with ordinality as u(id, n)`,
      [users, permissionGranted],
    );
  }

  return users;
}

const gates = async (c) =>
  Object.fromEntries(
    (await c.query('select metric, value, verdict from phase1_gates()')).rows
      .map((r) => [r.metric, { value: Number(r.value), verdict: r.verdict }]),
  );

describe('§1.2 the gates compute what they claim', () => {
  test('D1 retention counts app-opens, not installs', async () => {
    await withRollback(async (c) => {
      // 10 install, 4 come back on day 1 → 40%, which is green (≥35).
      await seedCohort(c, { size: 10, daysAgo: 40, returnOnD1: 4 });
      const g = await gates(c);
      assert.equal(g.d1_open_retention_pct.value, 40);
      assert.equal(g.d1_open_retention_pct.verdict, 'green');
    });
  });

  test('background sync does not count as retention', async () => {
    await withRollback(async (c) => {
      const [user] = await seedCohort(c, { size: 1, daysAgo: 40, returnOnD1: 0 });
      // A steps_synced every day for a month, and never a foreground open.
      await c.query(
        `insert into analytics_events (user_id, session_id, name, platform, occurred_at)
         select $1, gen_random_uuid(), 'steps_synced', 'android',
                now() - make_interval(days => g)
         from generate_series(1, 30) g`, [user]);

      const g = await gates(c);
      assert.equal(g.d1_open_retention_pct.value, 0,
        'a step app syncs whether or not anyone looks at it (§1.2)');
    });
  });

  test('team join rate is measured against installs', async () => {
    await withRollback(async (c) => {
      await seedCohort(c, { size: 20, joinedTeam: 3 });   // 15%
      const g = await gates(c);
      assert.equal(g.team_join_rate_pct.value, 15);
      assert.equal(g.team_join_rate_pct.verdict, 'amber');
    });
  });

  test('health permission rate is granted over granted-plus-denied', async () => {
    await withRollback(async (c) => {
      await seedCohort(c, { size: 10, permissionGranted: 8 });
      const g = await gates(c);
      assert.equal(g.health_permission_pct.value, 80);
      assert.equal(g.health_permission_pct.verdict, 'green');
    });
  });

  test('each gate lands in the right band', async () => {
    await withRollback(async (c) => {
      await seedCohort(c, {
        size: 20, daysAgo: 40,
        returnOnD1: 3,      // 15% -> red   (< 20)
        returnOnD7: 5,      // 25% -> green (>= 18)
        joinedTeam: 4,      // 20% -> amber (12..25)
      });
      const g = await gates(c);
      assert.equal(g.d1_open_retention_pct.verdict, 'red');
      assert.equal(g.d7_open_retention_pct.verdict, 'green');
      assert.equal(g.team_join_rate_pct.verdict, 'amber');
    });
  });
});

describe('§1.3 the stop rule', () => {
  test('holds Phase 2 shut below the minimum sample, whatever the rates look like', async () => {
    await withRollback(async (c) => {
      // Perfect numbers, 20 users. §1.1 asks for 300.
      await seedCohort(c, {
        size: 20, daysAgo: 40, returnOnD1: 20, returnOnD7: 20, returnOnD30: 20,
        joinedTeam: 20, invitesEach: 1, permissionGranted: 20,
      });
      const { rows } = await c.query('select * from phase2_is_unlocked()');
      assert.equal(rows[0].unlocked, false);
      assert.match(rows[0].reason, /Not enough sample/);
    });
  });

  test('a red on D7 alone stops Phase 2', async () => {
    await withRollback(async (c) => {
      await seedCohort(c, {
        size: 300, daysAgo: 40,
        returnOnD1: 150,   // 50% green
        returnOnD7: 15,    //  5% RED
        returnOnD30: 30,   // 10% green
        joinedTeam: 200, invitesEach: 1, permissionGranted: 280,
      });
      const { rows } = await c.query('select * from phase2_is_unlocked()');
      assert.equal(rows[0].unlocked, false);
      assert.match(rows[0].reason, /D7 open retention is red/);
    });
  });

  test('two reds anywhere stop Phase 2', async () => {
    await withRollback(async (c) => {
      await seedCohort(c, {
        size: 300, daysAgo: 40,
        returnOnD1: 150, returnOnD7: 90, returnOnD30: 45,
        joinedTeam: 20,           //  6.7% RED
        invitesEach: 0,           //  0   RED
        permissionGranted: 280,
      });
      const { rows } = await c.query('select * from phase2_is_unlocked()');
      assert.equal(rows[0].unlocked, false);
      assert.match(rows[0].reason, /gates are red/);
    });
  });

  test('unlocks only when the sample is there and the loop holds', async () => {
    await withRollback(async (c) => {
      // 300 installs, of whom 60 became regulars opening every other day for
      // forty days. That is what a green cohort looks like.
      await seedCohort(c, {
        size: 300, daysAgo: 40,
        habitualUsers: 60, opensEveryDays: 2,
        returnOnD1: 150, returnOnD7: 90, returnOnD30: 45,
        joinedTeam: 200, invitesEach: 1, permissionGranted: 280,
        sessionSeconds: 90,
      });
      const { rows } = await c.query('select * from phase2_is_unlocked()');
      assert.equal(rows[0].unlocked, true, 'good numbers on a real sample should pass');
    });
  });
});

describe('§2 the event vocabulary is closed', () => {
  test('REJECTS an event name that is not in the spec', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await expectRejected(c, () =>
        c.query(
          `insert into analytics_events (user_id, session_id, name)
           values ($1, gen_random_uuid(), 'coins_earned')`, [user]),
        /known_event/);
    });
  });

  test('a client can write its own events and read none of them', async () => {
    await withRollback(async (c) => {
      const me = await makeUser(c);
      const them = await makeUser(c);
      await c.query(
        `insert into analytics_events (user_id, session_id, name)
         values ($1, gen_random_uuid(), 'app_open')`, [them]);

      await asUser(c, me, async () => {
        await c.query(
          `insert into analytics_events (user_id, session_id, name)
           values ($1, gen_random_uuid(), 'app_open')`, [me]);

        await expectRejected(c, () =>
          c.query(`insert into analytics_events (user_id, session_id, name)
                   values ($1, gen_random_uuid(), 'app_open')`, [them]),
          /row-level security/);

        // Not "returns nothing" — there is no SELECT grant at all, so the read
        // is refused outright. Stronger than an RLS filter, and it means a
        // future policy mistake cannot open it by accident.
        await expectRejected(c, () =>
          c.query('select count(*) from analytics_events'),
          /permission denied/);
      });
    });
  });
});
