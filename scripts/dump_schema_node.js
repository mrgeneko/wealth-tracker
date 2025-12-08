
require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');

async function main() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.MYSQL_HOST || 'localhost',
            port: parseInt(process.env.MYSQL_PORT || '3306'),
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE
        });

        // Get Positions Schema
        const [positions] = await connection.execute('DESCRIBE positions');
        // Get Metadata Schema
        const [metadata] = await connection.execute('DESCRIBE securities_metadata');

        const output = {
            positions: positions,
            metadata: metadata
        };

        fs.writeFileSync('layout_dump.json', JSON.stringify(output, null, 2));
        console.log('Dumped to layout_dump.json');

        await connection.end();
    } catch (e) {
        fs.writeFileSync('layout_dump_error.json', JSON.stringify({ error: e.message }));
    }
}
main();
