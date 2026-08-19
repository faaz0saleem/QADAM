#!/usr/bin/env node
// Rebuilds a throwaway database from supabase/migrations and runs the suite
// against it, so every test runs on exactly the SQL that ships.
//
//   npm test              build, test, drop
//   npm run test:keep     build, test, leave the database for inspection
//   npm run db:apply      build only
//
// Point ADMIN_DATABASE_URL at any Postgres 15+ you can create databases on:
//   local install     postgres://postgres:postgres@localhost:5432/postgres   (default)
//   supabase start    postgres://postgres:postgres@localhost:54322/postgres

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');

const ADMIN_URL =
  process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const DB_NAME = process.env.TEST_DB_NAME ?? 'qadam_test';
const keep = process.argv.includes('--keep');
const applyOnly = process.argv.includes('--apply-only');

const testUrl = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${DB_NAME}`;
  return u.toString();
})();

async function admin(sql) {
  const c = new pg.Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    return await c.query(sql);
  } finally {
    await c.end();
  }
}

async function applyMigrations() {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`no migrations found in ${migrationsDir}`);

  const c = new pg.Client({ connectionString: testUrl });
  await c.connect();
  try {
    for (const f of files) {
      const sql = await readFile(join(migrationsDir, f), 'utf8');
      try {
        await c.query(sql);
      } catch (err) {
        err.message = `migration ${f} failed:\n  ${err.message}`;
        throw err;
      }
      process.stdout.write(`  applied ${f}\n`);
    }
  } finally {
    await c.end();
  }
  return files.length;
}

// Database tests live next to this runner; pure unit tests live beside the code
// they cover. Both run in one pass so `npm test` is the whole story.
const UNIT_DIRS = [join(repoRoot, 'src', 'lib'), join(repoRoot, 'src', 'i18n')];

async function testFiles() {
  const found = [];
  for (const dir of [here, ...UNIT_DIRS]) {
    let entries = [];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // directory not created yet
    }
    for (const f of entries.filter((n) => n.endsWith('.test.mjs')).sort()) {
      found.push(join(dir, f));
    }
  }
  return found;
}

function runTests(files) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=spec', ...files],
      { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: testUrl } },
    );
    child.on('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  process.stdout.write(`\nrebuilding ${DB_NAME}\n`);
  await admin(`drop database if exists ${DB_NAME} with (force)`);
  await admin(`create database ${DB_NAME}`);
  const n = await applyMigrations();
  process.stdout.write(`${n} migrations applied\n\n`);

  if (applyOnly) {
    process.stdout.write(`database ready: ${testUrl}\n`);
    return 0;
  }

  const code = await runTests(await testFiles());

  if (!keep) {
    await admin(`drop database if exists ${DB_NAME} with (force)`);
  } else {
    process.stdout.write(`\nkept: ${testUrl}\n`);
  }
  return code;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`\n${err.message}\n`);
    process.exit(1);
  },
);
