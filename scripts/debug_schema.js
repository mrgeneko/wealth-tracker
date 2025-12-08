
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

        const [rows] = await connection.execute('DESCRIBE securities_metadata');
        const [rows2] = await connection.execute('DESCRIBE positions');

        const output = {
            securities_metadata: rows,
            positions: rows2
        };

        const logPath = path.join(__dirname, '../logs/schema_dump.json');
        fs.writeFileSync(logPath, JSON.stringify(output, null, 2));
        console.log('Schema dumped to logs/schema_dump.json');

        await connection.end();
    } catch (err) {
        console.error('Error:', err);
        // Try to write error to log too
        const logPath = path.join(__dirname, '../logs/schema_dump_error.json');
        fs.writeFileSync(logPath, JSON.stringify({ error: err.message }, null, 2));
    }
}

main();
