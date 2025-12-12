#!/usr/bin/env node
// fetch_history_yahoo.js
// Fetch historical dividend payments and earnings history from Yahoo and store
// them in the database. Computes trailing 12-month aggregates for dividends
// and earnings (TTM EPS) and writes those aggregates to securities_metadata.

require('dotenv').config();
const fs = require('fs');
const mysql = require('mysql2/promise');

// Helper to load yahoo-finance2 (ESM-only package, must use dynamic import)
// Uses the same robust loading pattern as scrape_yah
// oo.js
let _yahooModule = null;
const { normalizeDividendsInput } = require('./_test_helper_fetch');

// Debug flag - set DEBUG_YAHOO=1 to enable verbose logging
const DEBUG = process.env.DEBUG_YAHOO === '1';
function debugLog(...args) { if (DEBUG) console.log('[DEBUG]', ...args); }

async function ensureYahoo() {
  if (_yahooModule) return _yahooModule;
  
  // Helper: detect ES6 class constructors so we can instantiate them.
  function isClass(fn) {
    if (typeof fn !== 'function') return false;
    const s = Function.prototype.toString.call(fn);
    return /^class\s/.test(s);
  }
  
  try {
    // Try CommonJS require first
    const req = require('yahoo-finance2');
    _yahooModule = (req && req.default) ? req.default : req;
    debugLog('yahoo-finance2 loaded via require, type:', typeof _yahooModule);
  } catch (err) {
    // Fall back to dynamic ESM import
    debugLog('require failed, trying dynamic import...');
    const imp = await import('yahoo-finance2');
    _yahooModule = (imp && imp.default) ? imp.default : imp;
    debugLog('yahoo-finance2 loaded via import, type:', typeof _yahooModule);
  }
  
  // If it's a class/function, instantiate it
  if (typeof _yahooModule === 'function') {
    if (isClass(_yahooModule) || (_yahooModule.prototype && typeof _yahooModule.prototype.quote === 'function')) {
      try {
        _yahooModule = new _yahooModule();
        debugLog('Instantiated yahoo-finance2 class');
      } catch (e) {
        debugLog('Failed to instantiate:', e.message);
      }
    }
  }
  
  // Log available methods for debugging
  if (_yahooModule) {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(_yahooModule) || {}).filter(k => k !== 'constructor');
    const directKeys = Object.keys(_yahooModule);
    debugLog('Available prototype methods:', methods);
    debugLog('Direct keys:', directKeys);
    debugLog('Has quoteSummary?', typeof _yahooModule.quoteSummary === 'function');
    debugLog('Has historical?', typeof _yahooModule.historical === 'function');
    debugLog('Has chart?', typeof _yahooModule.chart === 'function');
    debugLog('Has dividends?', typeof _yahooModule.dividends === 'function');
    debugLog('Has history?', typeof _yahooModule.history === 'function');
  }
  
  return _yahooModule;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function parseDate(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return null;
  return d;
}

