
require('dotenv').config();
const mysql = require('mysql2/promise');

console.log('--- SCRIPT START ---');

async function main() {
    try {
        console.log('Connecting to DB...');
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });
        console.log('Connected!');

        const [rows] = await connection.execute('SELECT ticker, short_name, exchange FROM securities_metadata WHERE ticker = ?', ['VTI']);
        console.log('Query Result:', JSON.stringify(rows, null, 2));

        await connection.end();
        console.log('Connection Closed');
    } catch (err) {
        console.error('ERROR:', err.message);
    }
}

main().then(() => console.log('--- SCRIPT END ---'));
