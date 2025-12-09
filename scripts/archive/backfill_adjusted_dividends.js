#!/usr/bin/env node
// Backfill adjusted_dividend_amount for securities_dividends using security_splits
// Dry-run by default. Use --apply to write changes. Supports --symbol and --limit for scoped runs.

require('dotenv').config();
const mysql = require('mysql2/promise');

function parseArg(name) {
  const a = process.argv.find(s => s.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=')[1];
}

async function computeFactor(connection, symbol, exDate) {
  // Compute product of split_ratio for splits after exDate and up to today
  // Use EXP(SUM(LN(split_ratio))) to simulate product in MySQL
  const [rows] = await connection.execute(
    `SELECT EXP(SUM(LN(split_ratio))) AS factor
     FROM security_splits
     WHERE symbol = ? AND split_date > ? AND split_date <= CURDATE()`,
    [symbol, exDate]
  );
  const f = rows && rows[0] && rows[0].factor ? parseFloat(rows[0].factor) : null;
  if (f === null || Number.isNaN(f)) return 1.0; // no split
  // protect against zero or negative
  if (!isFinite(f) || f <= 0) return 1.0;
  return f;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const symbol = parseArg('symbol');
  const limit = parseInt(parseArg('limit') || '0', 10) || null;
  const batchSize = parseInt(parseArg('batch') || '200', 10) || 200;

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'test',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_DATABASE || 'testdb'
  });

  try {
    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY]'} Backfill adjusted_dividend_amount`);

    let where = `WHERE (adjusted_dividend_amount IS NULL OR adjusted_dividend_amount = 0)`;
    const params = [];
    if (symbol) {
      where += ` AND symbol = ?`;
      params.push(symbol);
    }

    // Select candidate rows
    let qry = `SELECT id, symbol, ex_dividend_date, dividend_amount FROM securities_dividends ${where} ORDER BY symbol, ex_dividend_date ASC`;
    if (limit) qry += ` LIMIT ${limit}`;

    const [rows] = await connection.execute(qry, params);
    console.log(`Found ${rows.length} dividend rows to process`);

    // Process in batches
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        const factor = await computeFactor(connection, r.symbol, r.ex_dividend_date);
        const adjusted = parseFloat(r.dividend_amount) * factor;
        if (dryRun) {
          console.log(`[DRY] id=${r.id} ${r.symbol} ${r.ex_dividend_date} amount=${r.dividend_amount} factor=${factor.toFixed(6)} adjusted=${adjusted.toFixed(6)}`);
        } else {
          await connection.execute(`UPDATE securities_dividends SET adjusted_dividend_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [adjusted, r.id]);
          console.log(`Updated id=${r.id} adjusted=${adjusted.toFixed(6)}`);
        }
      }
    }

    console.log('Backfill complete.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) main();

module.exports = { main };
