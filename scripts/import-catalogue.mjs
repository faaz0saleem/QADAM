#!/usr/bin/env node
/**
 * §8.4 — the consignment catalogue importer.
 *
 * "Brands who sign with us will hand over their own photos and specs, usually as
 * a spreadsheet or a Drive folder. Build a bulk importer that takes a CSV with
 * title, price, cost, stock, images[] and validates price > cost on every row.
 * This is where the real catalogue comes from."
 *
 *   node scripts/import-catalogue.mjs --brand "Sample Threads" catalogue.csv
 *   node scripts/import-catalogue.mjs --brand "Sample Threads" --apply catalogue.csv
 *
 * Dry run by default. It validates every row and prints what §0 would allow on
 * each one BEFORE writing anything, because the discount ceiling is the thing a
 * brand conversation actually turns on — and because a spreadsheet with one bad
 * price should not leave half a catalogue imported.
 *
 * This importer never invents product data. §8 is explicit: we do not lift
 * catalogues or photos from other retailers. Every row here comes from the
 * brand that signed with us.
 */

import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { parseCsvObjects } from './lib/csv.mjs';
import { validateRecords } from './lib/validate.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--brand' && args[args.indexOf(a) - 1] !== '--category');
const brandName = flag('brand');
const defaultCategory = flag('category');
const apply = has('apply');
const dbUrl = process.env.DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;

const pkr = (n) => new Intl.NumberFormat('en-US').format(n);

function usage(message) {
  process.stderr.write(`${message ? `${message}\n\n` : ''}Usage:
  node scripts/import-catalogue.mjs --brand "<brand name>" [--category "<name>"] [--apply] <file.csv>

  --brand      required. Must already exist in the brands table.
  --category   optional default for rows without a category column.
  --apply      actually write. Without it this is a dry run.

  DATABASE_URL must point at the target database when using --apply.

Columns (header names are flexible — price_pkr, "Price PKR" and "Selling Price"
all work):
  title     required
  price     required, integer PKR, must be above cost
  cost      required, integer PKR — this is what §0 is computed from
  stock     optional, defaults to 0
  images    optional, separated by | or ; or newlines
  category  optional
`);
  process.exit(message ? 1 : 0);
}

if (has('help') || !file) usage(file ? null : 'No CSV file given.');
if (!brandName) usage('--brand is required.');

const csv = await readFile(file, 'utf8');
const { headers, records } = parseCsvObjects(csv);

const missing = ['title'].filter(
  (h) => !headers.some((x) => x === h || x.startsWith(`${h}_`) || x.includes(h)),
);
if (records.length === 0) usage(`${file} has no data rows.`);
if (missing.length) usage(`${file} has no ${missing.join(', ')} column. Found: ${headers.join(', ')}`);

const { rows, errors } = validateRecords(records);

process.stdout.write(`\n${file}\n${records.length} rows read, ${rows.length} valid, ${errors.length} rejected\n\n`);

if (errors.length) {
  process.stdout.write('Rejected rows\n');
  for (const e of errors) {
    process.stdout.write(`  line ${String(e.line).padStart(4)}  ${e.title ?? ''}\n                ${e.message}\n`);
  }
  process.stdout.write('\n');
}

if (rows.length) {
  // The number a brand conversation actually turns on. Showing it here means
  // nobody is surprised later that a low-margin line barely discounts.
  process.stdout.write('What §0 allows on each row\n');
  process.stdout.write(
    `  ${'title'.padEnd(34)}${'price'.padStart(9)}${'cost'.padStart(9)}${'margin'.padStart(9)}${'max disc'.padStart(10)}${'of price'.padStart(10)}\n`,
  );
  for (const r of rows) {
    const pct = ((100 * r.max_discount_pkr) / r.price_pkr).toFixed(1);
    process.stdout.write(
      `  ${r.title.slice(0, 33).padEnd(34)}${pkr(r.price_pkr).padStart(9)}${pkr(r.cost_pkr).padStart(9)}` +
      `${`${r.margin_pct}%`.padStart(9)}${pkr(r.max_discount_pkr).padStart(10)}${`${pct}%`.padStart(10)}\n`,
    );
  }
  process.stdout.write('\n');
}

if (errors.length > 0) {
  // All-or-nothing: fix the sheet and run it again.
  process.stderr.write('Nothing was imported. Fix the rows above and run again.\n');
  process.exit(1);
}

if (!apply) {
  process.stdout.write(`Dry run. Re-run with --apply to import ${rows.length} products.\n`);
  process.exit(0);
}

if (!dbUrl) {
  process.stderr.write('DATABASE_URL is not set.\n');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

try {
  await client.query('begin');

  const { rows: brand } = await client.query('select id from brands where name = $1', [brandName]);
  if (brand.length === 0) {
    throw new Error(
      `no brand called "${brandName}". Add it first — a product without a brand has nobody to pay.`,
    );
  }
  const brandId = brand[0].id;

  const categoryIds = new Map();
  const categoryFor = async (name) => {
    if (!name) return null;
    if (categoryIds.has(name)) return categoryIds.get(name);
    const { rows: found } = await client.query('select id from categories where name = $1', [name]);
    const id = found[0]?.id ?? null;
    if (!id) throw new Error(`no category called "${name}"`);
    categoryIds.set(name, id);
    return id;
  };

  let inserted = 0;
  let updated = 0;

  for (const r of rows) {
    const categoryId = await categoryFor(r.category ?? defaultCategory);
    const { rows: existing } = await client.query(
      'select id from products where brand_id = $1 and title = $2',
      [brandId, r.title],
    );

    if (existing.length) {
      await client.query(
        `update products
         set price_pkr = $1, cost_pkr = $2, stock = $3, images = $4::jsonb,
             category_id = coalesce($5, category_id)
         where id = $6`,
        [r.price_pkr, r.cost_pkr, r.stock, JSON.stringify(r.images), categoryId, existing[0].id],
      );
      updated += 1;
    } else {
      await client.query(
        `insert into products (title, brand_id, category_id, price_pkr, cost_pkr, stock, source, images)
         values ($1, $2, $3, $4, $5, $6, 'consignment', $7::jsonb)`,
        [r.title, brandId, categoryId, r.price_pkr, r.cost_pkr, r.stock, JSON.stringify(r.images)],
      );
      inserted += 1;
    }
  }

  await client.query('commit');
  process.stdout.write(`Imported ${inserted} new products, updated ${updated}.\n`);
} catch (err) {
  await client.query('rollback');
  process.stderr.write(`\nNothing was imported: ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await client.end();
}
