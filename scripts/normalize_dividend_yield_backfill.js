#!/usr/bin/env node
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const verbose = process.argv.includes('--verbose');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'test',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_DATABASE || 'testdb'
  });

  try {
    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY]'} Scanning securities_metadata for dividend_yield anomalies`);

    // Target obvious percent-style values: > 1 and <= 100 (likely 1.14 for 1.14%)
    const [percentRows] = await connection.execute(
      `SELECT symbol, dividend_yield FROM securities_metadata WHERE dividend_yield IS NOT NULL AND dividend_yield > 1 AND dividend_yield <= 100`);

    console.log(`Found ${percentRows.length} suspected percent-style rows (1..100)`);
    for (const r of percentRows) {
      const newVal = parseFloat(r.dividend_yield) / 100.0;
      console.log((verbose? '[MATCH] ' : '') + `${r.symbol}: ${r.dividend_yield} -> ${newVal}`);
      if (!dryRun) {
        await connection.execute('UPDATE securities_metadata SET dividend_yield = ? WHERE symbol = ?', [newVal, r.symbol]);
      }
    }

    // Handle extremely large values (likely bad). Optionally null them so UI shows '-'
    const [hugeRows] = await connection.execute(
      `SELECT symbol, dividend_yield FROM securities_metadata WHERE dividend_yield IS NOT NULL AND dividend_yield > 100`);
    console.log(`Found ${hugeRows.length} rows with dividend_yield > 100 (likely corrupted)`);
    for (const r of hugeRows) {
      console.log((verbose? '[HUGE] ' : '') + `${r.symbol}: ${r.dividend_yield} -> NULL`);
      if (!dryRun) {
        await connection.execute('UPDATE securities_metadata SET dividend_yield = NULL WHERE symbol = ?', [r.symbol]);
      }
    }

    // If positions table stores dividend_yield too, fix those similarly
    try {
      const [cols] = await connection.execute("SHOW COLUMNS FROM positions LIKE 'dividend_yield'");
      if (cols.length > 0) {
        const [posPercentRows] = await connection.execute(
          `SELECT id, symbol, dividend_yield FROM positions WHERE dividend_yield IS NOT NULL AND dividend_yield > 1 AND dividend_yield <= 100`);
        console.log(`Found ${posPercentRows.length} positions with percent-style dividend_yield`);
        for (const p of posPercentRows) {
          const newVal = parseFloat(p.dividend_yield) / 100.0;
          console.log((verbose? '[POS] ' : '') + `pos id=${p.id} ${p.symbol}: ${p.dividend_yield} -> ${newVal}`);
          if (!dryRun) {
            await connection.execute('UPDATE positions SET dividend_yield = ? WHERE id = ?', [newVal, p.id]);
          }
        }

        const [posHugeRows] = await connection.execute(
          `SELECT id, symbol, dividend_yield FROM positions WHERE dividend_yield IS NOT NULL AND dividend_yield > 100`);
        console.log(`Found ${posHugeRows.length} positions with dividend_yield > 100`);
        for (const p of posHugeRows) {
          console.log((verbose? '[POS-HUGE] ' : '') + `pos id=${p.id} ${p.symbol}: ${p.dividend_yield} -> NULL`);
          if (!dryRun) {
            await connection.execute('UPDATE positions SET dividend_yield = NULL WHERE id = ?', [p.id]);
          }
        }
      } else {
        console.log('positions table has no dividend_yield column — skipping position backfill');
      }
    } catch (e) {
      console.warn('Could not inspect positions table (skipping):', e.message);
    }

    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY]'} Done.`);
  } catch (err) {
    console.error('Error running backfill:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) main();

module.exports = { main };
