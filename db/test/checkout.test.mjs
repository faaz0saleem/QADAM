// §7.4, §7.5 — checkout, and the COD rule the business rests on.
//
// place_order runs as the authenticated user, so these tests go through
// auth.uid() exactly as a PostgREST call would.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, flushDeferred, asUser } from './helpers.mjs';

const balance = async (c, user) =>
  (await c.query('select coin_balance($1) as b', [user])).rows[0].b;

const order = async (c, id) =>
  (await c.query('select * from orders where id = $1', [id])).rows[0];

async function placeOrder(c, user, items, opts = {}) {
  return asUser(c, user, async () => {
    const { rows } = await c.query(
      `select place_order($1::jsonb, '{"line1":"1 Test St","city":"Lahore"}'::jsonb,
                          '+923001234567', $2, $3) as id`,
      [JSON.stringify(items), opts.payment ?? 'cod', opts.coins ?? 0],
    );
    return rows[0].id;
  });
}

describe('§7.4 checkout', () => {
  test('prices the basket from the catalogue, never from the client', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 2 }]);
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.subtotal_pkr, 6000);
      assert.equal(o.discount_pkr, 0);
      assert.equal(o.total_pkr, 6000);
    });
  });

  test('place_order takes no price, cost or discount argument (§13.2)', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select pg_get_function_arguments(p.oid) as args from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'place_order'`,
      );
      assert.doesNotMatch(rows[0].args, /price|cost|discount|total|subtotal/i);
      assert.match(rows[0].args, /p_coins integer/);
    });
  });

  test('converts coins to a discount at the server rate and caps it by §0', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });

      // 20,000 coins is PKR 600 at 0.03, but one shirt's §0 ceiling is 300.
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 20000 });
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.discount_pkr, 300, 'the §0 ceiling must bind, not the wallet');
      assert.equal(o.coins_spent, 10000, 'only the coins actually needed are debited');
      assert.equal(await balance(c, user), 10000, 'the rest stays in the wallet');
      assert.equal(o.total_pkr, 2700);
    });
  });

  test('spends only what the user actually has', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 1000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 99999 });
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.coins_spent, 1000);
      assert.equal(o.discount_pkr, 30);
      assert.equal(await balance(c, user), 0);
    });
  });

  test('refuses coins on an order below MIN_ORDER_FOR_COINS_PKR (§4)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const socks = await makeProduct(c, { price: 400, cost: 100 });
      const id = await placeOrder(c, user, [{ product_id: socks, qty: 1 }], { coins: 5000 });
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.coins_spent, 0);
      assert.equal(o.discount_pkr, 0);
      assert.equal(await balance(c, user), 20000);
    });
  });

  test('a basket of phones cannot be discounted into a loss', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 500000, 'steps')`, [user]);
      const phone = await makeProduct(c, { price: 100000, cost: 96000 });
      const id = await placeOrder(c, user, [{ product_id: phone, qty: 2 }], { coins: 500000 });
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.discount_pkr, 1600, '2 x 800, the §0 ceiling on a 4% margin phone');
      const { rows } = await c.query('select gross_profit_pkr from order_economics where id = $1', [id]);
      assert.equal(Number(rows[0].gross_profit_pkr), 6400);
    });
  });

  test('never lets an ineligible category absorb any of the discount', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 50000, 'steps')`, [user]);
      const gift = await makeProduct(c, { price: 5000, cost: 1000, coinEligible: false });
      const id = await placeOrder(c, user, [{ product_id: gift, qty: 1 }], { coins: 50000 });
      await flushDeferred(c);

      const o = await order(c, id);
      assert.equal(o.discount_pkr, 0);
      assert.equal(o.coins_spent, 0);
    });
  });

  test('takes stock, and refuses an order it cannot fulfil', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000, stock: 2 });
      await placeOrder(c, user, [{ product_id: shirt, qty: 2 }]);
      await flushDeferred(c);
      const { rows } = await c.query('select stock from products where id = $1', [shirt]);
      assert.equal(rows[0].stock, 0);

      await expectRejected(c, () =>
        placeOrder(c, user, [{ product_id: shirt, qty: 1 }]),
        /out of stock/,
      );
    });
  });

  test('refuses to fulfil an affiliate listing we do not stock (§8)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const { rows } = await c.query(
        `insert into products (title, price_pkr, cost_pkr, stock, source, affiliate_url)
         values ('Affiliate thing', 5000, 4000, 99, 'affiliate', 'https://example.com/x')
         returning id`,
      );
      await expectRejected(c, () =>
        placeOrder(c, user, [{ product_id: rows[0].id, qty: 1 }]),
        /not fulfilled by us|out of stock/,
      );
    });
  });

  test('shows a user what they can actually save right now (§7.4)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });

      // Empty wallet: nothing to promise.
      assert.equal((await c.query('select affordable_discount_pkr($1,$2) as d', [user, shirt])).rows[0].d, 0);

      // 3,000 coins is PKR 90 — under the 300 ceiling, so the wallet binds.
      await c.query(`select credit_coins($1, 3000, 'steps')`, [user]);
      assert.equal((await c.query('select affordable_discount_pkr($1,$2) as d', [user, shirt])).rows[0].d, 90);

      // A full wallet: the §0 ceiling binds instead.
      await c.query(`select credit_coins($1, 90000, 'steps')`, [user]);
      assert.equal((await c.query('select affordable_discount_pkr($1,$2) as d', [user, shirt])).rows[0].d, 300);
    });
  });
});

describe('§7.5 the COD rule — refuse the delivery and the coins are gone', () => {
  test('BURNS the coins on a refused delivery', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 10000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 10000 });
      await flushDeferred(c);

      const spent = (await order(c, id)).coins_spent;
      assert.ok(spent > 0);
      const afterHold = await balance(c, user);

      await c.query(`select set_order_status($1, 'refused')`, [id]);

      assert.equal(await balance(c, user), afterHold, 'the coins must NOT come back');
      const { rows } = await c.query(
        `select count(*)::int as n from coin_ledger where order_id = $1 and reason = 'order_refund'`,
        [id],
      );
      assert.equal(rows[0].n, 0, 'a refused delivery must never write a refund');
    });
  });

  test('leaves the hold in place on delivery — spent, not returned', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 10000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 10000 });
      await flushDeferred(c);
      const afterHold = await balance(c, user);

      await c.query(`select set_order_status($1, 'confirmed')`, [id]);
      await c.query(`select set_order_status($1, 'dispatched')`, [id]);
      await c.query(`select set_order_status($1, 'delivered')`, [id]);

      assert.equal(await balance(c, user), afterHold);
      assert.equal((await order(c, id)).status, 'delivered');
    });
  });

  test('returns the coins only when the order is cancelled before dispatch', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 10000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000, stock: 5 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 10000 });
      await flushDeferred(c);

      await c.query(`select set_order_status($1, 'cancelled')`, [id]);
      assert.equal(await balance(c, user), 10000, 'a cancellation gives the coins back');
      const { rows } = await c.query('select stock from products where id = $1', [shirt]);
      assert.equal(rows[0].stock, 5, 'and the stock back too');
    });
  });

  test('a refund restores each batch to its original expiry, never extending a coin’s life', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 10000, 'steps', null, 12)`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 10000 });
      await flushDeferred(c);
      await c.query(`select set_order_status($1, 'cancelled')`, [id]);

      const { rows } = await c.query(
        'select days_left from coin_batches where user_id = $1', [user],
      );
      assert.equal(rows.length, 1);
      assert.ok(rows[0].days_left <= 12, 'a refund must not reset the expiry clock');
    });
  });

  test('REFUSES to dispatch an unconfirmed COD order above PKR 3,000', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const tv = await makeProduct(c, { price: 40000, cost: 30000 });
      const id = await placeOrder(c, user, [{ product_id: tv, qty: 1 }]);
      await flushDeferred(c);

      await expectRejected(c, () =>
        c.query(`select set_order_status($1, 'dispatched')`, [id]),
        /not been confirmed on WhatsApp/,
      );

      await c.query(`select set_order_status($1, 'confirmed')`, [id]);
      await c.query(`select set_order_status($1, 'dispatched')`, [id]);
      assert.equal((await order(c, id)).status, 'dispatched');
    });
  });

  test('raises cod_risk_score on every refusal (§7.5)', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 2000, cost: 800, stock: 50 });
      for (const _ of [1, 2]) {
        const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
        await flushDeferred(c);
        await c.query(`select set_order_status($1, 'refused')`, [id]);
      }
      const { rows } = await c.query(
        'select cod_risk_score from orders where user_id = $1 order by created_at', [user],
      );
      assert.ok(rows.every((r) => Number(r.cod_risk_score) === 1));
      const { rows: u } = await c.query('select status from users where id = $1', [user]);
      assert.equal(u[0].status, 'flagged', 'a repeat refuser should be flagged');
    });
  });

  test('reports RTO next to revenue, as a first-class metric', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 2000, cost: 800, stock: 50 });
      for (const status of ['delivered', 'delivered', 'delivered', 'refused']) {
        const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
        await flushDeferred(c);
        if (status === 'delivered') {
          await c.query(`select set_order_status($1, 'confirmed')`, [id]);
          await c.query(`select set_order_status($1, 'dispatched')`, [id]);
        }
        await c.query(`select set_order_status($1, $2)`, [id, status]);
      }
      const { rows } = await c.query(
        `select * from fulfilment_health where week = date_trunc('week', now())::date`,
      );
      assert.equal(Number(rows[0].closed_orders), 4);
      assert.equal(Number(rows[0].rto_orders), 1);
      assert.equal(Number(rows[0].rto_pct), 25.0);
    });
  });

  test('an order cannot be closed twice', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 2000, cost: 800 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
      await flushDeferred(c);
      await c.query(`select set_order_status($1, 'refused')`, [id]);
      await expectRejected(c, () =>
        c.query(`select set_order_status($1, 'cancelled')`, [id]),
        /already closed/,
      );
    });
  });
});

