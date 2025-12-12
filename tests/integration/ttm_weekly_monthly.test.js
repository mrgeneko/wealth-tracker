// tests/integration/ttm_weekly_monthly.test.js
// Integration tests for weekly and monthly dividend schedules
// Run with: npm run test:integration or npm run test:all

require('dotenv').config();
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

async function setupSymbol(conn, symbol) {
  // Cleanup any existing test data
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_dividends_backup WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM security_splits WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_metadata WHERE ticker = ?', [symbol]).catch(() => {});

  await conn.execute(`INSERT INTO securities_metadata (ticker, quote_type, short_name, currency) VALUES (?, 'ETF', ?, 'USD')`, [symbol, 'Integration Test Sym']);
}

async function cleanupSymbol(conn, symbol) {
  await conn.execute('DELETE FROM securities_earnings WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_dividends WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_dividends_backup WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM security_splits WHERE ticker = ?', [symbol]).catch(() => {});
  await conn.execute('DELETE FROM securities_metadata WHERE ticker = ?', [symbol]).catch(() => {});
}

describe('TTM Weekly/Monthly Dividend Integration Tests', () => {
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

    // Initialize schema before running tests
    await initializeSchema(connection);
  }, 30000);

  afterAll(async () => {
    if (connection) {
      await connection.end();
    }
  });

  test('Weekly dividend TTM calculation', async () => {
    const sym = 'TTM_WEEKLY';
    await setupSymbol(connection, sym);

    // Insert ~52 weekly payments (every 7 days) within the last 12 months
    const payments = 52;
    const perPayment = 0.02; // per-share amount

    for (let i = 0; i < payments; i++) {
      const daysAgo = i * 7; // 0,7,14 ... up to ~357 days
      const exd = await isoDateDaysAgo(daysAgo);
      await connection.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, status, data_source) VALUES (?, ?, ?, 'paid', 'test')`, [sym, exd, perPayment]);
    }

    // Run recompute for symbol
    await runScript('node', ['scripts/maintenance/recompute_ttm.js', '--symbol=TTM_WEEKLY', '--apply']);

    // verify TTM dividend amount equals sum of payments within 12 months
    const [rows] = await connection.execute('SELECT ttm_dividend_amount FROM securities_metadata WHERE ticker = ?', [sym]);
    expect(rows.length).toBe(1);
    const ttm = parseFloat(rows[0].ttm_dividend_amount);
    const expected = payments * perPayment;

    // allow tiny numeric tolerance
    expect(Math.abs(ttm - expected)).toBeLessThan(0.0001);

    await cleanupSymbol(connection, sym);
  }, 60000);

  test('Monthly dividend TTM calculation', async () => {
    const sym = 'TTM_MONTHLY';
    await setupSymbol(connection, sym);

    // Insert 12 monthly payments approx every 30 days
    const months = 12;
    const perPayment = 0.10;

    for (let i = 0; i < months; i++) {
      const daysAgo = i * 30; // approximate month spacing
      const exd = await isoDateDaysAgo(daysAgo);
      await connection.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, status, data_source) VALUES (?, ?, ?, 'paid', 'test')`, [sym, exd, perPayment]);
    }

    // also add a special non-cash dividend that should be ignored if policy excludes non-cash
    await connection.execute(`INSERT INTO securities_dividends (ticker, ex_dividend_date, dividend_amount, dividend_type, status, data_source) VALUES (?, ?, ?, 'STOCK', 'paid', 'test')`, [sym, await isoDateDaysAgo(15), 5.0]);

    // Backfill adjusted_dividend_amount (no splits present, so same as raw)
    await runScript('node', ['scripts/archive/backfill_adjusted_dividends.js', '--symbol=' + sym, '--apply']);

    // Recompute TTM (should include only cash payments by current recompute logic)
    await runScript('node', ['scripts/maintenance/recompute_ttm.js', '--symbol=' + sym, '--apply']);

    // Check stored TTM dividend amount
    const [rows] = await connection.execute('SELECT ttm_dividend_amount FROM securities_metadata WHERE ticker = ?', [sym]);
    expect(rows.length).toBe(1);
    const ttm = parseFloat(rows[0].ttm_dividend_amount);
    const expected = months * perPayment; // stock dividend should not be included by default computation (dividend_type='STOCK')

    expect(Math.abs(ttm - expected)).toBeLessThan(0.0001);

    await cleanupSymbol(connection, sym);
  }, 60000);
});
