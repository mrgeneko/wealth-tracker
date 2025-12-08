// scripts/populate_popular_securities.js
// Background job to populate metadata for popular securities
// Runs with throttling to avoid overwhelming Yahoo Finance API
// Usage: node scripts/populate_popular_securities.js [--sp500] [--trending] [--all]

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Import the populate functions from the main script
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const THROTTLE_DELAY_MS = parseInt(process.env.POPULAR_SECURITIES_DELAY_MS || '2000'); // 2 seconds between symbols
const BATCH_SIZE = parseInt(process.env.POPULAR_SECURITIES_BATCH_SIZE || '50'); // Process 50 at a time
const MAX_RETRIES = 3;

// S&P 500 ticker list (top 100 for example - you can expand this)
const SP500_TICKERS = [
    // Technology
    'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'ORCL',
    'ADBE', 'CRM', 'AMD', 'CSCO', 'ACN', 'INTC', 'IBM', 'QCOM', 'TXN', 'INTU',

    // Financials
    'BRK.B', 'JPM', 'V', 'MA', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'BLK',
    'SPGI', 'C', 'SCHW', 'CB', 'PGR', 'MMC', 'AON', 'ICE', 'CME', 'USB',

    // Healthcare
    'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'PFE', 'BMY',
    'AMGN', 'CVS', 'MDT', 'GILD', 'CI', 'ISRG', 'REGN', 'VRTX', 'ZTS', 'BSX',

    // Consumer
    'WMT', 'HD', 'PG', 'COST', 'KO', 'PEP', 'MCD', 'NKE', 'SBUX', 'TGT',
    'LOW', 'TJX', 'EL', 'MDLZ', 'CL', 'KMB', 'GIS', 'HSY', 'K', 'CPB',

    // Energy
    'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'MPC', 'PSX', 'VLO', 'OXY', 'HAL',

    // Industrials
    'UPS', 'HON', 'UNP', 'RTX', 'BA', 'CAT', 'GE', 'LMT', 'DE', 'MMM'
];

// Popular ETFs
const POPULAR_ETFS = [
    'SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO', 'VUG', 'VTV', 'ARKK', 'ARKG',
    'VGT', 'XLF', 'XLE', 'XLV', 'XLK', 'XLI', 'XLP', 'XLU', 'XLB', 'XLRE',
    'EEM', 'VWO', 'IEMG', 'EFA', 'VEA', 'VXUS', 'AGG', 'BND', 'TLT', 'SHY',
    'GLD', 'SLV', 'USO', 'UNG', 'SGOV', 'QQQM', 'SCHG', 'BKLC', 'QLD', 'QQUP'
];

// Trending tickers (you can update this list periodically or fetch from an API)
const TRENDING_TICKERS = [
    'NVDA', 'TSLA', 'PLTR', 'SOFI', 'RIVN', 'LCID', 'NIO', 'COIN', 'HOOD', 'RBLX'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDbConnection() {
    return await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });
}

async function checkIfMetadataExists(connection, symbol) {
    const [rows] = await connection.execute(
        'SELECT symbol, last_updated FROM securities_metadata WHERE symbol = ?',
        [symbol]
    );
    return rows.length > 0 ? rows[0] : null;
}

