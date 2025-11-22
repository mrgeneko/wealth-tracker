// scrape_nasdaq.js
// Scrape Nasdaq quote pages (e.g., https://www.nasdaq.com/market-activity/etf/qqq)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
      const snapshotBase = path.join(outputDir, `${getDateTimeString()}.${ticker}.nasdaq`);
      const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 25000, gotoRetries: 3 };

      // Track which path satisfied the scrape so we can log metrics
      let cheapHtml = '';
      let usedCheapPath = false;
      let usedBrowser = false;

      // 1) Try a cheap HTML fetch first (no browser). This captures embedded JSON in many cases.
      try {
        const fetchHeaders = { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
        logDebug('Attempting simple HTML fetch for ' + ticker);
        if (typeof fetch === 'function') {
          const res = await fetch(url, { headers: fetchHeaders });
          if (res && res.ok) {
            cheapHtml = await res.text();
          }
        } else {
          // fallback to curl if global fetch not available
          try { cheapHtml = execSync(`curl -s -A 'Mozilla/5.0' '${url}'`).toString(); } catch (e) { logDebug('curl html fetch failed: ' + e); }
        }
        if (cheapHtml) {
          try {
            const htmlOutPath = path.join(outputDir, `${getDateTimeString()}.${ticker}.nasdaq.html`);
            fs.writeFileSync(htmlOutPath, cheapHtml, 'utf-8');
            logDebug(`Wrote Nasdaq HTML (cheap fetch) to ${htmlOutPath}`);
          } catch (e) { logDebug('Failed to write cheap-fetched HTML: ' + e); }
          const result = parseNasdaqHtml(cheapHtml || '', { key: ticker });
          data = result;
        }
      } catch (e) { logDebug('Cheap HTML fetch error: ' + e); }

      // 2) Always call Nasdaq API to get structured primary data and marketStatus
      try {
        logDebug('Calling Nasdaq API to supplement parsed HTML for ' + ticker);
        const apiData = await fetchNasdaqApi(ticker);
        // merge only missing fields
        data.last_price = data.last_price || apiData.last_price || '';
        data.price_change_decimal = data.price_change_decimal || apiData.price_change_decimal || '';
        data.price_change_percent = data.price_change_percent || apiData.price_change_percent || '';
        data.previous_close_price = data.previous_close_price || apiData.previous_close_price || '';
        data.after_hours_price = data.after_hours_price || apiData.after_hours_price || '';
        data.after_hours_change_decimal = data.after_hours_change_decimal || apiData.after_hours_change_decimal || '';
        data.after_hours_change_percent = data.after_hours_change_percent || apiData.after_hours_change_percent || '';
        data.pre_market_price = data.pre_market_price || apiData.pre_market_price || '';
        data.pre_market_price_change_decimal = data.pre_market_price_change_decimal || apiData.pre_market_price_change_decimal || '';
        data.pre_market_price_change_percent = data.pre_market_price_change_percent || apiData.pre_market_price_change_percent || '';
        data.quote_time = data.quote_time || apiData.quote_time || '';
        // If API reports market status and extended-session fields are still missing,
        // populate from primary API values when marketStatus indicates an extended session.
        try {
          const apiMarket = apiData.market_status || apiData.marketStatus || '';
          if ((!data.after_hours_price || data.after_hours_price === '') && /after[- ]?hours/i.test(String(apiMarket))) {
            data.after_hours_price = data.after_hours_price || apiData.last_price || '';
            data.after_hours_change_decimal = data.after_hours_change_decimal || apiData.price_change_decimal || '';
            data.after_hours_change_percent = data.after_hours_change_percent || apiData.price_change_percent || '';
          }
          if ((!data.pre_market_price || data.pre_market_price === '') && /pre[- ]?market/i.test(String(apiMarket))) {
            data.pre_market_price = data.pre_market_price || apiData.pre_market_price || apiData.last_price || '';
            data.pre_market_price_change_decimal = data.pre_market_price_change_decimal || apiData.pre_market_price_change_decimal || apiData.price_change_decimal || '';
            data.pre_market_price_change_percent = data.pre_market_price_change_percent || apiData.pre_market_price_change_percent || apiData.price_change_percent || '';
          }
        } catch (e) { /* ignore */ }
      } catch (e) { logDebug('Nasdaq API fallback error: ' + e); }

      // 3) If we still don't have required fields (primary or extended), fall back to full browser render
      const needBrowser = ((!data.last_price || data.last_price === '') || (!data.previous_close_price || data.previous_close_price === '') ||
        ((!data.after_hours_price || data.after_hours_price === '') && (!data.pre_market_price || data.pre_market_price === '')));
      // Log whether the cheap path was sufficient
      if (!needBrowser) {
        usedCheapPath = true;
        logDebug(`nasdaq scrape: cheap HTML+API path satisfied for ${ticker}`);
      } else {
        logDebug(`nasdaq scrape: cheap HTML+API insufficient for ${ticker}, will use Puppeteer`);
      }

      if (needBrowser) {
        try {
          usedBrowser = true;
          page = await createPreparedPage(browser, pageOpts);
          logDebug('Page loaded. Extracting HTML (full render)...');
          const html = await savePageSnapshot(page, snapshotBase);
          if (html) logDebug(`Saved Nasdaq snapshot base ${snapshotBase}`);
          
          const result = parseNasdaqHtml(html || await page.content(), { key: ticker });
          // merge parsed page values (prefer page values when present)
          data.last_price = result.last_price || data.last_price || '';
          data.price_change_decimal = result.price_change_decimal || data.price_change_decimal || '';
          data.price_change_percent = result.price_change_percent || data.price_change_percent || '';
          data.previous_close_price = result.previous_close_price || data.previous_close_price || '';
          data.after_hours_price = result.after_hours_price || data.after_hours_price || '';
          data.after_hours_change_decimal = result.after_hours_change_decimal || data.after_hours_change_decimal || '';
          data.after_hours_change_percent = result.after_hours_change_percent || data.after_hours_change_percent || '';
          data.pre_market_price = result.pre_market_price || data.pre_market_price || '';
          data.pre_market_price_change_decimal = result.pre_market_price_change_decimal || data.pre_market_price_change_decimal || '';
          data.pre_market_price_change_percent = result.pre_market_price_change_percent || data.pre_market_price_change_percent || '';
          data.quote_time = result.quote_time || data.quote_time || '';
        } catch (e) { logDebug('Full page render fallback error: ' + e); }
      }

      // Final path used log
      try {
        logDebug(`nasdaq scrape path used for ${ticker}: ${usedBrowser ? 'browser' : 'cheap+api'}`);
      } catch (e) { /* ignore logging errors */ }

    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeNasdaq';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (Nasdaq): ' + kafkaErr); }

    try {
      const jsonFileName = `${getDateTimeString()}.${ticker}.nasdaq.json`;
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
  let pre_market_price = '';
  let pre_market_change_decimal = '';
  let pre_market_change_percent = '';
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
            if (qd.preMarket && qd.preMarket.last) pre_market_price = cleanNumberText(qd.preMarket.last);
            if (qd.preMarket && qd.preMarket.change) pre_market_change_decimal = cleanNumberText(qd.preMarket.change);
            if (qd.preMarket && qd.preMarket.changePercent) pre_market_change_percent = String(qd.preMarket.changePercent);
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

    // pre-market: check for labels like 'Pre-Market' or 'Pre Market'
    if (!pre_market_price) {
      const pre = $('*:contains("Pre-Market"), *:contains("Pre Market")').filter((i,el)=>$(el).text().match(/Pre[- ]?Market/i)).first();
      if (pre && pre.length) {
        const container = pre.parent();
        const p = container.find('*').filter((i,el)=> /[0-9]+\.[0-9]{1,2}/.test($(el).text())).first();
        if (p && p.length) pre_market_price = cleanNumberText(p.text());
        const changeEl = container.find('*').filter((i,el)=> /[+\-][0-9].*%?/.test($(el).text())).first();
        if (changeEl && changeEl.length) {
          const cm = String(changeEl.text()).match(/([+-]?[0-9,\.]+)\s*\(?([+-]?[0-9,\.]+%?)?\)?/);
          if (cm) {
            pre_market_change_decimal = cleanNumberText(cm[1]).replace(/^\+/, '');
            pre_market_change_percent = cm[2] ? String(cm[2]).replace(/\s/g,'') : '';
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
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' };
  const out = {
    last_price: '', price_change_decimal: '', price_change_percent: '', previous_close_price: '',
    after_hours_price: '', after_hours_change_decimal: '', after_hours_change_percent: '',
    pre_market_price: '', pre_market_price_change_decimal: '', pre_market_price_change_percent: '',
    quote_time: '', market_status: ''
  };
  // Try several assetclass variants: stocks (or stock), etf, or no assetclass.
  const candidates = [ 'stock', 'stocks', 'etf', '' ];
  const infoUrlFor = (ac) => ac ? `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${ac}` : `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info`;
  const summaryUrlFor = (ac) => ac ? `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary?assetclass=${ac}` : `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/summary`;

  // Helper to process JSON data from API
  const processApiData = (infoJson, summaryJson) => {
    const primary = infoJson && infoJson.data && infoJson.data.primaryData ? infoJson.data.primaryData : {};
    const marketStatusTop = infoJson && infoJson.data && (infoJson.data.marketStatus || infoJson.data.market_status) ? (infoJson.data.marketStatus || infoJson.data.market_status) : '';
    const prev = summaryJson && summaryJson.data && summaryJson.data.summaryData && summaryJson.data.summaryData.PreviousClose && summaryJson.data.summaryData.PreviousClose.value ? summaryJson.data.summaryData.PreviousClose.value : '';
    
    const lp = cleanNumberText(primary.lastSalePrice);
    const prevClean = cleanNumberText(prev);
    
    if (lp || prevClean) {
      out.last_price = lp;
      out.price_change_decimal = cleanNumberText(primary.netChange);
      out.price_change_percent = primary.percentageChange || '';
      out.previous_close_price = prevClean;
      out.quote_time = primary.lastTradeTimestamp || '';
      out.market_status = marketStatusTop;

      // Try to extract after-hours / extended session data from common fields
      try {
        if (primary.extended) {
          out.after_hours_price = cleanNumberText(primary.extended.last || primary.extended.lastSale || primary.extended.lastSalePrice || primary.extended.price);
          out.after_hours_change_decimal = cleanNumberText(primary.extended.change || primary.extended.netChange || primary.extended.changeAmount);
          out.after_hours_change_percent = primary.extended.changePercent || primary.extended.percentageChange || '';
        }
        if (primary.preMarket) {
          out.pre_market_price = out.pre_market_price || cleanNumberText(primary.preMarket.last || primary.preMarket.lastSale || primary.preMarket.lastSalePrice || primary.preMarket.price || primary.preMarket.lastTradePrice);
          out.pre_market_price_change_decimal = out.pre_market_price_change_decimal || cleanNumberText(primary.preMarket.change || primary.preMarket.netChange || primary.preMarket.changeAmount || primary.preMarket.preMarketChange);
          out.pre_market_price_change_percent = out.pre_market_price_change_percent || (primary.preMarket.changePercent || primary.preMarket.percentageChange || '');
        }
        // Common alternate field names
        out.after_hours_price = out.after_hours_price || cleanNumberText(primary.postMarketPrice || primary.afterHoursPrice || primary.extendedLast || primary.extendedPrice || primary.postMarketLast);
        out.after_hours_change_decimal = out.after_hours_change_decimal || cleanNumberText(primary.postMarketChange || primary.afterHoursChange || primary.extendedChange || primary.postMarketNetChange);
        out.after_hours_change_percent = out.after_hours_change_percent || (primary.postMarketChangePercent || primary.afterHoursChangePercent || primary.extendedChangePercent || '');
        out.pre_market_price = out.pre_market_price || cleanNumberText(primary.preMarketPrice || primary.preMarketLast || primary.preMarketLastSale || primary.preMarketLastSalePrice || primary.preMarketTradePrice);
        out.pre_market_price_change_decimal = out.pre_market_price_change_decimal || cleanNumberText(primary.preMarketChange || primary.preMarketNetChange || primary.preMarketChangeAmount);
        out.pre_market_price_change_percent = out.pre_market_price_change_percent || (primary.preMarketChangePercent || primary.preMarketPercentageChange || '');
      } catch (e) { /* ignore */ }

      // If marketStatus indicates after-hours or pre-market but explicit extended fields are missing,
      // populate after_hours/pre_market from the primary last price and change.
      try {
        const ms = (marketStatusTop || primary.marketStatus || primary.market_status || '').toString().toLowerCase();
        const isAfterHours = /after[- ]?hours/i.test(ms);
        const isPreMarket = /pre[- ]?market/i.test(ms);
        
        if ((!out.after_hours_price || out.after_hours_price === '') && isAfterHours) {
          logDebug(`nasdaq api: marketStatus indicates after-hours (${marketStatusTop || primary.marketStatus}), setting after_hours from primary`);
          out.after_hours_price = out.after_hours_price || out.last_price;
          out.after_hours_change_decimal = out.after_hours_change_decimal || out.price_change_decimal;
          out.after_hours_change_percent = out.after_hours_change_percent || out.price_change_percent;
        }
        if ((!out.pre_market_price || out.pre_market_price === '') && isPreMarket) {
          logDebug(`nasdaq api: marketStatus indicates pre-market (${marketStatusTop || primary.marketStatus}), populating pre_market fields`);
          const pm = primary.preMarket || primary.pre_market || {};
          out.pre_market_price = out.pre_market_price || cleanNumberText(pm.last || pm.lastSale || pm.lastSalePrice || pm.price) || out.last_price || cleanNumberText(primary.lastSalePrice || primary.lastSale || primary.last || primary.price);
          out.pre_market_price_change_decimal = out.pre_market_price_change_decimal || cleanNumberText(pm.change || pm.netChange || pm.changeAmount) || out.price_change_decimal || cleanNumberText(primary.netChange || primary.change);
          out.pre_market_price_change_percent = out.pre_market_price_change_percent || (pm.changePercent || pm.percentageChange || out.price_change_percent || primary.percentageChange || primary.changePercent || '');
        }
      } catch (e) { /* ignore */ }
      
      return true; // Data found
    }
    return false;
  };

  // Try fetch (modern Node) across candidate asset classes.
  try {
    if (typeof fetch === 'function') {
      for (const ac of candidates) {
        try {
          const [infoRes, summaryRes] = await Promise.all([
            fetch(infoUrlFor(ac), { headers }),
            fetch(summaryUrlFor(ac), { headers })
          ]);
          const infoJson = infoRes.ok ? await infoRes.json() : null;
          const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
          if (processApiData(infoJson, summaryJson)) return out;
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
        const infoRaw = execSync(`curl -s -A 'Mozilla/5.0' '${infoUrlFor(ac)}'`);
        const summaryRaw = execSync(`curl -s -A 'Mozilla/5.0' '${summaryUrlFor(ac)}'`);
        let infoJson = null, summaryJson = null;
        try { infoJson = JSON.parse(infoRaw.toString()); } catch (e) { logDebug('parse infoRaw err: '+e); }
        try { summaryJson = JSON.parse(summaryRaw.toString()); } catch (e) { logDebug('parse summaryRaw err: '+e); }
        if (processApiData(infoJson, summaryJson)) return out;
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
