
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
    const outFile = 'schema_debug_root.json';
    try {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        const [rows] = await connection.execute('DESCRIBE securities_metadata');

        fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
        await connection.end();
    } catch (err) {
        fs.writeFileSync(outFile, JSON.stringify({ error: err.message }, null, 2));
    }
}

main();
