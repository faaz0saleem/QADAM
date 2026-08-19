// §8.4 — the CSV importer.
//
// The rule that matters is `price > cost` on every row, and that ALL rows are
// checked before any is written: a brand's spreadsheet with one bad price
// should not leave half a catalogue imported.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvObjects } from './csv.mjs';
import { validateRecords, parseMoney, parseImages, maxCoinDiscountPkr } from './validate.mjs';

describe('reading what a brand actually sends', () => {
  test('handles quoted fields with commas in them', () => {
    const rows = parseCsv('title,price\n"Kurta, blue",3200\n');
    assert.deepEqual(rows[1], ['Kurta, blue', '3200']);
  });

  test('handles doubled quotes, CRLF and an Excel BOM', () => {
    const rows = parseCsv('﻿title,note\r\n"He said ""hi""",ok\r\n');
    assert.deepEqual(rows[0], ['title', 'note']);
    assert.deepEqual(rows[1], ['He said "hi"', 'ok']);
  });

  test('handles a newline inside a quoted field', () => {
    const rows = parseCsv('title,desc\n"Shirt","soft\ncotton"\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[1][1], 'soft\ncotton');
  });

  test('ignores the blank rows spreadsheets leave behind', () => {
    const { records } = parseCsvObjects('title,price\nShirt,100\n\n\n');
    assert.equal(records.length, 1);
  });

  test('normalises header names so any reasonable spelling works', () => {
    const { headers } = parseCsvObjects('Product Name,Price PKR,Our Price\nx,1,2\n');
    assert.deepEqual(headers, ['product_name', 'price_pkr', 'our_price']);
  });
});

describe('money as it actually arrives', () => {
  test('accepts the formats a Pakistani price list uses', () => {
    assert.equal(parseMoney('3200'), 3200);
    assert.equal(parseMoney('3,200'), 3200);
    assert.equal(parseMoney('PKR 3200'), 3200);
    assert.equal(parseMoney('Rs. 3,200'), 3200);
    assert.equal(parseMoney('3200/-'), 3200);
    assert.equal(parseMoney('3200.00'), 3200);
  });

  test('refuses to guess at anything else', () => {
    assert.equal(parseMoney('call for price'), null);
    assert.equal(parseMoney('1200-1500'), null);
    assert.equal(parseMoney(''), null);
  });

  test('splits image lists on the separators people actually use', () => {
    assert.deepEqual(parseImages('a.jpg|b.jpg'), ['a.jpg', 'b.jpg']);
    assert.deepEqual(parseImages('a.jpg; b.jpg'), ['a.jpg', 'b.jpg']);
    assert.deepEqual(
      parseImages('https://x/a.jpg, https://x/b.jpg'),
      ['https://x/a.jpg', 'https://x/b.jpg'],
    );
    assert.deepEqual(parseImages(''), []);
  });
});

describe('§8.4 validation', () => {
  const rowsOf = (csv) => validateRecords(parseCsvObjects(csv).records);

  test('accepts a clean sheet and computes what §0 allows', () => {
    const { rows, errors } = rowsOf(
      'title,price,cost,stock\nLawn kurta,3200,1600,40\nBudget phone,42000,40300,8\n',
    );
    assert.deepEqual(errors, []);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].max_discount_pkr, 320, 'clothing hits the 10%-of-price arm');
    assert.equal(rows[1].max_discount_pkr, 340, 'a thin-margin phone hits the 20%-of-margin arm');
  });

  test('REJECTS a row where price is not above cost', () => {
    const { rows, errors } = rowsOf('title,price,cost\nLoss leader,1000,1000\n');
    assert.equal(rows.length, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /not above cost/);
  });

  test('REJECTS a row priced below cost, loudly', () => {
    const { errors } = rowsOf('title,price,cost\nUpside down,900,1000\n');
    assert.match(errors[0].message, /sell at a loss/);
  });

  test('reports every bad row, not just the first', () => {
    const { errors } = rowsOf(
      'title,price,cost\nA,100,50\nB,call us,10\nC,100,100\n,50,10\n',
    );
    assert.equal(errors.length, 3);
    assert.deepEqual(errors.map((e) => e.line), [3, 4, 5]);
  });

  test('catches a duplicate title before the database has to', () => {
    const { errors } = rowsOf('title,price,cost\nShirt,100,50\nShirt,120,60\n');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /duplicate of the row on line 2/);
  });

  test('defaults stock to zero rather than refusing the row', () => {
    const { rows, errors } = rowsOf('title,price,cost\nShirt,100,50\n');
    assert.deepEqual(errors, []);
    assert.equal(rows[0].stock, 0);
  });

  test('the ceiling it reports agrees with the database function', () => {
    // Same arithmetic as max_coin_discount_pkr in SQL. If these ever drift, the
    // importer would promise a brand a discount the database then refuses.
    for (const [price, cost] of [[3200, 1600], [42000, 40300], [999, 998], [1500, 500]]) {
      assert.equal(
        maxCoinDiscountPkr(price, cost),
        Math.max(0, Math.min(Math.floor(0.2 * (price - cost)), Math.floor(0.1 * price))),
      );
    }
  });
});
