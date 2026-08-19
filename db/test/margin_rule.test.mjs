// §0 — THE ONE RULE THAT MUST NEVER BREAK
//
//   max_discount_pkr = MIN( 0.20 * (price - cost),  0.10 * price )
//
// These tests exist to prove the rule is enforced by the DATABASE, not by
// application logic: they write straight to the tables as the table owner, with
// no checkout code in the path, and the database still refuses. If any test in
// this file fails, stop and fix it before anything else — §13.1.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRollback, expectRejected, makeUser, makeProduct, makeOrder, addItem, flushDeferred } from './helpers.mjs';

const expected = (price, cost) =>
  Math.max(0, Math.min(Math.floor(0.2 * (price - cost)), Math.floor(0.1 * price)));

describe('§0 the formula', () => {
  test('matches MIN(20% of margin, 10% of price) across the range', async () => {
    await withRollback(async (c) => {
      const cases = [
        [3000, 1000],    // clothing, fat margin  -> capped by the 10% price arm
        [1500, 500],     // clothing              -> capped by the 10% price arm
        [100000, 96000], // phone, 4% margin      -> capped by the 20% margin arm
        [45000, 43000],  // laptop, thin margin
        [2500, 2400],
        [999, 998],      // margin of 1 rupee
        [1, 0],          // degenerate
        [10, 9],
        [7, 3],          // floors: 0.2*4=0.8 -> 0, 0.1*7=0.7 -> 0
      ];
      for (const [price, cost] of cases) {
        const { rows } = await c.query('select max_coin_discount_pkr($1,$2) as m', [price, cost]);
        assert.equal(rows[0].m, expected(price, cost), `price ${price}, cost ${cost}`);
      }
    });
  });

  test('never returns more than either arm allows, over 500 random pairs', async () => {
    await withRollback(async (c) => {
      for (let i = 0; i < 500; i += 1) {
        const price = 1 + Math.floor(Math.random() * 200000);
        const cost = Math.floor(Math.random() * price);
        const { rows } = await c.query('select max_coin_discount_pkr($1,$2) as m', [price, cost]);
        const m = rows[0].m;
        assert.ok(m >= 0, 'discount ceiling went negative');
        assert.ok(m <= 0.2 * (price - cost) + 1e-9, `exceeded 20% of margin at ${price}/${cost}`);
        assert.ok(m <= 0.1 * price + 1e-9, `exceeded 10% of price at ${price}/${cost}`);
      }
    });
  });

  test('clamps to zero rather than going negative when cost exceeds price', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query('select max_coin_discount_pkr(1000, 5000) as m');
      assert.equal(rows[0].m, 0);
    });
  });

  test('is IMMUTABLE, which is what lets it live inside a CHECK constraint', async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select provolatile from pg_proc where proname = 'max_coin_discount_pkr'`,
      );
      assert.equal(rows[0].provolatile, 'i');
    });
  });
});

describe('§0 the constraint — a violating discount is rejected by the database', () => {
  test('accepts a discount at exactly the ceiling', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      await addItem(c, order, product, { discount: 300 }); // 10% of 3000
      const { rows } = await c.query('select discount_pkr from order_items where order_id = $1', [order]);
      assert.equal(rows[0].discount_pkr, 300);
    });
  });

  test('REJECTS one rupee over the ceiling', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        addItem(c, order, product, { discount: 301 }),
        /discount_within_margin/,
      );
    });
  });

  test('REJECTS an UPDATE that pushes an accepted line over the ceiling', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      const item = await addItem(c, order, product, { discount: 300 });
      await expectRejected(c, () =>
        c.query('update order_items set discount_pkr = 500 where id = $1', [item]),
        /discount_within_margin/,
      );
    });
  });

  test('REJECTS a flat 10% off a low-margin phone — the case that kills the business', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      // PKR 100,000 phone bought at 96,000: 4% margin.
      const phone = await makeProduct(c, { price: 100000, cost: 96000 });
      const order = await makeOrder(c, user);

      // 10% off would be 10,000 — a 6,000 rupee loss on every unit sold.
      await expectRejected(c, () =>
        addItem(c, order, phone, { discount: 10000 }),
        /discount_within_margin/,
      );

      // What §0 does allow is 800: 20% of the 4,000 rupee margin, ~0.8% of price.
      await addItem(c, order, phone, { discount: 800 });
      const { rows } = await c.query(
        `select round(100.0 * discount_pkr / price_pkr, 1) as pct,
                qty * (price_pkr - cost_pkr) - discount_pkr as gross_profit
         from order_items where order_id = $1`,
        [order],
      );
      assert.equal(Number(rows[0].pct), 0.8);
      assert.ok(rows[0].gross_profit > 0, 'the allowed discount still leaves profit');
    });
  });

  test('scales the ceiling with qty, and rejects one rupee past it', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      await addItem(c, order, product, { qty: 4, discount: 1200 }); // 4 x 300
      await expectRejected(c, () =>
        addItem(c, order, product, { qty: 4, discount: 1201 }),
        /discount_within_margin/,
      );
    });
  });

  test('REJECTS any discount at all in a category flagged coin_eligible = false', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000, coinEligible: false });
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        addItem(c, order, product, { discount: 1, coinEligible: false }),
        /no_discount_when_ineligible/,
      );
    });
  });

  test('holds even when the snapshot is fabricated — there is no price/cost pair that opens a hole', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);

      // Claim a cost of zero to inflate the apparent margin: the 10%-of-price
      // arm still binds.
      await expectRejected(c, () =>
        addItem(c, order, product, { price: 3000, cost: 0, discount: 301 }),
        /discount_within_margin/,
      );

      // Claim a cost above the price to make the margin arm negative: greatest(0, ...)
      // clamps the ceiling to zero, and item_price_above_cost refuses the line too.
      // Postgres does not promise which of the two fires first; both are refusals.
      await expectRejected(c, () =>
        addItem(c, order, product, { price: 3000, cost: 4000, discount: 1 }),
        /discount_within_margin|item_price_above_cost/,
      );
    });
  });
});

describe('§0 at order level — the header cannot be used to route around the item check', () => {
  test('REJECTS an order whose discount_pkr exceeds the sum of its item discounts', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      await addItem(c, order, product, { discount: 300 });

      // Every line is legal. The header is where the loss would be booked.
      await c.query(
        `update orders set subtotal_pkr = 3000, discount_pkr = 2500,
                           coin_value_pkr = 1, coins_spent = 2500, total_pkr = 500
         where id = $1`,
        [order],
      );
      await expectRejected(c, () => flushDeferred(c), /does not match|item discounts total/);
    });
  });

  test('REJECTS an order header claiming a subtotal its items do not support', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const product = await makeProduct(c, { price: 3000, cost: 1000 });
      const order = await makeOrder(c, user);
      await addItem(c, order, product, { discount: 0 });
      await c.query('update orders set subtotal_pkr = 99, total_pkr = 99 where id = $1', [order]);
      await expectRejected(c, () => flushDeferred(c), /items total/);
    });
  });

  test('REJECTS a discount that is not backed by coins at the snapshotted rate', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const order = await makeOrder(c, user);
      await expectRejected(c, () =>
        c.query(
          `update orders set discount_pkr = 300, coins_spent = 0, coin_value_pkr = 0.03,
                             subtotal_pkr = 3000, total_pkr = 2700 where id = $1`,
          [order],
        ),
        /discount_is_coin_backed/,
      );
    });
  });

  test('an order that passes every check still books a positive gross profit', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      const shirt = await makeProduct(c, { price: 3000, cost: 1000 });
      const phone = await makeProduct(c, { price: 100000, cost: 96000 });
      const order = await makeOrder(c, user);
      await addItem(c, order, shirt, { qty: 2, discount: 600 });
      await addItem(c, order, phone, { qty: 1, discount: 800 });

      await c.query(
        `update orders set subtotal_pkr = 106000, discount_pkr = 1400,
                           coins_spent = 1400, coin_value_pkr = 1, total_pkr = 104600
         where id = $1`,
        [order],
      );
      await flushDeferred(c);

      const { rows } = await c.query('select * from order_economics where id = $1', [order]);
      assert.equal(Number(rows[0].revenue_pkr), 106000);
      assert.equal(Number(rows[0].cogs_pkr), 98000);
      assert.equal(Number(rows[0].coin_discount_pkr), 1400);
      assert.equal(Number(rows[0].gross_profit_pkr), 6600);
      assert.ok(Number(rows[0].gross_profit_pkr) > 0);
    });
  });

  test('order_economics can never show a negative gross profit, over 300 random legal orders', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      for (let i = 0; i < 300; i += 1) {
        const price = 100 + Math.floor(Math.random() * 150000);
        const cost = Math.floor(Math.random() * (price - 1));
        const qty = 1 + Math.floor(Math.random() * 5);
        const product = await makeProduct(c, { price, cost });
        const order = await makeOrder(c, user);
        // Always ask for the largest discount the rule permits.
        const { rows: cap } = await c.query('select max_coin_discount_pkr($1,$2) * $3 as m', [price, cost, qty]);
        await addItem(c, order, product, { qty, discount: cap[0].m });
        const { rows } = await c.query('select gross_profit_pkr from order_economics where id = $1', [order]);
        assert.ok(
          Number(rows[0].gross_profit_pkr) >= 0,
          `negative gross profit at price ${price}, cost ${cost}, qty ${qty}`,
        );
      }
    });
  });
});

describe('§3.3 the P0 alarm', () => {
  test('margin_breaches is empty, and stays empty under the worst legal order', async () => {
    await withRollback(async (c) => {
      const user = await makeUser(c);
      // Every line discounted to its §0 ceiling, across both arms of the rule.
      const order = await makeOrder(c, user);
      let subtotal = 0;
      let discount = 0;
      for (const [price, cost, qty] of [[3000, 1000, 3], [100000, 96000, 1], [1500, 500, 2]]) {
        const p = await makeProduct(c, { price, cost });
        const { rows } = await c.query('select max_coin_discount_pkr($1,$2) * $3 as m',
          [price, cost, qty]);
        await addItem(c, order, p, { qty, discount: rows[0].m });
        subtotal += price * qty;
        discount += rows[0].m;
      }
      await c.query(
        `update orders set subtotal_pkr = $2::int, discount_pkr = $3::int, coins_spent = $3::int,
                           coin_value_pkr = 1, total_pkr = $2::int - $3::int where id = $1`,
        [order, subtotal, discount],
      );
      await flushDeferred(c);

      const { rows } = await c.query('select * from margin_breaches');
      assert.deepEqual(rows, [], 'a margin breach means a constraint has been bypassed');
    });
  });
});