async function fetchDividends(ticker) {
  // Use yahoo-finance2 v3.x chart() method which is the recommended way to get dividend history
  // The chart() method returns price data with events (dividends, splits) included
  try {
    const yahoo = await ensureYahoo();
    if (!yahoo) {
      console.warn(`yahoo-finance2 module not loaded - cannot fetch dividends for ${ticker}`);
      return null;
    }

    // Preferred: use chart() with events='div' - this is the v3.x recommended approach
    if (typeof yahoo.chart === 'function') {
      debugLog(`Trying yahoo.chart for ${ticker} with events=div`);
      try {
        // chart() options: period1/period2 as Date or 'YYYY-MM-DD' string, or use period='max'
        const chartResult = await yahooCallWithRetries(yahoo, 'chart', [ticker, { 
          period1: '2000-01-01',  // Go back far enough to get dividend history
          period2: new Date().toISOString().slice(0, 10),
          interval: '1mo',  // Monthly is sufficient for dividends
          events: 'div'     // Request dividend events
        }]);
        
        debugLog(`chart() returned for ${ticker}:`, chartResult ? 'data' : 'null');
        
        // Extract dividends from chart response - they're in events.dividends
        if (chartResult && chartResult.events && chartResult.events.dividends) {
          const dividends = chartResult.events.dividends;
          debugLog(`Found ${Object.keys(dividends).length} dividend events for ${ticker}`);
          
          const out = [];
          for (const [timestamp, divData] of Object.entries(dividends)) {
            // divData has { amount, date } where date is a Date object
            const dateObj = divData.date || new Date(Number(timestamp) * 1000);
            const dateStr = dateObj instanceof Date ? dateObj.toISOString().slice(0, 10) : String(dateObj).slice(0, 10);
            const amount = divData.amount || divData.dividend || 0;
            if (dateStr && amount > 0) {
              out.push({ ex_dividend_date: dateStr, dividend_amount: parseFloat(amount) });
            }
          }
          if (out.length) {
            debugLog(`Returning ${out.length} normalized dividend records for ${ticker}`);
            return out;
          }
        } else {
          debugLog(`No dividend events in chart response for ${ticker}`);
        }
      } catch (err) {
        console.warn(`yahoo-finance2.chart failed for ${ticker}: ${err && err.message}`);
      }
    } else {
      debugLog(`yahoo.chart not available for ${ticker}`);
    }

    // Fallback: try historical() which internally maps to chart() in v3.x
    if (typeof yahoo.historical === 'function') {
      debugLog(`Trying yahoo.historical for ${ticker}`);
      try {
        const hist = await yahooCallWithRetries(yahoo, 'historical', [ticker, { 
          period1: '2000-01-01',
          period2: new Date().toISOString().slice(0, 10),
          events: 'dividends'  // Note: 'dividends' not 'div' for historical()
        }]);
        
        if (Array.isArray(hist) && hist.length) {
          debugLog(`historical() returned ${hist.length} records for ${ticker}`);
          const out = hist
            .filter(r => r && (r.dividends !== undefined || r.dividend !== undefined || r.amount !== undefined))
            .map(r => ({
              ex_dividend_date: r.date ? (r.date instanceof Date ? r.date.toISOString().slice(0,10) : String(r.date).slice(0,10)) : '',
              dividend_amount: parseFloat(r.dividends || r.dividend || r.amount || 0)
            }))
            .filter(r => r.ex_dividend_date && r.dividend_amount > 0);
          
          if (out.length) {
            debugLog(`Returning ${out.length} dividend records from historical() for ${ticker}`);
            return out;
          }
        }
      } catch (err) {
        console.warn(`yahoo-finance2.historical dividends fetch failed for ${ticker}: ${err && err.message}`);
      }
    } else {
      debugLog(`yahoo.historical not available for ${ticker}`);
    }

  } catch (err) {
    console.warn(`yahoo-finance2 failed for ${ticker}: ${err && err.message}`);
  }
  
  // No dividend data found
  return null;
}

// parseDividendsCsv is handled by helper normalizeDividendsInput for tests; keep
// a thin wrapper for backwards compatibility
function parseDividendsCsv(input) { return normalizeDividendsInput(input); }

