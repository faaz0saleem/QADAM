// §7.5 — WhatsApp confirmation and the courier handoff.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, flushDeferred, asUser } from './helpers.mjs';

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

const orderRow = async (c, id) =>
  (await c.query('select * from orders where id = $1', [id])).rows[0];

const balance = async (c, user) =>
  (await c.query('select coin_balance($1) as b', [user])).rows[0].b;

describe('§7.5 confirmation before dispatch', () => {
  test('queues a confirmation for a COD order above PKR 3,000', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const tv = await makeProduct(c, { price: 40000, cost: 30000 });
      const id = await placeOrder(c, user, [{ product_id: tv, qty: 1 }]);
      await flushDeferred(c);

      const { rows } = await c.query('select queue_order_confirmation($1) as id', [id]);
      assert.ok(rows[0].id, 'a big COD order must be confirmed before it ships');

      const { rows: conf } = await c.query(
        'select token, phone, response from order_confirmations where order_id = $1', [id]);
      assert.match(conf[0].token, /^[0-9a-f]{48}$/, 'the token must be unguessable');
      assert.equal(conf[0].response, null);
    });
  });

  test('does not bother a small order or a prepaid one', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const socks = await makeProduct(c, { price: 900, cost: 400 });
      const small = await placeOrder(c, user, [{ product_id: socks, qty: 1 }]);
      const tv = await makeProduct(c, { price: 40000, cost: 30000 });
      const card = await placeOrder(c, user, [{ product_id: tv, qty: 1 }], { payment: 'card' });
      await flushDeferred(c);

      assert.equal((await c.query('select queue_order_confirmation($1) as id', [small])).rows[0].id, null);
      assert.equal((await c.query('select queue_order_confirmation($1) as id', [card])).rows[0].id, null);
    });
  });

  test('a confirm reply lets the order dispatch', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const tv = await makeProduct(c, { price: 40000, cost: 30000 });
      const id = await placeOrder(c, user, [{ product_id: tv, qty: 1 }]);
      await flushDeferred(c);
      await c.query('select queue_order_confirmation($1)', [id]);
      const { rows } = await c.query(
        'select token from order_confirmations where order_id = $1', [id]);

      await c.query(`select respond_to_confirmation($1, 'confirmed')`, [rows[0].token]);

      const o = await orderRow(c, id);
      assert.equal(o.status, 'confirmed');
      assert.ok(o.confirmed_at);
      await c.query(`select set_order_status($1, 'dispatched')`, [id]);
      assert.equal((await orderRow(c, id)).status, 'dispatched');
    });
  });

  test('a cancel reply returns the coins, because nothing was refused at a door', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 40000, 'steps')`, [user]);
      const tv = await makeProduct(c, { price: 40000, cost: 30000, stock: 5 });
      const id = await placeOrder(c, user, [{ product_id: tv, qty: 1 }], { coins: 40000 });
      await flushDeferred(c);
      const spent = (await orderRow(c, id)).coins_spent;
      assert.ok(spent > 0);

      await c.query('select queue_order_confirmation($1)', [id]);
      const { rows } = await c.query(
        'select token from order_confirmations where order_id = $1', [id]);
      await c.query(`select respond_to_confirmation($1, 'cancelled')`, [rows[0].token]);

      assert.equal((await orderRow(c, id)).status, 'cancelled');
      assert.equal(await balance(c, user), 40000, 'cancelling is not refusing (§7.5)');
    });
  });

  test('the first answer stands — a double tap or a webhook retry changes nothing', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const tv = await makeProduct(c, { price: 40000, cost: 30000 });
      const id = await placeOrder(c, user, [{ product_id: tv, qty: 1 }]);
      await flushDeferred(c);
      await c.query('select queue_order_confirmation($1)', [id]);
      const { rows } = await c.query(
        'select token from order_confirmations where order_id = $1', [id]);

      await c.query(`select respond_to_confirmation($1, 'confirmed')`, [rows[0].token]);
      await c.query(`select respond_to_confirmation($1, 'cancelled')`, [rows[0].token]);

      assert.equal((await orderRow(c, id)).status, 'confirmed', 'the second reply must not win');
    });
  });

  test('REJECTS an unknown token, so reaching the webhook is not enough', async () => {
    await withRollback(async (c) => {
      await expectRejected(c, () =>
        c.query(`select respond_to_confirmation('deadbeef', 'confirmed')`),
        /unknown confirmation/);
    });
  });
});

describe('§7.5 courier status', () => {
  const ship = async (c, id) => {
    await c.query(
      `update orders set courier = 'leopards', tracking_number = 'LE12345' where id = $1`, [id]);
  };

  test('a delivered scan closes the order and the coins stay spent', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 20000 });
      await flushDeferred(c);
      const after = await balance(c, user);
      await ship(c, id);

      await c.query(`select record_courier_status('LE12345', 'delivered')`);
      assert.equal((await orderRow(c, id)).status, 'delivered');
      assert.equal(await balance(c, user), after);
    });
  });

  test('a refusal BURNS the coins', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 20000 });
      await flushDeferred(c);
      const after = await balance(c, user);
      await ship(c, id);

      await c.query(`select record_courier_status('LE12345', 'refused')`);
      assert.equal((await orderRow(c, id)).status, 'refused');
      assert.equal(await balance(c, user), after, 'refusing the delivery costs the coins');
    });
  });

  test('a return we cannot attribute to the customer does NOT burn their coins', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }], { coins: 20000 });
      await flushDeferred(c);
      await ship(c, id);

      await c.query(`select record_courier_status('LE12345', 'returned')`);
      assert.equal((await orderRow(c, id)).status, 'returned');
    });
  });

  test('an in-transit ping never reopens a closed order', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
      await flushDeferred(c);
      await ship(c, id);
      await c.query(`select record_courier_status('LE12345', 'delivered')`);
      await c.query(`select record_courier_status('LE12345', 'in_transit')`);
      assert.equal((await orderRow(c, id)).status, 'delivered');
    });
  });
});

describe('§7.5 a failed delivery returns the goods to the shelf', () => {
  const stockOf = async (c, id) =>
    (await c.query('select stock from products where id = $1', [id])).rows[0].stock;

  test('a refusal restocks, even though it burns the coins', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      await c.query(`select credit_coins($1, 20000, 'steps')`, [user]);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000, stock: 10 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 2 }], { coins: 20000 });
      await flushDeferred(c);
      assert.equal(await stockOf(c, shirt), 8);
      const after = await balance(c, user);

      await c.query(`select set_order_status($1, 'refused')`, [id]);

      assert.equal(await stockOf(c, shirt), 10, 'the parcel came back to us');
      assert.equal(await balance(c, user), after, 'and the coins are still gone (§7.5)');
    });
  });

  test('an RTO restocks too', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000, stock: 5 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
      await flushDeferred(c);
      assert.equal(await stockOf(c, shirt), 4);

      await c.query(`select set_order_status($1, 'returned')`, [id]);
      assert.equal(await stockOf(c, shirt), 5);
    });
  });

  test('a delivery does not restock', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000, stock: 5 });
      const id = await placeOrder(c, user, [{ product_id: shirt, qty: 1 }]);
      await flushDeferred(c);
      await c.query(`select set_order_status($1, 'confirmed')`, [id]);
      await c.query(`select set_order_status($1, 'dispatched')`, [id]);
      await c.query(`select set_order_status($1, 'delivered')`, [id]);
      assert.equal(await stockOf(c, shirt), 4);
    });
  });
});