describe('§7.7 referrals pay on the first purchase, not on install', () => {
  test('pays nothing at signup, and both sides on the first delivered order', async () => {
    await withRollback(async (c) => {
      const referrer = await makeUser(c);
      const referee = await makeUser(c);
      await c.query('update users set referred_by = $1 where id = $2', [referrer, referee]);

      assert.equal(await balance(c, referrer), 0, 'installing must pay nobody');

      const shirt = await makeProduct(c, { price: 2000, cost: 800, stock: 20 });
      const id = await placeOrder(c, referee, [{ product_id: shirt, qty: 1 }]);
      await flushDeferred(c);
      await c.query(`select set_order_status($1, 'confirmed')`, [id]);
      await c.query(`select set_order_status($1, 'dispatched')`, [id]);

      assert.equal(await balance(c, referrer), 0, 'dispatch is not delivery');

      await c.query(`select set_order_status($1, 'delivered')`, [id]);
      assert.equal(await balance(c, referrer), 500);
      assert.equal(await balance(c, referee), 500);
    });
  });

  test('pays once, not on every subsequent order', async () => {
    await withRollback(async (c) => {
      const referrer = await makeUser(c);
      const referee = await makeUser(c);
      await c.query('update users set referred_by = $1 where id = $2', [referrer, referee]);
      const shirt = await makeProduct(c, { price: 2000, cost: 800, stock: 20 });

      for (const _ of [1, 2]) {
        const id = await placeOrder(c, referee, [{ product_id: shirt, qty: 1 }]);
        await flushDeferred(c);
        await c.query(`select set_order_status($1, 'confirmed')`, [id]);
        await c.query(`select set_order_status($1, 'dispatched')`, [id]);
        await c.query(`select set_order_status($1, 'delivered')`, [id]);
      }
      assert.equal(await balance(c, referrer), 500);
    });
  });
});
