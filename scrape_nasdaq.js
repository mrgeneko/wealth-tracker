// scrape_nasdaq.js
// Scrape Nasdaq quote pages (e.g., https://www.nasdaq.com/market-activity/etf/qqq)

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,$\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeNasdaq(browser, security, outputDir) {
  let page = null;
  let data = {};
  try {
    const url = security.nasdaq || security.nasdaq_quote || security.nasdaqUrl;
    if (!url) {
      logDebug('No Nasdaq URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open Nasdaq: ${url}`);
    const snapshotBase = path.join(outputDir, `${ticker}.nasdaq.${getDateTimeString()}`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 25000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved Nasdaq snapshot base ${snapshotBase}`);

    try {
      const htmlOutPath = `/usr/src/app/logs/${ticker}.nasdaq.${getDateTimeString()}.html`;
      fs.writeFileSync(htmlOutPath, html || await page.content(), 'utf-8');
      logDebug(`Wrote full Nasdaq HTML to ${htmlOutPath}`);
    } catch (e) { logDebug('Failed to write Nasdaq full page HTML: ' + e); }

    const result = parseNasdaqHtml(html || '', { key: ticker });
    data = result;

    // If DOM parsing didn't find main fields, call Nasdaq API as a fallback
    if ((!data.last_price || data.last_price === '') || (!data.previous_close_price || data.previous_close_price === '')) {
      try {
        logDebug('DOM parse incomplete for ' + ticker + ', calling Nasdaq API fallback');
        const apiData = await fetchNasdaqApi(ticker);
        // merge only missing fields
        data.last_price = data.last_price || apiData.last_price || '';
        data.price_change_decimal = data.price_change_decimal || apiData.price_change_decimal || '';
        data.price_change_percent = data.price_change_percent || apiData.price_change_percent || '';
        data.previous_close_price = data.previous_close_price || apiData.previous_close_price || '';
        data.after_hours_price = data.after_hours_price || apiData.after_hours_price || '';
        data.after_hours_change_decimal = data.after_hours_change_decimal || apiData.after_hours_change_decimal || '';
        data.after_hours_change_percent = data.after_hours_change_percent || apiData.after_hours_change_percent || '';
        data.quote_time = data.quote_time || apiData.quote_time || '';
      } catch (e) { logDebug('Nasdaq API fallback error: ' + e); }
    }

    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeNasdaq';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (Nasdaq): ' + kafkaErr); }

    try {
      const jsonFileName = `${ticker}.nasdaq.${getDateTimeString()}.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved Nasdaq JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving Nasdaq JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeNasdaq: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing Nasdaq tab: ' + e); } } }
  return data;
}

function parseNasdaqHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

  let last_price = '';
  let price_change_decimal = '';
  let price_change_percent = '';
  let previous_close_price = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let quote_time = '';

  try {
    // 1) Try embedded JSON common on Nasdaq pages
    try {
      const scripts = $('script').map((i, el) => $(el).html() || '').get().join('\n');
      const initMatch = scripts.match(/window\.__?INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/i) || scripts.match(/window\.__data\s*=\s*(\{[\s\S]*?\});/i);
      if (initMatch && initMatch[1]) {
        try {
          const o = JSON.parse(initMatch[1]);
          if (o && o.page && o.page.props && o.page.props.initialState && o.page.props.initialState.quote) {
            const qd = o.page.props.initialState.quote;
            if (qd.last) last_price = cleanNumberText(qd.last);
            if (qd.change) price_change_decimal = cleanNumberText(qd.change);
            if (qd.changePercent) price_change_percent = String(qd.changePercent);
            if (qd.previousClose) previous_close_price = cleanNumberText(qd.previousClose);
            if (qd.extended && qd.extended.last) after_hours_price = cleanNumberText(qd.extended.last);
            if (qd.extended && qd.extended.change) after_hours_change_decimal = cleanNumberText(qd.extended.change);
            if (qd.extended && qd.extended.changePercent) after_hours_change_percent = String(qd.extended.changePercent);
            if (qd.lastTradeTime) quote_time = qd.lastTradeTime;
          } else if (o && o.quote && o.quote.last) {
            const qd = o.quote;
            if (qd.last) last_price = cleanNumberText(qd.last);
            if (qd.change) price_change_decimal = cleanNumberText(qd.change);
          }
        } catch (e) {
          // ignore JSON parse errors
        }
      }
    } catch (e) {
      // ignore
    }

    // 2) Prefer specific Nasdaq selectors if present
    if (!last_price) {
      const headerPrice = $('[class*="symbol-page-header__pricing-price"], [class*="qwidget-dollar"] , [class*="quote-header__price"]').first();
      if (headerPrice && headerPrice.length) last_price = cleanNumberText(headerPrice.text());
    }
    if (!price_change_decimal || !price_change_percent) {
      const headerChange = $('[class*="symbol-page-header__pricing-change"], [class*="qwidget-change"], [class*="quote-header__change"]').first();
      if (headerChange && headerChange.length) {
        const txt = headerChange.text().replace(/\s+/g,' ').trim();
        const m = txt.match(/([+-]?[0-9,.]+)\s*\(?([+-]?[0-9,.]+%?)?\)?/);
        if (m) {
          price_change_decimal = cleanNumberText(m[1]).replace(/^\+/, '');
          price_change_percent = m[2] ? String(m[2]).replace(/\s/g,'') : '';
        }
      }
    }

    // previous close: look for labels
    if (!previous_close_price) {
      const prev = $('*:contains("Previous Close"), *:contains("Prev Close")').filter((i,el)=>$(el).text().match(/Previous Close|Prev Close/i)).first();
      if (prev && prev.length) {
        const next = prev.next();
        if (next && next.length && /[0-9]/.test(next.text())) previous_close_price = cleanNumberText(next.text());
        else {
          const parent = prev.parent();
          const cand = parent.find('*').filter((i,el)=> /[0-9]+\.?[0-9]*/.test($(el).text())).first();
          if (cand && cand.length) previous_close_price = cleanNumberText(cand.text());
        }
      }
    }

    // after-hours: check for labels like 'After Hours' or 'Extended Hours'
    if (!after_hours_price) {
      const ext = $('*:contains("After Hours"), *:contains("Extended Hours")').filter((i,el)=>$(el).text().match(/After Hours|Extended Hours/i)).first();
      if (ext && ext.length) {
        const container = ext.parent();
        const p = container.find('*').filter((i,el)=> /[0-9]+\.[0-9]{1,2}/.test($(el).text())).first();
        if (p && p.length) after_hours_price = cleanNumberText(p.text());
        const changeEl = container.find('*').filter((i,el)=> /[+\-][0-9].*%?/.test($(el).text())).first();
        if (changeEl && changeEl.length) {
          const cm = String(changeEl.text()).match(/([+-]?[0-9,\.]+)\s*\(?([+-]?[0-9,\.]+%?)?\)?/);
          if (cm) {
            after_hours_change_decimal = cleanNumberText(cm[1]).replace(/^\+/, '');
            after_hours_change_percent = cm[2] ? String(cm[2]).replace(/\s/g,'') : '';
          }
        }
      }
    }

    // quote_time: try common labels and time regex
    if (!quote_time) {
      const timeEl = $('*:contains("As of"), *:contains("Last")').filter((i,el)=> /As of|Last/.test($(el).text())).first();
      if (timeEl && timeEl.length) {
        const txt = timeEl.text().replace(/\s+/g,' ').trim();
        const m = txt.match(/([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)(?:\s*[A-Z]{2,3})?)/i);
        if (m) quote_time = m[1];
      }
    }

  } catch (e) {
    logDebug('parseNasdaqHtml error: ' + e);
  }

  return {
    key: ticker,
    last_price: last_price || '',
    price_change_decimal: price_change_decimal || '',
    price_change_percent: price_change_percent || '',
    previous_close_price: previous_close_price || '',
    after_hours_price: after_hours_price || '',
    after_hours_change_decimal: after_hours_change_decimal || '',
    after_hours_change_percent: after_hours_change_percent || '',
    source: 'nasdaq',
    capture_time: new Date().toISOString().replace('T',' ').replace('Z',' UTC'),
    quote_time: quote_time || ''
  };
}

async function fetchNasdaqApi(symbol) {
  // Use Nasdaq public API endpoints to fetch info and summary. Try fetch first, then curl fallback.
  const { execSync } = require('child_process');
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' };
  const out = {
    last_price: '',
    price_change_decimal: '',
    price_change_percent: '',
    previous_close_price: '',
    after_hours_price: '',
    after_hours_change_decimal: '',
    after_hours_change_percent: '',
    quote_time: ''
  };
  // Try several assetclass variants: stocks (or stock), etf, or no assetclass.
  const candidates = [ 'stock', 'stocks', 'etf', '' ];
  function infoUrlFor(ac) { return ac ? `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${ac}` : `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info`; }
  function summaryUrlFor(ac) { return ac ? `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${ac}` : `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary`; }
  function clean(s){ if (!s && s !== 0) return ''; return String(s).replace(/[^0-9.\-]/g,''); }
  // Try fetch (modern Node) across candidate asset classes. Stop when we see valid primary.lastSalePrice or previous close.
  try {
    if (typeof fetch === 'function') {
      for (const ac of candidates) {
        try {
          const infoUrlC = infoUrlFor(ac);
          const summaryUrlC = summaryUrlFor(ac);
          const [infoRes, summaryRes] = await Promise.all([
            fetch(infoUrlC, { headers }),
            fetch(summaryUrlC, { headers })
          ]);
          const infoJson = infoRes.ok ? await infoRes.json() : null;
          const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
          const primary = infoJson && infoJson.data && infoJson.data.primaryData ? infoJson.data.primaryData : {};
          const prev = summaryJson && summaryJson.data && summaryJson.data.summaryData && summaryJson.data.summaryData.PreviousClose && summaryJson.data.summaryData.PreviousClose.value ? summaryJson.data.summaryData.PreviousClose.value : '';
          const lp = clean(primary.lastSalePrice);
          const prevClean = clean(prev);
          if (lp || prevClean) {
            out.last_price = lp;
            out.price_change_decimal = clean(primary.netChange);
            out.price_change_percent = primary.percentageChange || '';
            out.previous_close_price = prevClean;
            out.quote_time = primary.lastTradeTimestamp || '';
            return out;
          }
        } catch (innerE) {
          logDebug(`fetch for assetclass=${ac} failed: ${innerE}`);
        }
      }
    }
  } catch (e) {
    logDebug('fetch attempt overall failed: ' + e);
  }

  // Curl fallback across candidates
  try {
    for (const ac of candidates) {
      try {
        const infoUrlC = infoUrlFor(ac);
        const summaryUrlC = summaryUrlFor(ac);
        const infoRaw = execSync(`curl -s -A 'Mozilla/5.0' '${infoUrlC}'`);
        const summaryRaw = execSync(`curl -s -A 'Mozilla/5.0' '${summaryUrlC}'`);
        let infoJson = null, summaryJson = null;
        try { infoJson = JSON.parse(infoRaw.toString()); } catch (e) { logDebug('parse infoRaw err: '+e); }
        try { summaryJson = JSON.parse(summaryRaw.toString()); } catch (e) { logDebug('parse summaryRaw err: '+e); }
        const primary = infoJson && infoJson.data && infoJson.data.primaryData ? infoJson.data.primaryData : {};
        const prev = summaryJson && summaryJson.data && summaryJson.data.summaryData && summaryJson.data.summaryData.PreviousClose && summaryJson.data.summaryData.PreviousClose.value ? summaryJson.data.summaryData.PreviousClose.value : '';
        const lp = clean(primary.lastSalePrice);
        const prevClean = clean(prev);
        if (lp || prevClean) {
          out.last_price = lp;
          out.price_change_decimal = clean(primary.netChange);
          out.price_change_percent = primary.percentageChange || '';
          out.previous_close_price = prevClean;
          out.quote_time = primary.lastTradeTimestamp || '';
          return out;
        }
      } catch (innerE) {
        logDebug(`curl for assetclass=${ac} failed: ${innerE}`);
      }
    }
  } catch (e) {
    logDebug('curl fallback overall error: '+e);
  }
  return out;
}

module.exports = { scrapeNasdaq, parseNasdaqHtml, fetchNasdaqApi };
