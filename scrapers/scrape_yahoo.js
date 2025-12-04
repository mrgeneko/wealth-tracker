// scrape_yahoo.js
// Fetch price data using yahoo-finance2 and publish in the same style as scrape_google

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
// Load yahoo-finance2 in a way that works for both CJS and ESM package exports.
let _yahooModule = null;
async function ensureYahoo() {
  if (_yahooModule) return _yahooModule;
  // Helper: detect ES6 class constructors so we can instantiate them.
  function isClass(fn) {
    if (typeof fn !== 'function') return false;
    const s = Function.prototype.toString.call(fn);
    return /^class\s/.test(s);
  }
  try {
    // Try CommonJS require first (works when package exposes CJS or default)
    const req = require('yahoo-finance2');
    _yahooModule = (req && req.default) ? req.default : req;
    // Normalize exports: package may export:
    // - an ES class constructor (you must `new` it),
    // - a function-style `quote` factory, or
    // - an object with `.quote` / `.quotes` methods.
    if (typeof _yahooModule === 'function') {
      // If it's an ES6 class or a constructor exposing `quote`/`quotes`, try to instantiate.
      if (isClass(_yahooModule) || (_yahooModule.prototype && (typeof _yahooModule.prototype.quote === 'function' || typeof _yahooModule.prototype.quotes === 'function'))) {
        try {
          _yahooModule = new _yahooModule();
        } catch (e) {
          // If instantiation fails (rare), create safe wrappers that instantiate per-call.
          const FnCtor = _yahooModule;
          _yahooModule = {
            quote: async (symbol, opts) => {
              try { const inst = new FnCtor(); return await inst.quote(symbol, opts); } catch (err) { return null; }
            },
            quotes: async (symbols, opts) => {
              const out = [];
              for (const s of symbols) {
                try { const inst = new FnCtor(); out.push(await inst.quote(s, opts)); } catch (err) { out.push(null); }
              }
              return out;
            }
          };
        }
      } else {
        // function-style export: wrap to provide both `quote` and `quotes`
        const fn = _yahooModule;
        _yahooModule = {
          quote: fn,
          quotes: (fn.quotes && typeof fn.quotes === 'function') ? fn.quotes.bind(fn) : async (symbols, opts) => {
            const out = [];
            for (const s of symbols) {
              try { out.push(await fn(s, opts)); } catch (err) { out.push(null); }
            }
            return out;
          }
        };
      }
    }
    // Ensure a `quotes` helper exists even if the resolved module only provides `quote`.
    if (typeof _yahooModule.quotes !== 'function' && typeof _yahooModule.quote === 'function') {
      const boundQuote = _yahooModule.quote.bind(_yahooModule);
      _yahooModule.quotes = async (symbols, opts) => {
        const out = [];
        for (const s of symbols) {
          try { out.push(await boundQuote(s, opts)); } catch (err) { out.push(null); }
          // gentle pacing when falling back to per-symbol quotes
          await sleep(250);
        }
        return out;
      };
    }
    return _yahooModule;
  } catch (err) {
    // Fall back to dynamic ESM import when package is ESM-only
    const imported = await import('yahoo-finance2');
    _yahooModule = (imported && imported.default) ? imported.default : imported;
    if (typeof _yahooModule === 'function') {
      // Distinguish ES6 class constructor vs function-style export in dynamic import path too
      if (isClass(_yahooModule) || (_yahooModule.prototype && (typeof _yahooModule.prototype.quote === 'function' || typeof _yahooModule.prototype.quotes === 'function'))) {
        try {
          _yahooModule = new _yahooModule();
        } catch (e) {
          const FnCtor = _yahooModule;
          _yahooModule = {
            quote: async (symbol, opts) => { try { const inst = new FnCtor(); return await inst.quote(symbol, opts); } catch (err) { return null; } },
            quotes: async (symbols, opts) => { const out = []; for (const s of symbols) { try { const inst = new FnCtor(); out.push(await inst.quote(s, opts)); } catch (err) { out.push(null); } } return out; }
          };
        }
      } else {
        const fn = _yahooModule;
        _yahooModule = {
          quote: fn,
          quotes: (fn.quotes && typeof fn.quotes === 'function') ? fn.quotes.bind(fn) : async (symbols, opts) => {
            const out = [];
            for (const s of symbols) {
              try { out.push(await fn(s, opts)); } catch (err) { out.push(null); }
            }
            return out;
          }
        };
      }
    }
    // Ensure a `quotes` helper exists even if the resolved module only provides `quote`.
    if (typeof _yahooModule.quotes !== 'function' && typeof _yahooModule.quote === 'function') {
      const boundQuote = _yahooModule.quote.bind(_yahooModule);
      _yahooModule.quotes = async (symbols, opts) => {
        const out = [];
        for (const s of symbols) {
          try { out.push(await boundQuote(s, opts)); } catch (err) { out.push(null); }
          // gentle pacing when falling back to per-symbol quotes
          await sleep(250);
        }
        return out;
      };
    }
    return _yahooModule;
  }
}
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug } = require('./scraper_utils');

