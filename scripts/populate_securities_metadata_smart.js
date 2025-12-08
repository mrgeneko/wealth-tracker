// populate_securities_metadata_smart.js
// Enhanced version that handles non-Yahoo tickers gracefully
// Usage: node scripts/populate_securities_metadata_smart.js [--symbol AAPL] [--all] [--link-positions]

require('dotenv').config();
const mysql = require('mysql2/promise');

// [Include all the helper functions from populate_securities_metadata.js]
// ... (ensureYahoo, sleep, parseDate, formatDateTime, formatDate, etc.)

async function linkPositionToMetadata(connection, positionSymbol, metadataSymbol) {
    // Update the position's metadata_symbol to point to the verified Yahoo symbol
    await connection.execute(
        'UPDATE positions SET metadata_symbol = ? WHERE symbol = ? AND metadata_symbol IS NULL',
        [metadataSymbol, positionSymbol]
    );
    console.log(`  ✓ Linked position ${positionSymbol} to metadata ${metadataSymbol}`);
}

async function processSymbolWithLinking(connection, positionSymbol, options = {}) {
    console.log(`\nProcessing ${positionSymbol}...`);

    // Try to fetch Yahoo data
    const data = await fetchSecurityMetadata(positionSymbol);

    if (!data) {
        console.log(`  ✗ No Yahoo data available for ${positionSymbol}`);
        console.log(`  → Position will remain with metadata_symbol = NULL`);
        return { success: false, symbol: positionSymbol };
    }

    // Determine the canonical Yahoo symbol (might differ from position symbol)
    const yahooSymbol = data.price?.symbol || data.quoteType?.symbol || positionSymbol;

    // Insert/update metadata
    await upsertSecurityMetadata(connection, yahooSymbol, data);
    await upsertEarningsEvents(connection, yahooSymbol, data.calendarEvents);
    await upsertDividendEvents(connection, yahooSymbol, data.calendarEvents);

    // Link position to metadata if requested
    if (options.linkPositions) {
        await linkPositionToMetadata(connection, positionSymbol, yahooSymbol);
    }

    return { success: true, symbol: positionSymbol, yahooSymbol };
}

async function main() {
    const args = process.argv.slice(2);
    const symbolArg = args.includes('--symbol') ? args[args.indexOf('--symbol') + 1] : null;
    const allFlag = args.includes('--all');
    const linkPositions = args.includes('--link-positions');

    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    console.log('Connected to MySQL');
    console.log(`Link positions: ${linkPositions ? 'YES' : 'NO'}\n`);

    try {
        let symbols = [];

        if (symbolArg) {
            symbols = [symbolArg];
        } else if (allFlag) {
            const [rows] = await connection.execute(`
        SELECT DISTINCT symbol FROM positions 
        WHERE symbol IS NOT NULL AND symbol != 'CASH'
      `);
            symbols = rows.map(r => r.symbol);
            console.log(`Found ${symbols.length} unique symbols in positions table\n`);
        } else {
            console.log('Usage:');
            console.log('  node scripts/populate_securities_metadata_smart.js --symbol AAPL [--link-positions]');
            console.log('  node scripts/populate_securities_metadata_smart.js --all [--link-positions]');
            console.log('\nOptions:');
            console.log('  --link-positions  Update positions.metadata_symbol after successful fetch');
            process.exit(1);
        }

        const results = {
            success: [],
            failed: []
        };

        for (let i = 0; i < symbols.length; i++) {
            const symbol = symbols[i];
            console.log(`[${i + 1}/${symbols.length}] ${symbol}`);

            const result = await processSymbolWithLinking(connection, symbol, { linkPositions });

            if (result.success) {
                results.success.push(result);
            } else {
                results.failed.push(result);
            }

            // Rate limiting
            if (i < symbols.length - 1) {
                await sleep(500);
            }
        }

        // Summary
        console.log('\n' + '='.repeat(60));
        console.log('SUMMARY');
        console.log('='.repeat(60));
        console.log(`✓ Successful: ${results.success.length}`);
        console.log(`✗ Failed:     ${results.failed.length}`);

        if (results.failed.length > 0) {
            console.log('\nFailed symbols (no Yahoo data):');
            results.failed.forEach(r => console.log(`  - ${r.symbol}`));
            console.log('\nThese positions will have metadata_symbol = NULL');
            console.log('They will still appear in queries but without enriched metadata.');
        }

        if (linkPositions) {
            console.log('\n✓ Positions table updated with metadata_symbol links');
        } else {
            console.log('\nTo link positions to metadata, run with --link-positions flag');
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await connection.end();
    }
}

// Note: You would need to copy all helper functions from populate_securities_metadata.js
// (ensureYahoo, fetchSecurityMetadata, upsertSecurityMetadata, etc.)

main();
