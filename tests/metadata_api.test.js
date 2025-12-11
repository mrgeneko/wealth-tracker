// tests/metadata_api.test.js
// Test suite for metadata API endpoints
// Run with: npm test or node tests/metadata_api.test.js

const assert = require('assert');
const mysql = require('mysql2/promise');

// Test configuration
const TEST_DB_CONFIG = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
};

const TEST_SYMBOLS = {
    valid: 'AAPL',
    invalid: 'INVALID123',
    etf: 'SPY',
    future: 'GC=F'
};

class MetadataAPITest {
    constructor() {
        this.connection = null;
        this.passed = 0;
        this.failed = 0;
        this.tests = [];
    }

    async setup() {
        console.log('Setting up test environment...\n');
        this.connection = await mysql.createConnection(TEST_DB_CONFIG);
    }

    async teardown() {
        if (this.connection) {
            await this.connection.end();
        }
    }

    async test(name, fn) {
        process.stdout.write(`  ${name}... `);
        try {
            await fn();
            console.log('✓ PASS');
            this.passed++;
            this.tests.push({ name, status: 'PASS' });
        } catch (error) {
            console.log(`✗ FAIL`);
            console.log(`    Error: ${error.message}`);
            this.failed++;
            this.tests.push({ name, status: 'FAIL', error: error.message });
        }
    }