// Helper to map Yahoo quote object to our internal data structure
function mapYahooQuoteToData(quote, securityKey) {
  const p = quote.price || quote || {};
  const qm = epochToMs(p.regularMarketTime);
  const afterHoursQuoteTime = epochToMs(p.postMarketTime);
  const preMarketQuoteTime = epochToMs(p.preMarketTime);

  return {
    key: sanitizeForFilename(securityKey),
    regular_last_price: (p.regularMarketPrice != null) ? String(p.regularMarketPrice) : '',
    regular_change_decimal: (p.regularMarketChange != null) ? String(p.regularMarketChange) : '',
    regular_change_percent: (p.regularMarketChangePercent != null) ? (String(p.regularMarketChangePercent) + '%') : '',
    regular_time: qm ? new Date(qm).toISOString() : '',
    previous_close_price: (p.regularMarketPreviousClose != null) ? String(p.regularMarketPreviousClose) : '',
    after_hours_price: (p.postMarketPrice != null) ? String(p.postMarketPrice) : '',
    after_hours_change_decimal: (p.postMarketChange != null) ? String(p.postMarketChange) : '',
    after_hours_change_percent: (p.postMarketChangePercent != null) ? (String(p.postMarketChangePercent) + '%') : '',
    after_hours_time: afterHoursQuoteTime ? new Date(afterHoursQuoteTime).toISOString() : '',
    pre_market_price: (p.preMarketPrice != null) ? String(p.preMarketPrice) : '',
    pre_market_price_change_decimal: (p.preMarketChange != null) ? String(p.preMarketChange) : '',
    pre_market_price_change_percent: (p.preMarketChangePercent != null) ? (String(p.preMarketChangePercent) + '%') : '',
    pre_market_quote_time: preMarketQuoteTime ? new Date(preMarketQuoteTime).toISOString() : '',
    source: 'yahoo',
    capture_time: new Date().toISOString()
  };
}

