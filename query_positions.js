const mysql = require('mysql2/promise');

const MYSQL_HOST = process.env.MYSQL_HOST || 'mysql';
const MYSQL_PORT = process.env.MYSQL_PORT || 3306;
const MYSQL_USER = process.env.MYSQL_USER || 'test';
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || 'test';
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || 'testdb';

async function main() {
  const pool = mysql.createPool({
    host: MYSQL_HOST,
    port: MYSQL_PORT,
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  try {
    const [rows] = await pool.execute(
      'SELECT id, account_id, ticker, type, quantity, currency FROM positions ORDER BY id'
    );
    
    console.log('\n=== Positions Table ===');
    console.log(`Total records: ${rows.length}\n`);
    
    if (rows.length === 0) {
      console.log('No positions found.');
    } else {
      console.table(rows);
    }
  } catch (err) {
    console.error('Error querying positions:', err.message);
  } finally {
    await pool.end();
  }
}

main();
