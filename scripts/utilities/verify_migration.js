
require('dotenv').config();
const mysql = require('mysql2/promise');

async function verify() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        port: 3306,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE
    });

    console.log('--- Accounts ---');
    const [accounts] = await connection.execute('SELECT id, name, category, display_order FROM accounts ORDER BY category, display_order LIMIT 5');
    console.table(accounts);

    console.log('--- Positions (Stocks with Exchange column) ---');
    const [positions] = await connection.execute('SELECT id, symbol, type, quantity, exchange FROM positions WHERE type="stock" LIMIT 5');
    console.table(positions);

    console.log('--- Fixed Assets ---');
    const [assets] = await connection.execute('SELECT id, name, type, value, display_order FROM fixed_assets');
    console.table(assets);

    await connection.end();
}

verify();