async function scrapeYahoo(browser, security, outputDir) {
  let data = {};
  try {
    const yahoo = await ensureYahoo();
    const tickerRaw = (security.ticker_yahoo || '').toString().trim();
    if (!tickerRaw) {
      logDebug('No yahoo ticker specified for ' + security.key);
      return {};
    }
    // If the csv uses a full URL, try to extract symbol (not expected here)
    const ticker = sanitizeForFilename(tickerRaw.replace(/^https?:\/\/(?:www\.)?finance\.yahoo\.com\/.+quote\//i, ''));
    logDebug(`Security: ${ticker}   query Yahoo Finance for ${tickerRaw}`);

    // Use yahoo-finance2 to fetch quote data
    // The `quote`/`quotes` endpoints return fields at the top level (e.g., regularMarketPrice),
    // not nested under a `price` module. We'll support both shapes just in case.
    let quote = null;
    try {
      quote = await yahoo.quote(tickerRaw);
      // Write full Yahoo API response to a .json file
      try {
        const rawFileName = `${getDateTimeString()}.${sanitizeForFilename(security.key)}.yahoo_raw.json`;
        const rawFilePath = path.join(outputDir, rawFileName);
        fs.writeFileSync(rawFilePath, JSON.stringify(quote, null, 2), 'utf-8');
      } catch (e) { logDebug('Error saving Yahoo raw JSON: ' + e); }
    } catch (e) {
      logDebug('Yahoo quote fetch error for ' + tickerRaw + ': ' + e);
      // try a raw symbol only attempt
      try {
        quote = await yahoo.quote(ticker);
        try {
          const rawFileName = `${getDateTimeString()}.${sanitizeForFilename(security.key)}.yahoo_raw.json`;
          const rawFilePath = path.join(outputDir, rawFileName);
          fs.writeFileSync(rawFilePath, JSON.stringify(quote, null, 2), 'utf-8');
        } catch (e) { logDebug('Error saving Yahoo raw JSON (fallback): ' + e); }
      } catch (e2) { logDebug('Yahoo fallback quote fetch error: ' + e2); }
    }

    if (!quote) {
      logDebug('Yahoo returned no object for ' + tickerRaw);
      return {};
    }

    data = mapYahooQuoteToData(quote, security.key);

    logDebug('Yahoo Finance data: ' + JSON.stringify(data));

    // Publish to Kafka
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeYahoo';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
      logDebug(`Published Yahoo Finance data to Kafka topic ${kafkaTopic}`);
    } catch (kafkaErr) {
      logDebug('Kafka publish error (Yahoo): ' + kafkaErr);
    }

    // Save JSON file
    try {
      const jsonFileName = `${getDateTimeString()}.${sanitizeForFilename(security.key)}.yahoo.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved Yahoo JSON to ${jsonFilePath}`);
      } catch (e) {
        logDebug('Error saving Yahoo JSON: ' + e);
      }

    } catch (err) {
      logDebug('Error in scrapeYahoo: ' + err);
    }
    return data;
  }

// helpers
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(ms, ratio = 0.2) {
  const delta = ms * ratio;
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * delta));
}
function parseRetryAfter(hdr) {
  if (!hdr) return null;
  const n = Number(hdr);
  if (!Number.isNaN(n) && n >= 0) return n; // seconds
  // RFC allows date-time; ignore for simplicity
  return null;
}

// Normalize epoch-like values from Yahoo: some fields may be seconds or milliseconds.
function epochToMs(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  // Seconds are ~1e9 (2025 ~= 1.7e9). Milliseconds are ~1e12.
  // If the value looks like milliseconds, leave as-is; otherwise assume seconds.
  return n > 1e12 ? n : Math.round(n * 1000);
}