    // Test: Database schema exists
    async testSchemaExists() {
        await this.test('securities_metadata table exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW TABLES LIKE 'securities_metadata'`
            );
            assert.strictEqual(rows.length, 1, 'Table should exist');
        });

        await this.test('securities_earnings table exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW TABLES LIKE 'securities_earnings'`
            );
            assert.strictEqual(rows.length, 1, 'Table should exist');
        });

        await this.test('securities_dividends table exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW TABLES LIKE 'securities_dividends'`
            );
            assert.strictEqual(rows.length, 1, 'Table should exist');
        });

        await this.test('positions.metadata_symbol column exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW COLUMNS FROM positions LIKE 'metadata_symbol'`
            );
            assert.strictEqual(rows.length, 1, 'Column should exist');
        });
    }

    // Test: Metadata insertion
    async testMetadataInsertion() {
        await this.test('Insert test metadata', async () => {
            await this.connection.execute(
                `INSERT INTO securities_metadata (ticker, quote_type, short_name, currency)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE short_name = VALUES(short_name)`,
                ['TEST', 'EQUITY', 'Test Company', 'USD']
            );

            const [rows] = await this.connection.execute(
                'SELECT * FROM securities_metadata WHERE ticker = ?',
                ['TEST']
            );
            assert.strictEqual(rows.length, 1, 'Should insert one row');
            assert.strictEqual(rows[0].ticker, 'TEST');
            assert.strictEqual(rows[0].quote_type, 'EQUITY');
        });

        await this.test('Unique constraint on symbol', async () => {
            try {
                await this.connection.execute(
                    `INSERT INTO securities_metadata (ticker, quote_type) VALUES (?, ?)`,
                    ['TEST', 'ETF']
                );
                throw new Error('Should have thrown duplicate key error');
            } catch (error) {
                assert.ok(error.message.includes('Duplicate'), 'Should enforce unique constraint');
            }
        });
    }

    // Test: Foreign key relationships
    async testForeignKeys() {
        await this.test('Earnings foreign key to metadata', async () => {
            // Should succeed with valid symbol
            await this.connection.execute(
                `INSERT INTO securities_earnings (ticker, earnings_date)
         VALUES (?, NOW())
         ON DUPLICATE KEY UPDATE earnings_date = VALUES(earnings_date)`,
                ['TEST']
            );

            // Should fail with invalid symbol
            try {
                await this.connection.execute(
                    `INSERT INTO securities_earnings (ticker, earnings_date)
           VALUES (?, NOW())`,
                    ['NONEXISTENT']
                );
                throw new Error('Should have thrown foreign key error');
            } catch (error) {
                assert.ok(error.message.includes('foreign key') || error.message.includes('Cannot add'),
                    'Should enforce foreign key');
            }
        });

        await this.test('Cascade delete on metadata removal', async () => {
            // Insert test data
            await this.connection.execute(
                `INSERT INTO securities_metadata (ticker, quote_type) 
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE quote_type = VALUES(quote_type)`,
                ['TESTDEL', 'EQUITY']
            );

            await this.connection.execute(
                `INSERT INTO securities_earnings (ticker, earnings_date)
         VALUES (?, NOW())`,
                ['TESTDEL']
            );

            // Delete metadata
            await this.connection.execute(
                'DELETE FROM securities_metadata WHERE ticker = ?',
                ['TESTDEL']
            );

            // Check earnings was cascaded
            const [rows] = await this.connection.execute(
                'SELECT * FROM securities_earnings WHERE ticker = ?',
                ['TESTDEL']
            );
            assert.strictEqual(rows.length, 0, 'Should cascade delete');
        });
    }

    // Test: Indexes
    async testIndexes() {
        await this.test('Symbol index exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW INDEX FROM securities_metadata WHERE Key_name = 'idx_symbol'`
            );
            assert.ok(rows.length > 0, 'Symbol index should exist');
        });

        await this.test('Quote type index exists', async () => {
            const [rows] = await this.connection.execute(
                `SHOW INDEX FROM securities_metadata WHERE Key_name = 'idx_quote_type'`
            );
            assert.ok(rows.length > 0, 'Quote type index should exist');
        });
    }

    // Test: Query performance
    async testQueries() {
        await this.test('Portfolio query with metadata join', async () => {
            const [rows] = await this.connection.execute(`
        SELECT 
          p.ticker,
          p.quantity,
          COALESCE(sm.long_name, p.ticker) as display_name,
          sm.quote_type
        FROM positions p
        LEFT JOIN securities_metadata sm ON p.metadata_symbol = sm.ticker
        LIMIT 10
      `);
            assert.ok(Array.isArray(rows), 'Should return array');
        });

        await this.test('Autocomplete search query', async () => {
            const [rows] = await this.connection.execute(`
        SELECT ticker, short_name, quote_type
        FROM securities_metadata
        WHERE ticker LIKE ? OR short_name LIKE ?
        LIMIT 20
      `, ['A%', '%Apple%']);
            assert.ok(Array.isArray(rows), 'Should return array');
        });
    }

    // Test: Data integrity
    async testDataIntegrity() {
        await this.test('NULL handling in optional fields', async () => {
            await this.connection.execute(
                `INSERT INTO securities_metadata (ticker, quote_type)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE quote_type = VALUES(quote_type)`,
                ['NULLTEST', 'EQUITY']
            );

            const [rows] = await this.connection.execute(
                'SELECT * FROM securities_metadata WHERE ticker = ?',
                ['NULLTEST']
            );
            assert.strictEqual(rows[0].dividend_yield, null, 'Should allow NULL');
            assert.strictEqual(rows[0].market_cap, null, 'Should allow NULL');
        });

        await this.test('DECIMAL precision for financial values', async () => {
            await this.connection.execute(
                `UPDATE securities_metadata 
         SET dividend_yield = ?, trailing_pe = ?
         WHERE ticker = ?`,
                [3.1415, 25.5678, 'NULLTEST']
            );

            const [rows] = await this.connection.execute(
                'SELECT dividend_yield, trailing_pe FROM securities_metadata WHERE ticker = ?',
                ['NULLTEST']
            );
            assert.strictEqual(rows[0].dividend_yield, '3.1415');
            assert.strictEqual(rows[0].trailing_pe, '25.5678');
        });
    }

    // Cleanup test data
    async cleanup() {
        await this.connection.execute(`DELETE FROM securities_metadata WHERE ticker IN ('TEST', 'NULLTEST')`);
    }

    async run() {
        console.log('='.repeat(60));
        console.log('METADATA API TEST SUITE');
        console.log('='.repeat(60));
        console.log('');

        await this.setup();

        console.log('Schema Tests:');
        await this.testSchemaExists();
        console.log('');

        console.log('Data Insertion Tests:');
        await this.testMetadataInsertion();
        console.log('');

        console.log('Foreign Key Tests:');
        await this.testForeignKeys();
        console.log('');

        console.log('Index Tests:');
        await this.testIndexes();
        console.log('');

        console.log('Query Tests:');
        await this.testQueries();
        console.log('');

        console.log('Data Integrity Tests:');
        await this.testDataIntegrity();
        console.log('');

        await this.cleanup();
        await this.teardown();

        console.log('='.repeat(60));
        console.log('TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total:  ${this.passed + this.failed}`);
        console.log(`Passed: ${this.passed} ✓`);
        console.log(`Failed: ${this.failed} ✗`);
        console.log('');

        if (this.failed > 0) {
            console.log('Failed tests:');
            this.tests.filter(t => t.status === 'FAIL').forEach(t => {
                console.log(`  - ${t.name}: ${t.error}`);
            });
            process.exit(1);
        } else {
            console.log('✓ All tests passed!');
            process.exit(0);
        }
    }
}

// Run tests if executed directly
if (require.main === module) {
    const test = new MetadataAPITest();
    test.run().catch(error => {
        console.error('Test suite error:', error);
        process.exit(1);
    });
}

module.exports = MetadataAPITest;
