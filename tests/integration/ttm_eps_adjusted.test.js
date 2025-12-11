// tests/integration/ttm_eps_adjusted.test.js
// Integration test validating adjusted EPS backfill and recompute TTM usage
// Run with: node tests/integration/ttm_eps_adjusted.test.js

require('dotenv').config();
const assert = require('assert');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');

const TEST_DB_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE
};

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
  const sym = 'TTM_EPS_ADJ';

  // cleanup
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]).catch(() => {});
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]).catch(() => {});
  await conn.execute('DELETE FROM security_splits WHERE ticker = ?', [sym]).catch(() => {});
  await conn.execute('DELETE FROM securities_metadata WHERE ticker = ?', [sym]).catch(() => {});

  await conn.execute(`INSERT INTO securities_metadata (ticker, quote_type, short_name, currency) VALUES (?, 'EQUITY', 'EPS Adjust Test', 'USD')`, [sym]);

  // insert three earnings before split and one after split
  // For clarity: pre-split eps 1.0, 1.1, 1.2; then split (2-for-1) -> factor 0.5 -> post-split eps 0.6
  // adjusted eps should scale pre-split EPS by split factor

  const dates = [250, 170, 90, 30]; // days ago, descending older -> more recent
  const eps_vals = [1.0, 1.1, 1.2, 0.6]; // latest (30 days ago) 0.6 is after the split

  // Insert a split that occurred 75 days ago (so it will affect earnings older than 75 days)
  const splitDate = await isoDateDaysAgo(75); // split 75 days ago
  await conn.execute(`INSERT INTO security_splits (ticker, split_date, split_ratio) VALUES (?, ?, ?)`, [sym, splitDate, 0.5]);

  for (let i = 0; i < dates.length; i++) {
    const d = await isoDateDaysAgo(dates[i]);
    await conn.execute(`INSERT INTO securities_earnings (ticker, earnings_date, is_estimate, eps_actual, fiscal_quarter, fiscal_year, data_source) VALUES (?, ?, FALSE, ?, 'Q', 2025, 'test')`, [sym, d + ' 00:00:00', eps_vals[i]]);
  }

  // Backfill adjusted EPS
  console.log('\n[TEST] Running backfill_adjusted_eps.js --symbol=TTM_EPS_ADJ --apply');
  await runScript('node', ['scripts/archive/backfill_adjusted_eps.js', '--symbol=TTM_EPS_ADJ', '--apply']);

  // Now recompute ttm to pick up adjusted eps
  console.log('\n[TEST] Running recompute_ttm.js --symbol=TTM_EPS_ADJ --apply');
  await runScript('node', ['scripts/maintenance/recompute_ttm.js', '--symbol=TTM_EPS_ADJ', '--apply']);

  // expected adjusted eps: for pre-split entries (250 and 170 days ago and 90 days ago?), let's calculate:
  // splitDate = 75 days ago, so earnings at 250 and 170 and 90 days are before split; 30 days is after split
  // factor = product of splits after the earnings_date up to now = 0.5 for pre-split
  // adjusted: 1.0*0.5=0.5, 1.1*0.5=0.55, 1.2*0.5=0.6, 0.6*1=0.6 (post-split unchanged)
  // TTM uses the LAST 4 reported eps -> sum adjusted values = 0.5 + 0.55 + 0.6 + 0.6 = 2.25

  const [rows] = await conn.execute('SELECT ttm_eps, ttm_last_calculated_at FROM securities_metadata WHERE ticker = ?', [sym]);
  assert.strictEqual(rows.length, 1, 'metadata row should exist');
  const ttmEps = parseFloat(rows[0].ttm_eps);

  assert(Math.abs(ttmEps - 2.25) < 0.0001, `Expected adjusted TTM EPS 2.25 got ${ttmEps}`);

  console.log('[OK] Adjusted EPS TTM validated for', sym, 'value=', ttmEps);

  // cleanup
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]);
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]);
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
