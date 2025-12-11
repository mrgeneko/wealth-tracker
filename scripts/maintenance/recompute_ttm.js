#!/usr/bin/env node
// Recompute TTM values for dividends and EPS and write to securities_metadata
// - TTM dividends: sum of adjusted_dividend_amount (fallback dividend_amount) in last 12 months
// - TTM EPS: sum of last 4 reported eps_actual values (fallback to 12-month sum if fewer quarters)
// Dry-run by default, use --apply to write values. Supports --symbol and --limit

require('dotenv').config();
const mysql = require('mysql2/promise');

function parseArg(name) {
  const a = process.argv.find(s => s.startsWith(`--${name}=`));
  if (!a) return null;
  return a.split('=')[1];
}

async function computeTtmForSymbol(connection, symbol, dryRun) {
  // TTM dividends
  const [drows] = await connection.execute(
    `SELECT SUM(COALESCE(adjusted_dividend_amount, dividend_amount)) AS sum_divs
     FROM securities_dividends
    WHERE ticker = ? AND ex_dividend_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      AND status IN ('confirmed','paid')
      AND (dividend_type = 'CASH' OR dividend_type IS NULL)
    `, [symbol]
  );
  const sumDivs = drows && drows[0] && drows[0].sum_divs ? parseFloat(drows[0].sum_divs) : null;

  // TTM EPS: prefer adjusted_eps (if populated), otherwise use eps_actual.
  // Take the most recent 4 reported earnings with a numeric EPS (adjusted_eps or eps_actual)
  const [erows] = await connection.execute(
    `SELECT SUM(val) AS sum_eps FROM (
       SELECT COALESCE(adjusted_eps, eps_actual) AS val
       FROM securities_earnings
       WHERE ticker = ? AND (adjusted_eps IS NOT NULL OR eps_actual IS NOT NULL)
       ORDER BY earnings_date DESC
       LIMIT 4
     ) _sub`, [symbol]
  );
  const sumEps = erows && erows[0] && erows[0].sum_eps ? parseFloat(erows[0].sum_eps) : null;

  if (dryRun) {
    console.log(`[DRY] ${symbol}: ttm_dividend_amount=${sumDivs} ttm_eps=${sumEps}`);
  } else {
    await connection.execute(`UPDATE securities_metadata SET ttm_dividend_amount = ?, ttm_eps = ?, ttm_last_calculated_at = NOW() WHERE symbol = ?`, [sumDivs, sumEps, symbol]);
    console.log(`Updated ${symbol}: ttm_dividend_amount=${sumDivs} ttm_eps=${sumEps}`);
  }
  return { symbol, sumDivs, sumEps };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const symbol = parseArg('symbol');
  const limit = parseInt(parseArg('limit') || '0', 10) || null;

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'test',
    password: process.env.MYSQL_PASSWORD || 'test',
    database: process.env.MYSQL_DATABASE || 'testdb'
  });

  try {
    if (symbol) {
      await computeTtmForSymbol(connection, symbol, dryRun);
    } else {
      // gather symbols to process
      let qry = `SELECT ticker FROM securities_metadata ORDER BY ticker`;
      if (limit) qry += ` LIMIT ${limit}`;
      const [rows] = await connection.execute(qry);
      console.log(`Processing ${rows.length} symbols (limit=${limit || 'none'})`);
      for (const r of rows) {
        await computeTtmForSymbol(connection, r.ticker, dryRun);
      }
    }

    console.log('TTM recompute complete.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await connection.end();
  }
}

if (require.main === module) main();

module.exports = { main };
