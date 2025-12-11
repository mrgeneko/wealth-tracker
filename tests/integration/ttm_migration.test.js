// tests/integration/ttm_migration.test.js
// Integration test for migration scripts: dedupe -> backfill -> recompute TTM
// Run with: node tests/integration/ttm_migration.test.js

require('dotenv').config();
const assert = require('assert');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DB_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};

async function initializeSchema(conn) {
  // Drop existing tables to ensure fresh schema with ticker column
  const tablesToDrop = [
    'securities_metadata',
    'securities_dividends', 
    'securities_earnings',
    'security_splits',
    'latest_prices',
    'positions',
    'accounts'
  ];
  
  try {
    await conn.execute('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tablesToDrop) {
      try {
        await conn.execute(`DROP TABLE IF EXISTS ${table}`);
      } catch (err) {
        // Ignore errors
      }
    }
    await conn.execute('SET FOREIGN_KEY_CHECKS = 1');
  } catch (err) {
    console.warn('Warning dropping tables:', err.message);
  }
  
  // Read and execute init scripts
  const baseSchemaPath = path.join(__dirname, '../..', 'scripts/init-db/000-base-schema.sql');
  const symbolRegistryPath = path.join(__dirname, '../..', 'scripts/init-db/001-symbol-registry.sql');

  if (fs.existsSync(baseSchemaPath)) {
    const baseSchema = fs.readFileSync(baseSchemaPath, 'utf8');
    // Split by semicolon and execute each statement
    const statements = baseSchema.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        console.warn('Warning executing schema statement:', err.message);
      }
    }
  }

  if (fs.existsSync(symbolRegistryPath)) {
    const symbolRegistry = fs.readFileSync(symbolRegistryPath, 'utf8');
    const statements = symbolRegistry.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        console.warn('Warning executing schema statement:', err.message);
      }
    }
  }
}

async function runScript(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, env: process.env });
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

async function isoDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const conn = await mysql.createConnection(TEST_DB_CONFIG);
  
  try {
    // Initialize schema
    await initializeSchema(conn);
  } catch (err) {
    console.error('Failed to initialize schema:', err);
  }

  const sym = 'TTMTEST';

  // Ensure clean slate
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_dividends_backup WHERE ticker = ?', [sym]).catch(() => {});
  await conn.execute('DELETE FROM security_splits WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_metadata WHERE ticker = ?', [sym]);

  // Insert metadata row
  await conn.execute(`INSERT INTO securities_metadata (ticker, quote_type, short_name, currency) VALUES (?, 'EQUITY', 'TTM Test Corp', 'USD')`, [sym]);

  // Create a split that happened 90 days ago (2-for-1 => factor 0.5)
  const splitDate = await isoDateDaysAgo(90);
  await conn.execute(`INSERT INTO security_splits (ticker, split_date, split_ratio) VALUES (?, ?, ?)`, [sym, splitDate, 0.5]);

  // Insert dividend rows - one 300 days ago (outside TTM), one 200 days ago (inside), one 60 days ago (inside)
  const exOld = await isoDateDaysAgo(400); // outside 12 months (>365 days)
  const exMid = await isoDateDaysAgo(200); // inside 12 months
  const exRecent = await isoDateDaysAgo(60); // inside

  // Pre-split dividend had amount 2.00 on exMid; split later makes factor 0.5 -> adjusted 1.00
  await conn.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, status, data_source) VALUES (?, ?, ?, 'paid', 'test')`, [sym, exMid, 2.0]);
  // Another dividend amount should be counted as-is
  await conn.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, status, data_source) VALUES (?, ?, ?, 'paid', 'test')`, [sym, exRecent, 0.5]);
  // Old dividend outside window
  await conn.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, status, data_source) VALUES (?, ?, ?, 'paid', 'test')`, [sym, exOld, 5.0]);

  // Insert four quarterly earnings (eps_actual)
  const epsDates = [30, 120, 210, 300]; // days ago (desc order example)
  const epsVals = [0.5, 0.7, 0.8, 0.9]; // latest should be 0.5

  for (let i = 0; i < epsDates.length; i++) {
    const d = await isoDateDaysAgo(epsDates[i]);
    await conn.execute(`INSERT INTO securities_earnings (ticker, earnings_date, is_estimate, eps_actual, fiscal_quarter, fiscal_year, data_source) VALUES (?, ?, FALSE, ?, 'Q${i+1}', 2025, 'test')`, [sym, d + ' 00:00:00', epsVals[i]]);
  }

  // Run backfill to compute adjusted_dividend_amount
  console.log('\n[TEST] Running backfill_adjusted_dividends.js --symbol=TTMTEST --apply');
  await runScript('node', ['scripts/archive/backfill_adjusted_dividends.js', '--symbol=TTMTEST', '--apply']);

  // Now recompute TTM
  console.log('\n[TEST] Running recompute_ttm.js --symbol=TTMTEST --apply');
  await runScript('node', ['scripts/maintenance/recompute_ttm.js', '--symbol=TTMTEST', '--apply']);

  // Verify results
  const [metaRows] = await conn.execute('SELECT ttm_dividend_amount, ttm_eps, ttm_last_calculated_at FROM securities_metadata WHERE ticker = ?', [sym]);
  assert.strictEqual(metaRows.length, 1, 'metadata row must exist');
  const ttmDiv = parseFloat(metaRows[0].ttm_dividend_amount);
  const ttmEps = parseFloat(metaRows[0].ttm_eps);
  console.log('\n[TEST] metadata values:', metaRows[0]);

  // ttm dividends should include only mid (adjusted) and recent
  // mid: dividend 2.0 adjusted by factor 0.5 => 1.0, recent: 0.5 => total 1.5
  assert(Math.abs(ttmDiv - 1.5) < 0.0001, `Expected ttm_dividend_amount ~1.5 got ${ttmDiv}`);

  // ttm eps should be latest 4 eps values (0.5 + 0.7 + 0.8 + 0.9 = 2.9)
  assert(Math.abs(ttmEps - 2.9) < 0.0001, `Expected ttm_eps 2.9 got ${ttmEps}`);

  console.log('\n[TEST] TTM values are correct. Cleaning up test data.');

  // Cleanup
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_dividends_backup WHERE ticker = ?', [sym]).catch(() => {});
  await conn.execute('DELETE FROM security_splits WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_metadata WHERE ticker = ?', [sym]);

  await conn.end();
  console.log('\n[TEST] Completed successfully');
  process.exit(0);
}

main().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
