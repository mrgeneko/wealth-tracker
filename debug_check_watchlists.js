require('dotenv').config();
const mysql = require('mysql2/promise');

async function checkWatchlists() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.MYSQL_HOST || '127.0.0.1',
            port: parseInt(process.env.MYSQL_PORT || '3306', 10),
            user: process.env.MYSQL_USER || 'test',
            password: process.env.MYSQL_PASSWORD || 'test',
            database: process.env.MYSQL_DATABASE || 'wealth_tracker',
            waitForConnections: true,
            connectionLimit: 1
        });

        console.log('Querying watchlist_instances...');
        const [rows] = await pool.query('SELECT * FROM watchlist_instances');
        console.log('Found ' + rows.length + ' rows.');
        rows.forEach(r => {
            console.log(`- ID: ${r.id}, Key: ${r.watchlist_key}, Name: ${r.watchlist_name}, URL: ${r.watchlist_url}`);
        });

    } catch (e) {
        console.error('Error:', e);
    } finally {
        if (pool) await pool.end();
    }
}

checkWatchlists();
