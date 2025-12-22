const mysql = require('mysql2/promise');

async function queryUpdateRules() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'wealth_user',
        password: process.env.DB_PASSWORD || 'test',
        database: process.env.DB_NAME || 'wealth_tracker'
    });

    try {
        const [rows] = await connection.execute(
            "SELECT * FROM update_rules WHERE source = 'investing.com' ORDER BY id"
        );

        console.log(JSON.stringify(rows, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await connection.end();
    }
}

queryUpdateRules();
