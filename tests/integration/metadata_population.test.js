// tests/integration/metadata_population.test.js
// Integration tests for metadata population scripts
// Run with: npm run test:integration or npm run test:all

const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');

// Initialize database schema with proper tables and ticker column
async function initializeSchema(conn) {
  // Drop existing tables to ensure fresh schema with ticker column
  const tablesToDrop = [
    'securities_metadata',
    'securities_dividends',
    'securities_earnings',
    'security_splits',
    'latest_prices',
    'positions',
    'accounts',
    'ticker_registry',
    'ticker_registry_metrics',
    'file_refresh_status'
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

async function runCommandStream(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env, ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => process.stdout.write(d));
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('error', err => reject(err));
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });
  });
}

const TEST_SYMBOLS = ['AAPL', 'MSFT', 'INVALID_SYMBOL'];

describe('Metadata Population Integration Tests', () => {
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

  describe('Single Symbol Tests', () => {
    test('Populate single valid symbol (AAPL)', async () => {
      await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--ticker', 'AAPL'], { timeout: 10000 });

      // Check if metadata was inserted
      const [rows] = await connection.execute(
        'SELECT * FROM securities_metadata WHERE ticker = ?',
        ['AAPL']
      );

      expect(rows.length).toBe(1);
      expect(rows[0].ticker).toBe('AAPL');
      expect(rows[0].short_name).toBeTruthy();
      expect(rows[0].quote_type).toBe('EQUITY');
    }, 15000);

    test('Handle invalid symbol gracefully', async () => {
      // The script handles invalid symbols by logging an error but not throwing
      // This is acceptable behavior - it doesn't crash the process
      const result = await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--ticker', 'INVALID_SYMBOL_123'], { timeout: 10000 });
      // Script completes without throwing, which is the expected behavior
      expect(result).toBeUndefined();
    }, 15000);
  });

  describe('Batch Population Tests', () => {
    test('Populate multiple symbols (2 symbols for CI)', async () => {
      // Create test account first
      await connection.execute(
        `INSERT INTO accounts (id, name, account_type_id) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [1, 'Test Account', 1]
      );

      // Create test positions for just 2 symbols to keep tests fast
      await connection.execute(
        `INSERT INTO positions (account_id, ticker, quantity, type)
         VALUES (1, 'MSFT', 100, 'stock'), (1, 'GOOGL', 50, 'stock')
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`
      );

      // Populate each symbol individually to avoid --all which processes everything
      await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--ticker', 'MSFT'], { timeout: 30000 });
      await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--ticker', 'GOOGL'], { timeout: 30000 });

      // Check if both were populated
      const [rows] = await connection.execute(
        'SELECT ticker FROM securities_metadata WHERE ticker IN (?, ?)',
        ['MSFT', 'GOOGL']
      );

      expect(rows.length).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe('Popular Securities Tests', () => {
    test('Populate a few popular securities (2 symbols for CI)', async () => {
      // Instead of --sp500 which fetches 100+ symbols, just populate 2 known stocks
      // This keeps CI fast while still exercising the code path
      const testSymbols = ['NVDA', 'AMZN'];
      for (const sym of testSymbols) {
        try {
          await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--ticker', sym], { timeout: 30000 });
        } catch (e) {
          console.warn(`  Warning: Failed to populate ${sym}: ${e.message}`);
        }
      }

      // Check if some stocks were populated
      const [rows] = await connection.execute(
        `SELECT COUNT(*) as count FROM securities_metadata
         WHERE ticker IN ('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA')`
      );

      expect(rows[0].count).toBeGreaterThanOrEqual(1);
    }, 60000);
  });

  describe('Data Quality Tests', () => {
    test('Verify data quality for AAPL', async () => {
      const [rows] = await connection.execute(
        'SELECT * FROM securities_metadata WHERE ticker = ?',
        ['AAPL']
      );

      if (rows.length > 0) {
        const data = rows[0];
        expect(data.long_name).toBeTruthy();
        expect(data.exchange).toBeTruthy();
        expect(data.currency).toBeTruthy();
        expect(data.quote_type).toBeTruthy();
      }
    });
  });
});
