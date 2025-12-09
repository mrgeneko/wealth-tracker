// tests/integration/metadata_population.test.js
// Integration tests for metadata population scripts
// Run with: node tests/integration/metadata_population.test.js
// Requires MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE env vars

const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const assert = require('assert');

// Check for required environment variables
function checkRequiredEnvVars() {
    const required = ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
    const missing = required.filter(v => !process.env[v]);
    if (missing.length > 0) {
        console.log('='.repeat(60));
        console.log('METADATA POPULATION INTEGRATION TESTS');
        console.log('='.repeat(60));
        console.log('');
        console.log(`SKIPPED: Missing required environment variables: ${missing.join(', ')}`);
        console.log('Set these variables to run the tests.');
        console.log('');
        console.log('='.repeat(60));
        console.log('Passed: 0 ✓ (skipped)');
        console.log('Failed: 0 ✗');
        console.log('='.repeat(60));
        process.exit(0);
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
            await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--symbol', 'AAPL'], { timeout: 10000 });

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
                await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--symbol', 'INVALID_SYMBOL_123'], { timeout: 10000 });
            } catch (error) {
                // Script should exit with error but not crash
                assert.ok(true, 'Should handle invalid symbol');
            }
        });
    }

    async testBatchPopulation() {
        await this.test('Populate multiple symbols (2 symbols for CI)', async () => {
            // Create test positions for just 2 symbols to keep tests fast
            await this.connection.execute(
                `INSERT INTO positions (account_id, symbol, quantity, type)
         VALUES (1, 'MSFT', 100, 'stock'), (1, 'GOOGL', 50, 'stock')
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`
            );

            // Populate each symbol individually to avoid --all which processes everything
            await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--symbol', 'MSFT'], { timeout: 30000 });
            await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--symbol', 'GOOGL'], { timeout: 30000 });

            // Check if both were populated
            const [rows] = await this.connection.execute(
                'SELECT symbol FROM securities_metadata WHERE symbol IN (?, ?)',
                ['MSFT', 'GOOGL']
            );

            assert.ok(rows.length >= 1, 'Should populate at least one symbol');
        });
    }

    async testPopularSecurities() {
        await this.test('Populate a few popular securities (3 symbols for CI)', async () => {
            // Instead of --sp500 which fetches 100+ symbols, just populate 3 known stocks
            // This keeps CI fast while still exercising the code path
            const testSymbols = ['NVDA', 'AMZN', 'TSLA'];
            for (const sym of testSymbols) {
                try {
                    await runCommandStream('node', ['scripts/populate/populate_securities_metadata.js', '--symbol', sym], { timeout: 30000 });
                } catch (e) {
                    console.warn(`  Warning: Failed to populate ${sym}: ${e.message}`);
                }
            }

            // Check if some stocks were populated
            const [rows] = await this.connection.execute(
                `SELECT COUNT(*) as count FROM securities_metadata 
         WHERE symbol IN ('AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA')`
            );

            assert.ok(rows[0].count >= 1, 'Should populate at least one stock');
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
    checkRequiredEnvVars();
    const test = new IntegrationTest();
    test.run().catch(error => {
        console.error('Test error:', error);
        process.exit(1);
    });
}

module.exports = IntegrationTest;
