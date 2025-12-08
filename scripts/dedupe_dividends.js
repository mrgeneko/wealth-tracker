#!/usr/bin/env node
// Deduplicate securities_dividends by (symbol, ex_dividend_date)
// Runs in dry-run mode by default. Use --apply to actually perform archival/deletes.
// Use --limit=n to only process first n groups (useful for testing).

require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const limitArg = process.argv.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'test',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_DATABASE || 'testdb'
  });

  try {
    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY]'} Searching for duplicate dividend events by (symbol, ex_dividend_date)`);

    let qry = `SELECT symbol, ex_dividend_date, COUNT(*) cnt FROM securities_dividends GROUP BY symbol, ex_dividend_date HAVING COUNT(*) > 1 ORDER BY cnt DESC`;
    if (limit) qry += ` LIMIT ${limit}`;

    const [groups] = await connection.execute(qry);
    console.log(`Found ${groups.length} groups with duplicates`);

    for (const g of groups) {
      const { symbol, ex_dividend_date } = g;
      const [rows] = await connection.execute(
        `SELECT * FROM securities_dividends WHERE symbol = ? AND ex_dividend_date = ? ORDER BY (status='paid') DESC, ingested_at DESC, payment_date DESC, id DESC`,
        [symbol, ex_dividend_date]
      );

      if (rows.length <= 1) continue; // should not happen

      // Pick canonical row as the first
      const canonical = rows[0];
      const nonCanon = rows.slice(1);

      console.log(`\nGroup: ${symbol} ${ex_dividend_date} — total=${rows.length} canonical id=${canonical.id} amount=${canonical.dividend_amount} status=${canonical.status}`);

      for (const r of nonCanon) {
        console.log(`  -> duplicate id=${r.id} amount=${r.dividend_amount} status=${r.status} ingested_at=${r.ingested_at}`);
      }

      if (!dryRun) {
        // Insert non-canonical rows into backup table and remove them from main table
        const ids = nonCanon.map(r => r.id);
        const [ins] = await connection.execute(
          `INSERT INTO securities_dividends_backup SELECT * FROM securities_dividends WHERE id IN (${ids.join(',')})`
        );
        const [del] = await connection.execute(`DELETE FROM securities_dividends WHERE id IN (${ids.join(',')})`);
        console.log(`  archived ${ids.length} rows to securities_dividends_backup and deleted from primary table`);
      } else {
        console.log(`  [DRY-RUN] would archive ${nonCanon.length} rows for ${symbol} on ${ex_dividend_date}`);
      }
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) main();

module.exports = { main };
