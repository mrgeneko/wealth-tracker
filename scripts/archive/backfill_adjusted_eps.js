#!/usr/bin/env node
// Backfill adjusted_eps for securities_earnings using security_splits
// Dry-run by default. Use --apply to write changes. Supports --symbol and --limit for scoped runs.

require('dotenv').config();
const mysql = require('mysql2/promise');

function parseArg(name) {
  const a = process.argv.find(s => s.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=')[1];
}

async function computeFactorForEarnings(connection, symbol, earningsDate) {
  // For EPS, we need cumulative split_factor for splits that occurred after earningsDate up to now
  const [rows] = await connection.execute(
    `SELECT EXP(SUM(LN(split_ratio))) AS factor
     FROM security_splits
     WHERE ticker = ? AND split_date > ? AND split_date <= CURDATE()`,
    [symbol, earningsDate]
  );
  const f = rows && rows[0] && rows[0].factor ? parseFloat(rows[0].factor) : null;
  if (f === null || Number.isNaN(f)) return 1.0; // no split
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
    console.log(`${dryRun ? '[DRY-RUN]' : '[APPLY]'} Backfill adjusted_eps`);

    let where = `WHERE (adjusted_eps IS NULL)`;
    const params = [];
    if (symbol) {
      where += ` AND ticker = ?`;
      params.push(symbol);
    }

    let qry = `SELECT id, ticker, earnings_date, eps_actual FROM securities_earnings ${where} ORDER BY ticker, earnings_date ASC`;
    if (limit) qry += ` LIMIT ${limit}`;

    const [rows] = await connection.execute(qry, params);
    console.log(`Found ${rows.length} earnings rows to process`);

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        if (r.eps_actual === null) {
          if (dryRun) console.log(`[DRY] id=${r.id} ${r.ticker} ${r.earnings_date} eps_actual=NULL -> skip`);
          continue;
        }
        const factor = await computeFactorForEarnings(connection, r.ticker, r.earnings_date);
        const adjusted = parseFloat(r.eps_actual) * factor;
        if (dryRun) {
          console.log(`[DRY] id=${r.id} ${r.ticker} ${r.earnings_date} eps=${r.eps_actual} factor=${factor.toFixed(6)} adjusted=${adjusted.toFixed(6)}`);
        } else {
          await connection.execute(`UPDATE securities_earnings SET adjusted_eps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [adjusted, r.id]);
          console.log(`Updated id=${r.id} adjusted_eps=${adjusted.toFixed(6)}`);
        }
      }
    }

    console.log('Backfill adjusted EPS complete.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) main();

module.exports = { main };
