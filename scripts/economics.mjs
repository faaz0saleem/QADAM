#!/usr/bin/env node
/**
 * §3.3 — the admin report.
 *
 * "Build an admin screen that shows this view. If it ever shows a negative
 * number, something has bypassed the constraint and that is a P0 bug."
 *
 *   DATABASE_URL=... node scripts/economics.mjs
 *
 * A terminal report rather than a screen, deliberately: it runs against a
 * production connection string from a laptop on day one, and it can be a cron
 * that pages someone long before there is an admin app to log into. Exits
 * non-zero on a §0 breach so it works as a check.
 */

import pg from 'pg';

const url = process.env.DATABASE_URL ?? process.env.ADMIN_DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set.\n');
  process.exit(1);
}

const n = (v) => new Intl.NumberFormat('en-US').format(Number(v ?? 0));
const rule = (label = '') =>
  process.stdout.write(`\n${label}\n${'─'.repeat(Math.max(60, label.length))}\n`);

const client = new pg.Client({ connectionString: url });
await client.connect();
let breach = false;

try {
  // ---- the alarm, first, because nothing else matters if it fires ----------
  const { rows: breaches } = await client.query('select * from margin_breaches');
  if (breaches.length > 0) {
    breach = true;
    rule('P0 — §0 HAS BEEN BYPASSED');
    process.stdout.write(
      'These orders book a gross loss. A constraint has been circumvented.\n' +
      'Find the write path. Do not adjust the orders.\n\n',
    );
    for (const b of breaches) {
      process.stdout.write(
        `  ${b.order_id}  ${b.status.padEnd(10)}  revenue ${n(b.revenue_pkr).padStart(9)}` +
        `  cogs ${n(b.cogs_pkr).padStart(9)}  discount ${n(b.coin_discount_pkr).padStart(8)}` +
        `  profit ${n(b.gross_profit_pkr).padStart(9)}\n`,
      );
    }
  } else {
    rule('§0');
    process.stdout.write('  No margin breaches. Every order books a positive gross profit.\n');
  }

  // ---- trade ---------------------------------------------------------------
  const { rows: trade } = await client.query(`
    select
      count(*)                                              as orders,
      coalesce(sum(revenue_pkr), 0)                         as revenue_pkr,
      coalesce(sum(cogs_pkr), 0)                            as cogs_pkr,
      coalesce(sum(coin_discount_pkr), 0)                   as coin_discount_pkr,
      coalesce(sum(gross_profit_pkr), 0)                    as gross_profit_pkr
    from order_economics`);
  const t = trade[0];
  rule('Trade, all time');
  process.stdout.write(
    `  orders            ${n(t.orders).padStart(12)}\n` +
    `  revenue           ${n(t.revenue_pkr).padStart(12)} PKR\n` +
    `  cost of goods     ${n(t.cogs_pkr).padStart(12)} PKR\n` +
    `  coin discount     ${n(t.coin_discount_pkr).padStart(12)} PKR\n` +
    `  gross profit      ${n(t.gross_profit_pkr).padStart(12)} PKR\n`,
  );
  if (Number(t.revenue_pkr) > 0) {
    const pct = (100 * Number(t.gross_profit_pkr)) / Number(t.revenue_pkr);
    process.stdout.write(`  gross margin      ${pct.toFixed(1).padStart(12)} %\n`);
    process.stdout.write(
      '\n  Note: gross profit is not net profit. Fulfilment eats 13–20% of order\n' +
      '  value even on a successful delivery, and every failed delivery is a\n' +
      '  pure loss — which is what the next section is about.\n',
    );
  }

  // ---- §7.5 RTO ------------------------------------------------------------
  // week::text so the date renders as 2026-08-17 rather than as whatever the
  // driver's Date object stringifies to.
  const { rows: rto } = await client.query(
    `select week::text as week, closed_orders, rto_orders, rto_pct,
            delivered_value_pkr, coins_burned
     from fulfilment_health order by week desc limit 8`);
  rule('Fulfilment — RTO is a first-class metric (§7.5). Target under 12%.');
  if (rto.length === 0) {
    process.stdout.write('  No closed orders yet.\n');
  } else {
    process.stdout.write(
      `  ${'week'.padEnd(12)}${'closed'.padStart(8)}${'rto'.padStart(6)}${'rto %'.padStart(8)}` +
      `${'delivered PKR'.padStart(15)}${'coins burned'.padStart(14)}\n`,
    );
    for (const w of rto) {
      const pct = w.rto_pct === null ? '—' : `${w.rto_pct}%`;
      const over = Number(w.rto_pct) > 12 ? '  ← above target' : '';
      process.stdout.write(
        `  ${w.week.padEnd(12)}${n(w.closed_orders).padStart(8)}` +
        `${n(w.rto_orders).padStart(6)}${pct.padStart(8)}` +
        `${n(w.delivered_value_pkr).padStart(15)}${n(w.coins_burned).padStart(14)}${over}\n`,
      );
    }
  }

  // ---- the coin float ------------------------------------------------------
  const { rows: liability } = await client.query('select * from coin_liability');
  const l = liability[0];
  rule('Coins outstanding');
  process.stdout.write(
    `  holders           ${n(l.holders).padStart(12)}\n` +
    `  coins live        ${n(l.coins_outstanding).padStart(12)}\n` +
    `  max discount      ${n(l.max_discount_pkr).padStart(12)} PKR  (if every coin were spent)\n` +
    `  expiring < 30d    ${n(l.expiring_within_30d).padStart(12)}\n` +
    '\n  §0 means this can never become a loss — every rupee of it comes out of\n' +
    '  realised margin. It is the number to tune the economy against.\n',
  );

  // ---- what the catalogue can discount -------------------------------------
  const { rows: margins } = await client.query('select * from catalogue_margins');
  rule('Catalogue');
  if (margins.length === 0) {
    process.stdout.write('  No products yet.\n');
  } else {
    process.stdout.write(
      `  ${'category'.padEnd(20)}${'products'.padStart(10)}${'stock'.padStart(8)}` +
      `${'margin'.padStart(9)}${'max disc'.padStart(10)}\n`,
    );
    for (const m of margins) {
      process.stdout.write(
        `  ${String(m.category).slice(0, 19).padEnd(20)}${n(m.products).padStart(10)}` +
        `${n(m.units_in_stock).padStart(8)}${`${m.avg_margin_pct}%`.padStart(9)}` +
        `${`${m.avg_max_discount_pct}%`.padStart(10)}\n`,
      );
    }
  }

  process.stdout.write('\n');
} finally {
  await client.end();
}

process.exit(breach ? 2 : 0);
