// tests/integration/ttm_eps_adjusted.test.js
// Integration test validating adjusted EPS backfill and recompute TTM usage
// Run with: npm run test:integration or npm run test:all

require('dotenv').config();
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUN_DB_TESTS = ['1', 'true', 'yes'].includes(String(process.env.RUN_DB_TESTS || '').toLowerCase());
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

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

describeDb('TTM EPS Adjusted Integration Test', () => {
  let connection;

  beforeAll(async () => {
    // Check for required environment variables
    const required = ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE
    });

    // Initialize schema
    await initializeSchema(connection);
  }, 30000);

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  test('Adjusted EPS TTM calculation with stock splits', async () => {
    const sym = 'TTM_EPS_ADJ';

    // cleanup
    await connection.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]).catch(() => {});
    await connection.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]).catch(() => {});
    await connection.execute('DELETE FROM security_splits WHERE ticker = ?', [sym]).catch(() => {});
    await connection.execute('DELETE FROM securities_metadata WHERE ticker = ?', [sym]).catch(() => {});

    await connection.execute(`INSERT INTO securities_metadata (ticker, quote_type, short_name, currency) VALUES (?, 'EQUITY', 'EPS Adjust Test', 'USD')`, [sym]);

    // insert three earnings before split and one after split
    // For clarity: pre-split eps 1.0, 1.1, 1.2; then split (2-for-1) -> factor 0.5 -> post-split eps 0.6
    // adjusted eps should scale pre-split EPS by split factor

    const dates = [250, 170, 90, 30]; // days ago, descending older -> more recent
    const eps_vals = [1.0, 1.1, 1.2, 0.6]; // latest (30 days ago) 0.6 is after the split

    // Insert a split that occurred 75 days ago (so it will affect earnings older than 75 days)
    const splitDate = await isoDateDaysAgo(75); // split 75 days ago
    await connection.execute(`INSERT INTO security_splits (ticker, split_date, split_ratio) VALUES (?, ?, ?)`, [sym, splitDate, 0.5]);

    for (let i = 0; i < dates.length; i++) {
      const d = await isoDateDaysAgo(dates[i]);
      await connection.execute(`INSERT INTO securities_earnings (ticker, earnings_date, is_estimate, eps_actual, fiscal_quarter, fiscal_year, data_source) VALUES (?, ?, FALSE, ?, 'Q', 2025, 'test')`, [sym, d + ' 00:00:00', eps_vals[i]]);
    }

    // Backfill adjusted EPS
    await runScript('node', ['scripts/maintenance/backfill_adjusted_eps.js', '--symbol=TTM_EPS_ADJ', '--apply']);

    // Now recompute ttm to pick up adjusted eps
    await runScript('node', ['scripts/maintenance/recompute_ttm.js', '--symbol=TTM_EPS_ADJ', '--apply']);

    // expected adjusted eps: for pre-split entries (250 and 170 and 90 days ago), let's calculate:
    // splitDate = 75 days ago, so earnings at 250 and 170 and 90 days are before split; 30 days is after split
    // factor = product of splits after the earnings_date up to now = 0.5 for pre-split
    // adjusted: 1.0*0.5=0.5, 1.1*0.5=0.55, 1.2*0.5=0.6, 0.6*1=0.6 (post-split unchanged)
    // TTM uses the LAST 4 reported eps -> sum adjusted values = 0.5 + 0.55 + 0.6 + 0.6 = 2.25

    const [rows] = await connection.execute('SELECT ttm_eps, ttm_last_calculated_at FROM securities_metadata WHERE ticker = ?', [sym]);
    expect(rows.length).toBe(1);
    const ttmEps = parseFloat(rows[0].ttm_eps);

    expect(Math.abs(ttmEps - 2.25)).toBeLessThan(0.0001);

    // cleanup
    await connection.execute('DELETE FROM securities_earnings WHERE ticker = ?', [sym]);
    await connection.execute('DELETE FROM securities_dividends WHERE ticker = ?', [sym]);
    await connection.execute('DELETE FROM security_splits WHERE ticker = ?', [sym]);
    await connection.execute('DELETE FROM securities_metadata WHERE ticker = ?', [sym]);
  }, 60000);
});
