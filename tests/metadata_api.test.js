// tests/metadata_api.test.js
// Test suite for metadata API endpoints
// Run with: npm test or npm run test:all

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const TEST_SYMBOLS = {
  valid: 'AAPL',
  invalid: 'INVALID123',
  etf: 'SPY',
  future: 'GC=F'
};

// Initialize database schema from consolidated init script
async function initializeSchema(conn) {
  const baseSchemaPath = path.join(__dirname, '..', 'scripts/init-db/000-base-schema.sql');

  if (fs.existsSync(baseSchemaPath)) {
    const baseSchema = fs.readFileSync(baseSchemaPath, 'utf8');
    const statements = baseSchema.split(';').filter(s => s.trim().length > 0);
    for (const statement of statements) {
      try {
        await conn.query(statement);
      } catch (err) {
        console.warn('Warning executing schema statement:', err.message);
      }
    }
  }
}

describe('Metadata API Test Suite', () => {
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
      try {
        await connection.execute(`DELETE FROM securities_metadata WHERE ticker IN ('TEST', 'NULLTEST', 'CASCADE_TEST', 'DEFAULT_TEST')`);
      } catch (e) {
        // Ignore cleanup errors
      }
      await connection.end();
    }
  });

  describe('Schema Tests', () => {
    test('securities_metadata table exists', async () => {
      const [rows] = await connection.execute(
        `SHOW TABLES LIKE 'securities_metadata'`
      );
      expect(rows.length).toBe(1);
    });

    test('securities_earnings table exists', async () => {
      const [rows] = await connection.execute(
        `SHOW TABLES LIKE 'securities_earnings'`
      );
      expect(rows.length).toBe(1);
    });

    test('securities_dividends table exists', async () => {
      const [rows] = await connection.execute(
        `SHOW TABLES LIKE 'securities_dividends'`
      );
      expect(rows.length).toBe(1);
    });

    test('positions.ticker column exists', async () => {
      const [rows] = await connection.execute(
        `SHOW COLUMNS FROM positions LIKE 'ticker'`
      );
      expect(rows.length).toBe(1);
    });
  });

  describe('Data Insertion Tests', () => {
    test('Insert test metadata', async () => {
      await connection.execute(
        `INSERT INTO securities_metadata (ticker, quote_type, short_name, currency)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE short_name = VALUES(short_name)`,
        ['TEST', 'EQUITY', 'Test Company', 'USD']
      );

      const [rows] = await connection.execute(
        'SELECT * FROM securities_metadata WHERE ticker = ?',
        ['TEST']
      );
      expect(rows.length).toBe(1);
      expect(rows[0].ticker).toBe('TEST');
      expect(rows[0].quote_type).toBe('EQUITY');
    });

    test('Unique constraint on symbol', async () => {
      await expect(connection.execute(
        `INSERT INTO securities_metadata (ticker, quote_type) VALUES (?, ?)`,
        ['TEST', 'ETF']
      )).rejects.toThrow();
    });
  });

  describe('Foreign Key Tests', () => {
    test('Earnings foreign key to metadata', async () => {
      // Should succeed with valid symbol
      await connection.execute(
        `INSERT INTO securities_earnings (ticker, earnings_date)
         VALUES (?, NOW())
         ON DUPLICATE KEY UPDATE earnings_date = VALUES(earnings_date)`,
        ['TEST']
      );

      // Should fail with invalid symbol
      await expect(connection.execute(
        `INSERT INTO securities_earnings (ticker, earnings_date)
         VALUES (?, NOW())`,
        ['NONEXISTENT']
      )).rejects.toThrow();
    });

    test('Cascade delete on metadata removal', async () => {
      // Insert test data
      await connection.execute(
        `INSERT INTO securities_metadata (ticker, quote_type)
         VALUES (?, ?)`,
        ['CASCADE_TEST', 'EQUITY']
      );

      await connection.execute(
        `INSERT INTO securities_earnings (ticker, earnings_date)
         VALUES (?, NOW())`,
        ['CASCADE_TEST']
      );

      // Verify data exists
      let [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM securities_earnings WHERE ticker = ?',
        ['CASCADE_TEST']
      );
      expect(rows[0].count).toBeGreaterThan(0);

      // Delete metadata - should cascade to earnings
      await connection.execute(
        'DELETE FROM securities_metadata WHERE ticker = ?',
        ['CASCADE_TEST']
      );

      // Verify earnings were deleted
      [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM securities_earnings WHERE ticker = ?',
        ['CASCADE_TEST']
      );
      expect(rows[0].count).toBe(0);
    });
  });

  describe('Index Tests', () => {
    test('ticker index on securities_metadata', async () => {
      const [rows] = await connection.execute(
        `SHOW INDEX FROM securities_metadata WHERE Column_name = 'ticker'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    test('ticker index on securities_earnings', async () => {
      const [rows] = await connection.execute(
        `SHOW INDEX FROM securities_earnings WHERE Column_name = 'ticker'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    test('earnings_date index on securities_earnings', async () => {
      const [rows] = await connection.execute(
        `SHOW INDEX FROM securities_earnings WHERE Column_name = 'earnings_date'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  describe('Query Tests', () => {
    test('SELECT with WHERE clause', async () => {
      const [rows] = await connection.execute(
        'SELECT ticker, quote_type FROM securities_metadata WHERE ticker = ?',
        ['TEST']
      );
      expect(rows.length).toBe(1);
      expect(rows[0].ticker).toBe('TEST');
    });

    test('JOIN between metadata and earnings', async () => {
      const [rows] = await connection.execute(`
        SELECT m.ticker, m.quote_type, e.earnings_date
        FROM securities_metadata m
        LEFT JOIN securities_earnings e ON m.ticker = e.ticker
        WHERE m.ticker = ?
        LIMIT 1
      `, ['TEST']);

      expect(rows.length).toBe(1);
      expect(rows[0].ticker).toBe('TEST');
    });

    test('ORDER BY and LIMIT', async () => {
      const [rows] = await connection.execute(
        'SELECT ticker FROM securities_metadata ORDER BY ticker LIMIT 5'
      );
      expect(rows.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Data Integrity Tests', () => {
    test('NOT NULL constraints', async () => {
      // Try to insert with null ticker
      await expect(connection.execute(
        'INSERT INTO securities_metadata (quote_type) VALUES (?)',
        ['EQUITY']
      )).rejects.toThrow();
    });

    test('DEFAULT values', async () => {
      await connection.execute(
        `INSERT INTO securities_metadata (ticker, quote_type)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE quote_type = VALUES(quote_type)`,
        ['DEFAULT_TEST', 'EQUITY']
      );

      const [rows] = await connection.execute(
        'SELECT * FROM securities_metadata WHERE ticker = ?',
        ['DEFAULT_TEST']
      );

      expect(rows.length).toBe(1);
      // Check that default values are set (if any)
    });

    test('Data type validation', async () => {
      // Test numeric fields
      await connection.execute(
        `UPDATE securities_metadata
         SET dividend_yield = ?, trailing_pe = ?
         WHERE ticker = ?`,
        [3.1415, 25.5678, 'TEST']
      );

      const [rows] = await connection.execute(
        'SELECT dividend_yield, trailing_pe FROM securities_metadata WHERE ticker = ?',
        ['TEST']
      );

      expect(rows.length).toBe(1);
      expect(rows[0].dividend_yield).toBe('3.1415');
      expect(rows[0].trailing_pe).toBe('25.5678');
    });
  });

  // Cleanup test data (handled in afterAll hook above)
});