async function fetchMetadataForSymbol(symbol) {
    try {
        const { stdout, stderr } = await execPromise(
            `node scripts/populate_securities_metadata.js --symbol ${symbol}`,
            { cwd: path.join(__dirname, '..'), timeout: 10000 }
        );
        return { success: true, output: stdout };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function processSymbolList(connection, symbols, options = {}) {
    const {
        skipExisting = true,
        maxAge = 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
        onProgress = null
    } = options;

    const results = {
        total: symbols.length,
        skipped: 0,
        fetched: 0,
        failed: 0,
        errors: []
    };

    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const progress = `[${i + 1}/${symbols.length}]`;

        if (onProgress) {
            onProgress({ current: i + 1, total: symbols.length, symbol });
        }

        try {
            // Check if metadata exists
            const existing = await checkIfMetadataExists(connection, symbol);

            if (existing && skipExisting) {
                // Check if it's recent enough
                const age = Date.now() - new Date(existing.last_updated).getTime();
                if (age < maxAge) {
                    console.log(`${progress} ${symbol} - Skipped (cached, ${Math.floor(age / (24 * 60 * 60 * 1000))} days old)`);
                    results.skipped++;
                    continue;
                }
            }

            // Fetch metadata
            console.log(`${progress} ${symbol} - Fetching...`);
            const result = await fetchMetadataForSymbol(symbol);

            if (result.success) {
                console.log(`${progress} ${symbol} - ✓ Success`);
                results.fetched++;
            } else {
                console.log(`${progress} ${symbol} - ✗ Failed: ${result.error}`);
                results.failed++;
                results.errors.push({ symbol, error: result.error });
            }

        } catch (error) {
            console.error(`${progress} ${symbol} - ✗ Error: ${error.message}`);
            results.failed++;
            results.errors.push({ symbol, error: error.message });
        }

        // Throttle to avoid overwhelming the API
        if (i < symbols.length - 1) {
            await sleep(THROTTLE_DELAY_MS);
        }
    }

    return results;
}

async function main() {
    const args = process.argv.slice(2);
    const sp500Flag = args.includes('--sp500');
    const etfsFlag = args.includes('--etfs');
    const trendingFlag = args.includes('--trending');
    const allFlag = args.includes('--all');
    const forceFlag = args.includes('--force'); // Refresh even if exists

    if (!sp500Flag && !etfsFlag && !trendingFlag && !allFlag) {
        console.log('Usage: node scripts/populate_popular_securities.js [options]');
        console.log('\nOptions:');
        console.log('  --sp500      Populate S&P 500 stocks');
        console.log('  --etfs       Populate popular ETFs');
        console.log('  --trending   Populate trending tickers');
        console.log('  --all        Populate all of the above');
        console.log('  --force      Refresh even if metadata exists');
        console.log('\nEnvironment Variables:');
        console.log('  POPULAR_SECURITIES_DELAY_MS    Delay between symbols (default: 2000ms)');
        console.log('  POPULAR_SECURITIES_BATCH_SIZE  Batch size (default: 50)');
        process.exit(1);
    }

    const connection = await getDbConnection();
    console.log('Connected to MySQL\n');
    console.log(`Throttle delay: ${THROTTLE_DELAY_MS}ms between symbols`);
    console.log(`Skip existing: ${!forceFlag}\n`);

    const startTime = Date.now();
    const allResults = [];

    try {
        // Process S&P 500
        if (sp500Flag || allFlag) {
            console.log('='.repeat(60));
            console.log('PROCESSING S&P 500 STOCKS');
            console.log('='.repeat(60));
            const results = await processSymbolList(connection, SP500_TICKERS, {
                skipExisting: !forceFlag
            });
            allResults.push({ category: 'S&P 500', ...results });
            console.log('');
        }

        // Process ETFs
        if (etfsFlag || allFlag) {
            console.log('='.repeat(60));
            console.log('PROCESSING POPULAR ETFs');
            console.log('='.repeat(60));
            const results = await processSymbolList(connection, POPULAR_ETFS, {
                skipExisting: !forceFlag
            });
            allResults.push({ category: 'ETFs', ...results });
            console.log('');
        }

        // Process Trending
        if (trendingFlag || allFlag) {
            console.log('='.repeat(60));
            console.log('PROCESSING TRENDING TICKERS');
            console.log('='.repeat(60));
            const results = await processSymbolList(connection, TRENDING_TICKERS, {
                skipExisting: !forceFlag
            });
            allResults.push({ category: 'Trending', ...results });
            console.log('');
        }

        // Summary
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        console.log('='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total time: ${elapsed} minutes\n`);

        allResults.forEach(result => {
            console.log(`${result.category}:`);
            console.log(`  Total:    ${result.total}`);
            console.log(`  Skipped:  ${result.skipped} (already cached)`);
            console.log(`  Fetched:  ${result.fetched}`);
            console.log(`  Failed:   ${result.failed}`);
            console.log('');
        });

        const totalFailed = allResults.reduce((sum, r) => sum + r.failed, 0);
        if (totalFailed > 0) {
            console.log('Failed symbols:');
            allResults.forEach(result => {
                if (result.errors.length > 0) {
                    console.log(`\n${result.category}:`);
                    result.errors.forEach(err => {
                        console.log(`  - ${err.symbol}: ${err.error}`);
                    });
                }
            });
        }

        console.log('\n✓ Background population complete!');

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await connection.end();
    }
}

main();
