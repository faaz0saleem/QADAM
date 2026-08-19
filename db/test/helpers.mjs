// Shared fixtures. Every test runs inside a transaction that is rolled back, so
// tests never see each other's rows and the scratch database stays clean.
import pg from 'pg';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is not set — run the suite with `npm test`');

// PKR is integer everywhere; make node-postgres hand back numbers, not strings.
pg.types.setTypeParser(20, (v) => Number(v)); // int8

export async function withRollback(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    await fn(c);
  } finally {
    try {
      await c.query('rollback');
    } catch {
      /* connection already unusable */
    }
    await c.end();
  }
}

/**
 * Forces every DEFERRED constraint trigger to run now, as COMMIT would, then
 * restores deferral.
 *
 * Restoring matters: SET CONSTRAINTS ALL IMMEDIATE lasts for the rest of the
 * transaction, and place_order legitimately writes an order header before its
 * items. Leaving constraints immediate would make the checkout path fail on a
 * check that is only ever meant to hold at COMMIT.
 */
export async function flushDeferred(c) {
  await c.query('set constraints all immediate');
  await c.query('set constraints all deferred');
}

let savepointSeq = 0;

/**
 * Asserts the database refuses whatever `run` attempts.
 *
 * Wrapped in a savepoint because a rejected statement aborts the surrounding
 * transaction, and most of these tests need to keep going afterwards to show
 * what the database DOES accept.
 */
export async function expectRejected(c, run, matcher) {
  const sp = `sp_${(savepointSeq += 1)}`;
  await c.query(`savepoint ${sp}`);

  let message = null;
  try {
    await run();
  } catch (err) {
    message = err.message;
  }
  await c.query(`rollback to savepoint ${sp}`);

  assert.ok(message !== null, 'expected the database to reject this, but it was accepted');
  if (matcher) {
    assert.match(message, matcher, `rejected, but not for the expected reason: ${message}`);
  }
  return message;
}

let seq = 0;
const uniq = () => `${Date.now()}${(seq += 1)}`;

// Unique per test process, so files running in parallel cannot collide.
const phonePrefix = String(process.pid % 1000).padStart(3, '0')
  + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
const nextPhone = () => `+92${phonePrefix}${String((seq += 1)).padStart(4, '0')}`;

export async function makeUser(c, { city = 'Lahore', ageDays = 30, status = 'active' } = {}) {
  const phone = nextPhone();
  const { rows } = await c.query(
    `with a as (insert into auth.users (phone) values ($1) returning id)
     insert into users (id, phone, name, city, status, created_at)
     select a.id, $1, $2, $3, $4, now() - make_interval(days => $5::int) from a
     returning id`,
    [phone, `User ${uniq()}`, city, status, ageDays],
  );
  return rows[0].id;
}

export async function makeProduct(c, { price, cost, stock = 100, coinEligible = true, source = 'owned' } = {}) {
  const { rows: cat } = await c.query(
    `insert into categories (name, coin_eligible) values ($1, $2) returning id`,
    [`Cat ${uniq()}`, coinEligible],
  );
  const { rows } = await c.query(
    `insert into products (title, category_id, price_pkr, cost_pkr, stock, source)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [`Product ${uniq()}`, cat[0].id, price, cost, stock, source],
  );
  return rows[0].id;
}

export async function makeOrder(c, userId, overrides = {}) {
  const o = {
    subtotal_pkr: 0,
    discount_pkr: 0,
    shipping_pkr: 0,
    total_pkr: 0,
    coins_spent: 0,
    coin_value_pkr: 0,
    payment_method: 'cod',
    ...overrides,
  };
  const { rows } = await c.query(
    `insert into orders (user_id, subtotal_pkr, discount_pkr, shipping_pkr, total_pkr,
                         coins_spent, coin_value_pkr, payment_method, address, phone)
     values ($1,$2,$3,$4,$5,$6,$7,$8, '{"line1":"1 Test St","city":"Lahore"}', '+923001234567')
     returning id`,
    [userId, o.subtotal_pkr, o.discount_pkr, o.shipping_pkr, o.total_pkr,
     o.coins_spent, o.coin_value_pkr, o.payment_method],
  );
  return rows[0].id;
}

export async function addItem(c, orderId, productId, { qty = 1, discount = 0, price, cost, coinEligible = true } = {}) {
  const { rows } = await c.query(
    `insert into order_items (order_id, product_id, qty, price_pkr, cost_pkr, discount_pkr, coin_eligible)
     select $1, p.id, $2, coalesce($4, p.price_pkr), coalesce($5, p.cost_pkr), $3, $6
     from products p where p.id = $7
     returning id`,
    [orderId, qty, discount, price ?? null, cost ?? null, coinEligible, productId],
  );
  return rows[0].id;
}

/**
 * Runs the body as if it were an authenticated PostgREST request from this user.
 *
 * Both the role AND the JWT claim are restored afterwards. Leaving the claim set
 * makes every later statement in the transaction look like it came from that
 * user, which quietly changes what assert_self and the RLS policies do — it can
 * fabricate a failure in an unrelated test, or hide a real one.
 */
export async function asUser(c, userId, fn) {
  const { rows } = await c.query(
    `select coalesce(current_setting('request.jwt.claim.sub', true), '') as previous`,
  );
  const previous = rows[0].previous;

  await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
  await c.query('set local role authenticated');
  try {
    return await fn();
  } finally {
    try {
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [previous]);
    } catch {
      /* transaction already aborted; the rollback will clear it */
    }
    // A failed statement leaves the transaction aborted, so this can throw. Let
    // the original error be the one that reaches the caller; a savepoint
    // rollback restores the role anyway, since SET LOCAL ROLE is transactional.
    try {
      await c.query('reset role');
    } catch {
      /* superseded by the error we are already propagating */
    }
  }
}
