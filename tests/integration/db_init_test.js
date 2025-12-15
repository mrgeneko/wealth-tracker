const mysql = require('mysql2/promise');

async function testUpdateWindows() {
    console.log('Connecting to database...');
    const connection = await mysql.createConnection({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER || 'test',
        password: process.env.MYSQL_PASSWORD || 'test',
        database: process.env.MYSQL_DATABASE || 'testdb'
    });

    try {
        console.log('Connected. Querying update_windows...');
                // This test is meant to validate that Docker init SQL seeds the *required*
                // default windows (and a sample override), not that the table contains only
                // those rows.
                const [rows] = await connection.execute(`
                        SELECT provider_id, watchlist_key, ticker, start_time, end_time, timezone, priority, enabled
                        FROM update_windows
                        WHERE enabled = 1
                            AND (
                                (provider_id IS NULL AND watchlist_key IS NULL AND ticker = 'default')
                                OR (provider_id = 'investingcom' AND ticker = 'BKLC')
                            )
                        ORDER BY ticker, start_time, priority
                `);

        console.log(`Found ${rows.length} records.`);

        const expected = [
            { ticker: 'default', start: '00:00:00', end: '04:00:00' },
            { ticker: 'default', start: '04:00:00', end: '09:30:00' },
            { ticker: 'default', start: '09:30:00', end: '16:00:00' },
            // BKLC has priority 10, starts at 09:31
            { ticker: 'BKLC', start: '09:31:00', end: '16:00:00' },
            { ticker: 'default', start: '16:00:00', end: '20:00:00' },
            { ticker: 'default', start: '20:00:00', end: '23:59:59' }
        ];

        let failed = false;

        // We can't strictly assume order because of the mixed priorities/times, but let's check existence
        for (const exp of expected) {
            const found = rows.find(r =>
                r.ticker === exp.ticker &&
                r.start_time === exp.start &&
                r.end_time === exp.end
            );

            if (found) {
                console.log(`PASS: Found ${exp.ticker} [${exp.start} - ${exp.end}]`);
            } else {
                console.error(`FAIL: Missing ${exp.ticker} [${exp.start} - ${exp.end}]`);
                failed = true;
            }
        }

        if (failed) {
            console.log('Current Records:');
            console.table(rows.map(r => ({
                provider_id: r.provider_id,
                ticker: r.ticker,
                start: r.start_time,
                end: r.end_time,
                priority: r.priority,
                enabled: r.enabled
            })));
            process.exit(1);
        }

        console.log('All validations passed!');

    } catch (err) {
        console.error('Test execution failed:', err);
        process.exit(1);
    } finally {
        await connection.end();
    }
}

testUpdateWindows();