async function fetchQuoteSummaryModules(ticker, modules = []) {
  // Prefer the yahoo-finance2 library's quoteSummary method when available
  try {
    const yahoo = await ensureYahoo();
    if (yahoo && typeof yahoo.quoteSummary === 'function') {
      debugLog(`Trying yahoo.quoteSummary for ${ticker} with modules:`, modules);
      try {
        const result = await yahooCallWithRetries(yahoo, 'quoteSummary', [ticker, { modules }]);
        debugLog(`quoteSummary returned for ${ticker}:`, result ? 'data' : 'null');
        return result;
      } catch (err) {
        console.warn(`yahoo-finance2.quoteSummary failed for ${ticker}: ${err && err.message}`);
      }
    } else {
      debugLog(`yahoo.quoteSummary not available (yahoo=${!!yahoo}, type=${yahoo ? typeof yahoo.quoteSummary : 'N/A'})`);
    }
  } catch (err) {
    debugLog(`ensureYahoo failed: ${err && err.message}`);
    // library not available — fall back to HTTP below
  }

  // HTTP fallback
  const modParam = modules.join(',');
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${encodeURIComponent(modParam)}`;
  const headers = { 'User-Agent': 'wealth-tracker/1.0 (+github.com/mrgeneko/wealth-tracker)' };

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 429) {
        const ra = res.headers.get('retry-after');
        const wait = ra ? parseInt(ra) * 1000 : (1000 * Math.pow(2, attempt));
        console.warn(`Yahoo quoteSummary 429 for ${ticker}, waiting ${wait}ms then retrying`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        console.warn(`Yahoo quoteSummary fetch fail for ${ticker} status=${res.status}`);
        return null;
      }
      const json = await res.json();
      return json;
    } catch (err) {
      console.warn(`Error fetching quoteSummary for ${ticker}: ${err.message}`);
      await sleep(1000 * Math.pow(2, attempt));
      continue;
    }
  }
  return null;
}

// Generic retry/backoff wrapper for yahoo-finance2 library calls.
// Retries on transient failures like rate limits, network errors.
async function yahooCallWithRetries(yahoo, methodName, args = [], options = {}) {
  const maxAttempts = options.maxAttempts || 5;
  const baseWait = options.baseWait || 500; // ms
  const factor = options.factor || 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (typeof yahoo[methodName] !== 'function') throw new Error(`yahoo.${methodName} is not a function`);
      return await yahoo[methodName](...args);
    } catch (err) {
      const msg = (err && (err.message || err.toString())) || '';

      // If unauthorized (401), do not retry — caller should handle this.
      if (/\b401\b|Unauthorized/i.test(msg)) {
        console.warn(`yahoo.${methodName} returned 401/Unauthorized for args=${JSON.stringify(args)}`);
        throw err;
      }

      // Do not retry for obvious permanent errors
      if (/not found|no such/i.test(msg) && attempt === 1) {
        throw err;
      }

      // Retry on rate-limit / transient network errors
      const shouldRetry = /429|Too Many Requests|rate limit|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|ECONNREFUSED/i.test(msg) || err.name === 'FetchError';

      if (!shouldRetry) {
        // Unknown non-retryable error — surface immediately
        throw err;
      }

      const wait = Math.floor(baseWait * Math.pow(factor, attempt - 1) * (0.8 + Math.random() * 0.4));
      console.warn(`yahoo.${methodName} transient error (attempt ${attempt}/${maxAttempts}) for args=${JSON.stringify(args)}: ${msg}. Retrying in ${wait}ms`);
      if (attempt < maxAttempts) await sleep(wait);
      else {
        console.warn(`yahoo.${methodName} failed after ${maxAttempts} attempts`);
        throw err;
      }
    }
  }
}

async function upsertDividend(connection, ticker, exDate, amount, status = 'confirmed') {
  const exd = parseDate(exDate);
  if (!exd) return;
  const exdStr = exd.toISOString().slice(0,10);
  const sql = `
    INSERT INTO securities_dividends (
      ticker, ex_dividend_date, payment_date, record_date, declaration_date,
      dividend_amount, dividend_type, currency, is_estimate, status, data_source
    ) VALUES (?, ?, NULL, NULL, NULL, ?, 'CASH', 'USD', FALSE, ?, 'yahoo')
    ON DUPLICATE KEY UPDATE
      dividend_amount = VALUES(dividend_amount),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP
  `;
  try {
    await connection.execute(sql, [ticker, exdStr, amount, status]);
  } catch (err) {
    console.warn(`Failed upsert dividend ${ticker} ${exdStr} ${amount}: ${err.message}`);
  }
}

async function upsertEarning(connection, ticker, earningsDate, epsActual, epsEstimate, revenueActual, fiscalQuarter, fiscalYear, isEstimate) {
  const ed = parseDate(earningsDate);
  if (!ed) return;
  const edStr = ed.toISOString().slice(0,19).replace('T',' ');
  const sql = `
    INSERT INTO securities_earnings (
      ticker, earnings_date, earnings_date_end, is_estimate, eps_actual, eps_estimate, revenue_actual, fiscal_quarter, fiscal_year, data_source
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'yahoo')
    ON DUPLICATE KEY UPDATE
      eps_actual = IFNULL(VALUES(eps_actual), eps_actual),
      eps_estimate = IFNULL(VALUES(eps_estimate), eps_estimate),
      revenue_actual = IFNULL(VALUES(revenue_actual), revenue_actual),
      updated_at = CURRENT_TIMESTAMP
  `;
  try {
    await connection.execute(sql, [ticker, edStr, !!isEstimate, epsActual, epsEstimate, revenueActual, fiscalQuarter, fiscalYear]);
  } catch (err) {
    console.warn(`Failed upsert earnings ${ticker} ${edStr} eps:${epsActual} est:${epsEstimate} ${err.message}`);
  }
}

async function computeAndWriteTTM(connection, ticker) {
  // TTM dividends: sum of dividend_amount where ex_dividend_date within last 12 months (365 days)
  const [drows] = await connection.execute(`SELECT SUM(dividend_amount) AS sum_divs FROM securities_dividends WHERE ticker = ? AND ex_dividend_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND status IN ('confirmed','paid')`, [ticker]);
  const sumDivs = (drows && drows[0] && drows[0].sum_divs) ? parseFloat(drows[0].sum_divs) : null;

  // TTM EPS: sum of eps_actual for last 12 months
  const [erows] = await connection.execute(`SELECT SUM(eps_actual) AS sum_eps FROM securities_earnings WHERE ticker = ? AND earnings_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH) AND eps_actual IS NOT NULL`, [ticker]);
  const sumEps = (erows && erows[0] && erows[0].sum_eps) ? parseFloat(erows[0].sum_eps) : null;

  // Update securities_metadata
  try {
    await connection.execute(`UPDATE securities_metadata SET ttm_dividend_amount = ?, ttm_eps = ? WHERE ticker = ?`, [sumDivs, sumEps, ticker]);
    console.log(`  ✓ Wrote TTM for ${ticker}: dividends=${sumDivs} eps=${sumEps}`);
  } catch (err) {
    console.warn(`Failed update metadata TTM for ${ticker}: ${err.message}`);
  }
}

async function processTicker(connection, ticker) {
  console.log(`Fetching history for ${ticker}...`);

  // Dividends - now returns structured array directly (no CSV parsing needed)
  const dividendRows = await fetchDividends(ticker);
  if (dividendRows && dividendRows.length) {
    console.log(`  found ${dividendRows.length} dividend rows`);
    for (const r of dividendRows) {
      await upsertDividend(connection, ticker, r.ex_dividend_date, r.dividend_amount, 'confirmed');
    }
  } else {
    console.log(`  no dividend data available from yahoo-finance2 for ${ticker}`);
  }

  // Earnings: request earningsHistory and incomeStatementHistory
  const modules = ['earningsHistory','incomeStatementHistory','earnings'];
  const resp = await fetchQuoteSummaryModules(ticker, modules);
  
  // In yahoo-finance2 v3.x, quoteSummary returns the result directly (not wrapped in quoteSummary.result)
  // Handle both v2.x format ({ quoteSummary: { result: [...] } }) and v3.x format (direct object)
  let payload = null;
  if (resp) {
    if (resp.quoteSummary && resp.quoteSummary.result && Array.isArray(resp.quoteSummary.result)) {
      // v2.x / HTTP fallback format
      payload = resp.quoteSummary.result[0];
    } else if (resp.earningsHistory || resp.incomeStatementHistory || resp.earnings) {
      // v3.x library format - result is the payload directly
      payload = resp;
    }
  }
  
  debugLog(`quoteSummary payload for ${ticker}:`, payload ? Object.keys(payload) : 'null');

  if (payload) {

    // earningsHistory.history (array of reported quarters/years with eps)
    if (payload.earningsHistory && Array.isArray(payload.earningsHistory.history)) {
      const hist = payload.earningsHistory.history;
      console.log(`  found earningsHistory entries: ${hist.length}`);
      for (const item of hist) {
        // In v3.x, epsActual and epsEstimate are direct number properties (not wrapped in .raw)
        // Also check for legacy .eps.raw format for compatibility
        let epsActual = null;
        if (item.epsActual !== undefined && item.epsActual !== null) {
          epsActual = parseFloat(item.epsActual);
        } else if (item.eps && item.eps.raw !== undefined) {
          epsActual = parseFloat(item.eps.raw);
        }
        
        let epsEstimate = null;
        if (item.epsEstimate !== undefined && item.epsEstimate !== null && typeof item.epsEstimate === 'number') {
          epsEstimate = parseFloat(item.epsEstimate);
        } else if (item.epsEstimate && item.epsEstimate.raw !== undefined) {
          epsEstimate = parseFloat(item.epsEstimate.raw);
        }
        
        // In v3.x, the quarter field is an ISO date string like "2024-12-31T00:00:00.000Z"
        let earningsDate = null;
        if (item.quarter) {
          // quarter is now a Date string in v3.x
          earningsDate = new Date(item.quarter);
        } else if (item.period && typeof item.period === 'string' && item.period.match(/^\d{4}-\d{2}-\d{2}/)) {
          earningsDate = new Date(item.period);
        } else if (item.endDate?.raw) {
          earningsDate = new Date(item.endDate.raw * 1000);
        }
        
        // Extract fiscal quarter from period string like "-1q", "-2q", etc.
        let fiscalQuarter = null;
        if (item.period && typeof item.period === 'string') {
          const match = item.period.match(/-?(\d)q/i);
          if (match) fiscalQuarter = `Q${match[1]}`;
        }
        
        const fiscalYear = earningsDate ? earningsDate.getFullYear() : null;
        
        debugLog(`  earningsHistory item: date=${earningsDate}, epsActual=${epsActual}, epsEstimate=${epsEstimate}, quarter=${item.quarter}, period=${item.period}`);
        
        if (earningsDate && !isNaN(earningsDate.getTime()) && (epsActual !== null || epsEstimate !== null)) {
          await upsertEarning(connection, ticker, earningsDate, epsActual, epsEstimate, null, fiscalQuarter, fiscalYear, epsActual === null);
        }
      }
    } else {
      console.log('  no earningsHistory array in response');
    }

    // incomeStatementHistory (quarterly) -> basicEPS
    if (payload.incomeStatementHistory && Array.isArray(payload.incomeStatementHistory.incomeStatementHistory)) {
      const ins = payload.incomeStatementHistory.incomeStatementHistory;
      console.log(`  found incomeStatementHistory entries: ${ins.length}`);
      for (const q of ins) {
        const endDateRaw = q.endDate && q.endDate.raw ? q.endDate.raw : null;
        const earningsDate = endDateRaw ? new Date(endDateRaw * 1000) : null;
        const epsActual = q.basicEPS && q.basicEPS.raw ? parseFloat(q.basicEPS.raw) : null;
        const revenueActual = q.totalRevenue && q.totalRevenue.raw ? parseInt(q.totalRevenue.raw) : null;
        if (earningsDate && epsActual !== null) {
          await upsertEarning(connection, ticker, earningsDate, epsActual, null, revenueActual, null, (earningsDate ? earningsDate.getFullYear(): null), false);
        }
      }
    }
  } else {
    console.log(`  no quoteSummary payload for ${ticker}`);
  }

  // Compute TTM and write to metadata
  await computeAndWriteTTM(connection, ticker);
}

async function getUniqueTickers(connection, sourceAll=false, allMetadata=false) {
  if (sourceAll) {
    const [rows] = await connection.execute(`SELECT DISTINCT ticker FROM positions WHERE ticker IS NOT NULL AND ticker != 'CASH'`);
    return rows.map(r => r.ticker);
  }
  if (allMetadata) {
    const [rows] = await connection.execute(`SELECT DISTINCT ticker FROM securities_metadata WHERE ticker IS NOT NULL AND ticker != ''`);
    return rows.map(r => r.ticker);
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const tickerArg = args.includes('--ticker') ? args[args.indexOf('--ticker') + 1] : null;
  const allFlag = args.includes('--all');
  const allMetadataFlag = args.includes('--all-metadata');

  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE
  });

  try {
    let tickers = [];
    if (tickerArg) tickers = [tickerArg];
    else if (allFlag) tickers = await getUniqueTickers(connection, true, false);
    else if (allMetadataFlag) tickers = await getUniqueTickers(connection, false, true);
    else { console.log('Usage: node scripts/fetch_history_yahoo.js --ticker AAPL | --all | --all-metadata'); process.exit(1); }

    console.log(`Processing ${tickers.length} tickers...`);
    for (let i=0;i<tickers.length;i++) {
      const s = tickers[i];
      console.log(`\n[${i+1}/${tickers.length}] ${s}`);
      try { await processTicker(connection, s); } catch (err) { console.warn(`Error processing ${s}: ${err.message}`); }
      // gentle pacing
      if (i < tickers.length-1) await sleep(700);
    }

    console.log('\n✓ Done fetching history');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await connection.end();
  }
}

main();
