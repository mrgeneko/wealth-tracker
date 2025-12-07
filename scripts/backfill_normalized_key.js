#!/usr/bin/env node
// scripts/backfill_normalized_key.js
// Backfill positions.normalized_key by percent-encoding the existing symbol.
// Idempotent: only updates rows where normalized_key is NULL or differs from new value.

const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const util = require('util');

dotenv.config();

async function main() {
  const DB_HOST = process.env.DB_HOST || '127.0.0.1';
  const DB_USER = process.env.DB_USER || 'root';
  const DB_PASS = process.env.DB_PASS || '';
  const DB_NAME = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wealth_tracker';
  const DB_PORT = process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 3306;

  const connection = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    port: DB_PORT,
    multipleStatements: true,
  });

  console.log(`Connected to MySQL ${DB_HOST}:${DB_PORT}/${DB_NAME}`);

  try {
    // Select rows to update: where normalized_key is NULL OR different from encodeURIComponent(symbol)
    // We percent-encode using JS's encodeURIComponent.

    const [rows] = await connection.execute("SELECT id, symbol, normalized_key FROM positions WHERE symbol IS NOT NULL");
    console.log(`Found ${rows.length} positions to scan`);

    let updated = 0;
    for (const r of rows) {
      const id = r.id;
      const symbol = r.symbol || '';
      // compute normalized key (percent encoding)
      const normalized = encodeURIComponent(symbol);
      const existing = r.normalized_key;
      if (!existing || existing !== normalized) {
        await connection.execute('UPDATE positions SET normalized_key = ? WHERE id = ?', [normalized, id]);
        updated += 1;
        if (updated % 100 === 0) process.stdout.write(`.${updated}`);
      }
    }

    console.log(`\nBackfill complete. Updated ${updated} rows.`);
  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
