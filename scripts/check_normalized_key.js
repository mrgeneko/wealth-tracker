#!/usr/bin/env node
// scripts/check_normalized_key.js
// Quick verification helper: shows counts and a few sample mismatches

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

async function main() {
  const DB_HOST = process.env.DB_HOST || '127.0.0.1';
  const DB_USER = process.env.DB_USER || 'root';
  const DB_PASS = process.env.DB_PASS || '';
  const DB_NAME = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wealth_tracker';
  const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306;

  const connection = await mysql.createConnection({ host: DB_HOST, user: DB_USER, password: DB_PASS, database: DB_NAME, port: DB_PORT });

  try {
    const [totalRows] = await connection.execute('SELECT COUNT(*) as count FROM positions');
    const [nullNorm] = await connection.execute('SELECT COUNT(*) as count FROM positions WHERE normalized_key IS NULL OR normalized_key = ""');
    const [mismatch] = await connection.execute("SELECT id, symbol, normalized_key FROM positions WHERE normalized_key IS NOT NULL AND normalized_key != REPLACE(REPLACE(URLEncoder(symbol), '+', '%20'), '%7E', '~') LIMIT 10");

    // Note: REPLACE(...URLEncoder...) above may not be available in your MySQL; we'll do a more portable approach below

    console.log(`Total positions: ${totalRows[0].count}`);
    console.log(`Positions with NULL/empty normalized_key: ${nullNorm[0].count}`);

    // Instead, fetch sample mismatches with JavaScript check
    const [rows] = await connection.execute('SELECT id, symbol, normalized_key FROM positions LIMIT 1000');
    const mismatches = [];
    for (const r of rows) {
      const computed = encodeURIComponent(r.symbol || '');
      if (r.normalized_key && r.normalized_key !== computed) {
        mismatches.push({ id: r.id, symbol: r.symbol, normalized_key: r.normalized_key, expected: computed });
        if (mismatches.length >= 10) break;
      }
    }

    if (mismatches.length) {
      console.log('\nSample mismatches (normalized_key != encodeURIComponent(symbol)):');
      mismatches.forEach(m => console.log(`id=${m.id}  symbol='${m.symbol}'  normalized_key='${m.normalized_key}'  expected='${m.expected}'`));
    } else {
      console.log('\nNo sample mismatches found in the first 1000 rows.');
    }

  } finally {
    await connection.end();
  }
}

main().catch(err => { console.error('Error:', err); process.exit(1); });
