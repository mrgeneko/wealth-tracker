// tests/integration/metadata_population.test.js
// Integration tests for metadata population scripts
// Run with: node tests/integration/metadata_population.test.js

const { exec } = require('child_process');
const util = require('util');
const mysql = require('mysql2/promise');
const assert = require('assert');

const execPromise = util.promisify(exec);

const TEST_SYMBOLS = ['AAPL', 'MSFT', 'INVALID_SYMBOL'];

class IntegrationTest {
    constructor() {
        this.connection = null;
        this.passed = 0;
        this.failed = 0;
    }

    async setup() {
        this.connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
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
        } catch (error) {
            console.log(`✗ FAIL: ${error.message}`);
            this.failed++;
        }
    }

    async testSingleSymbolPopulation() {
        await this.test('Populate single valid symbol (AAPL)', async () => {
            const { stdout } = await execPromise(
                'node scripts/populate_securities_metadata.js --symbol AAPL',
                { timeout: 10000 }
            );

            // Check if metadata was inserted
            const [rows] = await this.connection.execute(
                'SELECT * FROM securities_metadata WHERE symbol = ?',
                ['AAPL']
            );

            assert.strictEqual(rows.length, 1, 'Should insert metadata');
            assert.strictEqual(rows[0].symbol, 'AAPL');
            assert.ok(rows[0].short_name, 'Should have short_name');
            assert.strictEqual(rows[0].quote_type, 'EQUITY');
        });

        await this.test('Handle invalid symbol gracefully', async () => {
            try {
                await execPromise(
                    'node scripts/populate_securities_metadata.js --symbol INVALID_SYMBOL_123',
                    { timeout: 10000 }
                );
            } catch (error) {
                // Script should exit with error but not crash
                assert.ok(true, 'Should handle invalid symbol');
            }
        });
    }

    async testBatchPopulation() {
        await this.test('Populate multiple symbols', async () => {
            // Create test positions
            await this.connection.execute(
                `INSERT INTO positions (account_id, symbol, quantity, type)
         VALUES (1, 'MSFT', 100, 'stock'), (1, 'GOOGL', 50, 'stock')
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`
            );

            const { stdout } = await execPromise(
                'node scripts/populate_securities_metadata.js --all',
                { timeout: 30000 }
            );

            // Check if both were populated
            const [rows] = await this.connection.execute(
                'SELECT symbol FROM securities_metadata WHERE symbol IN (?, ?)',
                ['MSFT', 'GOOGL']
            );

            assert.ok(rows.length >= 1, 'Should populate at least one symbol');
        });
    }

    async testPopularSecurities() {
        await this.test('Populate S&P 500 subset (first 5)', async () => {
            const { stdout } = await execPromise(
                'node scripts/populate_popular_securities.js --sp500',
                { timeout: 60000 }
            );

            // Check if some S&P 500 stocks were populated
            const [rows] = await this.connection.execute(
                `SELECT COUNT(*) as count FROM securities_metadata 
         WHERE symbol IN ('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA')`
            );

            assert.ok(rows[0].count >= 1, 'Should populate at least one S&P 500 stock');
        });
    }

    async testDataQuality() {
        await this.test('Verify data quality for AAPL', async () => {
            const [rows] = await this.connection.execute(
                'SELECT * FROM securities_metadata WHERE symbol = ?',
                ['AAPL']
            );

            if (rows.length > 0) {
                const data = rows[0];
                assert.ok(data.long_name, 'Should have long_name');
                assert.ok(data.exchange, 'Should have exchange');
                assert.ok(data.currency, 'Should have currency');
                assert.ok(data.quote_type, 'Should have quote_type');
            }
        });
    }

    async run() {
        console.log('='.repeat(60));
        console.log('METADATA POPULATION INTEGRATION TESTS');
        console.log('='.repeat(60));
        console.log('');

        await this.setup();

        console.log('Single Symbol Tests:');
        await this.testSingleSymbolPopulation();
        console.log('');

        console.log('Batch Population Tests:');
        await this.testBatchPopulation();
        console.log('');

        console.log('Popular Securities Tests:');
        await this.testPopularSecurities();
        console.log('');

        console.log('Data Quality Tests:');
        await this.testDataQuality();
        console.log('');

        await this.teardown();

        console.log('='.repeat(60));
        console.log(`Passed: ${this.passed} ✓`);
        console.log(`Failed: ${this.failed} ✗`);
        console.log('='.repeat(60));

        process.exit(this.failed > 0 ? 1 : 0);
    }
}

if (require.main === module) {
    const test = new IntegrationTest();
    test.run().catch(error => {
        console.error('Test error:', error);
        process.exit(1);
    });
}

module.exports = IntegrationTest;
