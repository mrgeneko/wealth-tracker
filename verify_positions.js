const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER || 'gene', // adjust default if needed
        password: process.env.MYSQL_PASSWORD || 'gene',
        database: process.env.MYSQL_DATABASE || 'wealth_tracker'
    });

    try {
        const [rows] = await pool.query("SELECT security_type, source, type, count(*) as count FROM positions GROUP BY security_type, source, type");
        console.log('Positions Summary:');
        console.table(rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
