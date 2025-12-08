
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function main() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        const [rows] = await connection.execute('SELECT * FROM securities_metadata WHERE symbol = ?', ['VTI']);

        console.log('VTI Data:', JSON.stringify(rows, null, 2));
        fs.writeFileSync(path.join(__dirname, '../vti_db_dump.json'), JSON.stringify(rows, null, 2));

        await connection.end();
    } catch (err) {
        console.error('Error:', err);
        fs.writeFileSync(path.join(__dirname, '../vti_db_error.json'), JSON.stringify({ error: err.message }, null, 2));
    }
}

main();