// Batch-mode fetcher with adaptive fallback.
// - Chunks symbols with pacing
// - On 429: honors Retry-After when present, else exponential backoff with jitter
// - After sustained 429s on a chunk: degrades to single-quote requests with pacing
async function scrapeYahooBatch(browser, securities, outputDir, options = {}) {
  const envChunk = parseInt(process.env.YAHOO_CHUNK_SIZE || '', 10);
  const envDelay = parseInt(process.env.YAHOO_DELAY_MS || '', 10);
  const envMaxRetries = parseInt(process.env.YAHOO_MAX_RETRIES || '', 10);
  const envBackoffBase = parseInt(process.env.YAHOO_BACKOFF_BASE_MS || '', 10);

  const chunkSize = (Number.isFinite(options.chunkSize) ? options.chunkSize : (Number.isFinite(envChunk) ? envChunk : 2));
  const baseDelayMs = (Number.isFinite(options.delayMs) ? options.delayMs : (Number.isFinite(envDelay) ? envDelay : 5000));
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : (Number.isFinite(envMaxRetries) ? envMaxRetries : 4);
  const backoffBaseMs = Number.isFinite(options.backoffBaseMs) ? options.backoffBaseMs : (Number.isFinite(envBackoffBase) ? envBackoffBase : 1000);

  const results = [];
  if (!Array.isArray(securities) || securities.length === 0) return results;
  // Build mapping from normalized ticker -> security
  const mapping = {};
  const symbols = [];
  for (const sec of securities) {
    // Read ticker from CSV field `ticker_yahoo` (do not use `yahoo`).
    const tickerRaw = (sec.ticker_yahoo || '').toString().trim();
    if (!tickerRaw) continue;
    // normalize to a simple symbol for lookup (best-effort)
    const sym = tickerRaw.replace(/^https?:\/\/(?:www\.)?finance\.yahoo\.com\/.+quote\//i, '') || tickerRaw;
    // keep original security for writing/publishing
    mapping[sym] = mapping[sym] || [];
    mapping[sym].push(sec);
    symbols.push(sym);
  }

  // helper chunker
  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  const chunks = chunkArray(symbols, chunkSize);
  for (const chunk of chunks) {
    let chunkRes = null;
    const yahoo = await ensureYahoo();

    // try batch with 429-aware retries
    let attempt = 0;
    let lastErr = null;
    while (attempt <= maxRetries) {
      try {
        // `quotes` returns an array of quote objects with top-level price fields
        chunkRes = await yahoo.quotes(chunk);
        break; // success
      } catch (e) {
        lastErr = e;
        const status = (e && (e.status || (e.response && e.response.status))) || (String(e && e.message).includes('429') ? 429 : undefined);
        if (status === 429) {
          const ra = e && e.response && e.response.headers && (e.response.headers['retry-after'] || e.response.headers['Retry-After']);
          const raSec = parseRetryAfter(ra);
          const waitMs = raSec != null ? raSec * 1000 : jitter(backoffBaseMs * Math.pow(2, attempt));
          logDebug(`Yahoo batch 429: attempt ${attempt + 1}/${maxRetries + 1}, waiting ${waitMs}ms`);
          await sleep(waitMs);
          attempt++;
          continue;
        } else {
          // non-429 error: do a short backoff then retry until maxRetries
          const waitMs = jitter(backoffBaseMs * Math.pow(2, attempt));
          logDebug(`Yahoo batch error: ${e}. attempt ${attempt + 1}/${maxRetries + 1}, waiting ${waitMs}ms`);
          await sleep(waitMs);
          attempt++;
          continue;
        }
      }
    }

    // If still no chunk result after retries, degrade to single-quote mode
    if (!chunkRes) {
      logDebug('Yahoo batch: degrading to single-quote mode for chunk due to repeated errors');
      chunkRes = [];
      for (const sym of chunk) {
        let single = null;
        let sAttempt = 0;
        while (sAttempt <= maxRetries) {
          try {
            single = await yahoo.quote(sym);
            // Write full Yahoo API response to a .json file
            try {
              const rawFileName = `${getDateTimeString()}.${sanitizeForFilename(sym)}.yahoo_raw.json`;
              const rawFilePath = path.join(outputDir, rawFileName);
              fs.writeFileSync(rawFilePath, JSON.stringify(single, null, 2), 'utf-8');
            } catch (e) { logDebug('Error saving Yahoo raw JSON (batch single): ' + e); }
            break;
          } catch (e) {
            const status = (e && (e.status || (e.response && e.response.status))) || (String(e && e.message).includes('429') ? 429 : undefined);
            if (status === 429) {
              const ra = e && e.response && e.response.headers && (e.response.headers['retry-after'] || e.response.headers['Retry-After']);
              const raSec = parseRetryAfter(ra);
              const waitMs = raSec != null ? raSec * 1000 : jitter(backoffBaseMs * Math.pow(2, sAttempt));
              logDebug(`Yahoo single 429 for ${sym}: attempt ${sAttempt + 1}/${maxRetries + 1}, waiting ${waitMs}ms`);
              await sleep(waitMs);
              sAttempt++;
              continue;
            } else {
              const waitMs = jitter(backoffBaseMs * Math.pow(2, sAttempt));
              logDebug(`Yahoo single error for ${sym}: ${e}. attempt ${sAttempt + 1}/${maxRetries + 1}, waiting ${waitMs}ms`);
              await sleep(waitMs);
              sAttempt++;
              continue;
            }
          }
        }
        chunkRes.push(single);
        // pacing between single requests
        await sleep(jitter(Math.max(1000, Math.floor(baseDelayMs / Math.max(1, chunkSize)))));
      }
    } else {
      // Write full Yahoo API batch response to a .json file
      try {
        const rawFileName = `${getDateTimeString()}.yahoo_batch_raw.json`;
        const rawFilePath = path.join(outputDir, rawFileName);
        fs.writeFileSync(rawFilePath, JSON.stringify(chunkRes, null, 2), 'utf-8');
      } catch (e) { logDebug('Error saving Yahoo raw JSON (batch): ' + e); }
    }

    if (!Array.isArray(chunkRes)) {
      if (chunk.length === 1 && chunkRes) chunkRes = [chunkRes];
      else chunkRes = [];
    }

    for (let i = 0; i < chunk.length; i++) {
      const querySym = chunk[i];
      const single = chunkRes[i] || null;
      // If single is null, try to find by symbol property
      let quoteObj = single;
      if (!quoteObj && chunkRes.length) {
        quoteObj = chunkRes.find(r => (r && (r.symbol === querySym || (r.price && r.price.symbol === querySym))));
      }
      const targets = mapping[querySym] || [];
      if (!quoteObj) {
        logDebug(`Yahoo batch: no quote returned for ${querySym}`);
        // still create empty results for each mapped security
        for (const sec of targets) {
          const datum = { key: sanitizeForFilename(sec.key), source: 'yahoo', error: 'no_quote' };
          results.push(datum);
        }
        continue;
      }

      const p = quoteObj.price || quoteObj || {};
      
      // Use helper to map data, but we need to override key/source/capture_time per security
      const commonData = mapYahooQuoteToData(quoteObj, 'temp');
      // Remove fields we want to set per-security
      delete commonData.key;
      delete commonData.source;
      delete commonData.capture_time;

      for (const sec of targets) {
        const data = Object.assign(
          { 
            key: sanitizeForFilename(sec.key), 
            source: 'yahoo', 
            capture_time: new Date().toISOString() 
          }, 
          commonData
        );
        
        // publish per-security
        try {
          const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeYahoo';
          const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
          await publishToKafka(data, kafkaTopic, kafkaBrokers);
        } catch (kafkaErr) { logDebug('Kafka publish error (Yahoo batch): ' + kafkaErr); }
        // write JSON file
        try {
          const jsonFileName = `${getDateTimeString()}.${sanitizeForFilename(sec.key)}.yahoo.json`;
          const jsonFilePath = path.join(outputDir, jsonFileName);
          fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) { logDebug('Error saving Yahoo JSON (batch): ' + e); }
        results.push(data);
      }
    }

    // small polite pause between chunks
    await sleep(jitter(baseDelayMs));
  }

  return results;
}

module.exports = { scrapeYahoo, scrapeYahooBatch };

// Simple helper for quick manual testing or REPL usage.
// Example: require('./scrape_yahoo').fetchStockData('AAPL')
async function fetchStockData(ticker) {
  try {
    const yahoo = await ensureYahoo();
    const quote = await yahoo.quote(ticker);
    const p = quote && (quote.price || quote) ;
    const price = p && (p.regularMarketPrice != null ? p.regularMarketPrice : (p.regularPrice != null ? p.regularPrice : null));
    if (price == null) {
      console.log(`No price available for ${ticker}`);
      return null;
    }
    console.log(`Current Price of ${ticker}: $${price}`);
    return { ticker, price };
  } catch (error) {
    console.error(`Failed to fetch data for ${ticker}:`, error && (error.stack || error.message || error));
    return null;
  }
}

module.exports.fetchStockData = fetchStockData;
