// scrape_stocktwits.js
// Scrape Stocktwits quote pages (e.g., https://stocktwits.com/symbol/NVDA) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, normalizedKey } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  // Stocktwits often provides ISO strings directly or "YYYY-MM-DD HH:mm:ss"
  // If it's already ISO, Luxon handles it.
  const zone = 'America/New_York';
  const dt = DateTime.fromISO(timeStr, { zone });
  if (dt.isValid) return dt.toUTC().toISO();
  
  // Try SQL-like format
  const dtSql = DateTime.fromFormat(timeStr, 'yyyy-MM-dd HH:mm:ss', { zone });
  if (dtSql.isValid) return dtSql.toUTC().toISO();

  return timeStr;
}

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeStocktwits(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.stocktwits || security.stocktwitsUrl;
    if (!url) {
      logDebug('No Stocktwits URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open Stocktwits: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.stocktwits`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved Stocktwits snapshot base ${snapshotBase}`);

    const result = parseStocktwitsHtml(html || '', { key: ticker });
    data = result;
    data.normalized_key = data.normalized_key || normalizedKey(security.key);
    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeStocktwits';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (Stocktwits): ' + kafkaErr); }

    try {
      const jsonFileName = `${dateTimeString}.${ticker}.stocktwits.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved Stocktwits JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving Stocktwits JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeStocktwits: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing Stocktwits tab: ' + e); } } }
  return data;
}

function parseStocktwitsHtml(html, security) {
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';
  let regular_price = '';
  let regular_change_decimal = '';
  let regular_change_percent = '';
  let previous_close_price = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let regular_time = '';
  let after_hours_time = '';
  let pre_market_price = '';
  let pre_market_change_decimal = '';
  let pre_market_change_percent = '';
  let pre_market_time = '';
  let extendedHoursType = ''; // 'pre-market' or 'after-hours'

  try {
    // 1. Try to find the embedded JSON data first (most reliable)
    // The JSON structure observed is like: {"id":..., "symbol":"NVDA", ..., "priceData":{...}}
    // It might be inside a list or a standalone object.
    // We look for a pattern that matches the symbol and contains priceData.
    
    // Regex to find the object for this specific ticker.
    // We look for "symbol":"TICKER" ... "priceData":{ ... }
    // Note: The JSON might be minified, so we use flexible whitespace.
    // We capture the priceData object content.
    
    // Strategy: Find the "symbol":"TICKER" part, then look ahead for "priceData":{...}
    // But the order might vary.
    // Better: Find the whole object that contains both.
    
    // Let's try to extract all JSON-like objects that have "priceData" and check the symbol.
    // Since regex parsing of nested JSON is hard, we'll try to find the specific "priceData" block
    // that follows the symbol, or precedes it within a reasonable distance.
    
    // However, the example showed: {"id":..., "symbol":"NVDA", ..., "priceData":{...}}
    // So "symbol" comes before "priceData".
    
    // Handle ticker variations: BRK-B vs BRK.B - try both formats
    const tickerVariations = [
      ticker,
      ticker.replace(/-/g, '.'),  // BRK-B -> BRK.B
      ticker.replace(/\./g, '-'), // BRK.B -> BRK-B
    ];
    
    // Strategy: Find priceData blocks and match by Symbol/Identifier field
    // The priceData contains a "Symbol" or "Identifier" field that identifies which ticker it belongs to
    const priceDataPattern = /"priceData"\s*:\s*\{[^}]+\}/g;
    let priceDataMatch;
    let foundPriceData = null;
    
    while ((priceDataMatch = priceDataPattern.exec(html)) !== null) {
      const pdBlock = priceDataMatch[0];
      // Check if this priceData is for our ticker
      for (const tickerVar of tickerVariations) {
        const escapedTicker = tickerVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match Symbol or Identifier field
        const symbolMatch = pdBlock.match(new RegExp(`"(?:Symbol|Identifier)"\\s*:\\s*"${escapedTicker}"`, 'i'));
        if (symbolMatch) {
          foundPriceData = pdBlock;
          break;
        }
      }
      if (foundPriceData) break;
    }
    
    if (foundPriceData) {
      try {
        // Extract the JSON object from the priceData match
        const pdStr = foundPriceData.replace(/^"priceData"\s*:\s*/, '');
        
        // Extract fields using regex from the JSON string
        const extractVal = (key) => {
          const m = pdStr.match(new RegExp(`"${key}"\\s*:\\s*(".*?"|[0-9.-]+|null|true|false)`, 'i'));
          if (m) {
            let val = m[1];
            if (val.startsWith('"')) val = val.slice(1, -1);
            return val === 'null' ? '' : val;
          }
          return '';
        };

        regular_price = cleanNumberText(extractVal('Last'));
        regular_change_decimal = cleanNumberText(extractVal('Change'));
        regular_change_percent = cleanNumberText(extractVal('PercentChange'));
        previous_close_price = cleanNumberText(extractVal('PreviousClose'));
        
        // Extended hours
        const extPrice = extractVal('ExtendedHoursPrice');
        if (extPrice) {
          const extChangeDec = cleanNumberText(extractVal('ExtendedHoursChange'));
          const extChangePct = cleanNumberText(extractVal('ExtendedHoursPercentChange'));
          const extTime = extractVal('ExtendedHoursDateTime');
          const extType = extractVal('ExtendedHoursType'); // 'PostMarket' or 'PreMarket'
          
          const isPreMarket = /pre[-\s]?market/i.test(extType);
          
          if (isPreMarket) {
            pre_market_price = cleanNumberText(extPrice);
            pre_market_change_decimal = extChangeDec;
            pre_market_change_percent = extChangePct;
            if (extTime) pre_market_time = extTime;
            extendedHoursType = 'pre-market';
          } else {
            after_hours_price = cleanNumberText(extPrice);
            after_hours_change_decimal = extChangeDec;
            after_hours_change_percent = extChangePct;
            if (extTime) after_hours_time = extTime;
            extendedHoursType = 'after-hours';
          }
        }
        
        // Time
        const dt = extractVal('DateTime'); // "2025-11-26 09:42:08"
        if (dt) regular_time = dt;
        
      } catch (e) {
        logDebug('Error parsing Stocktwits JSON snippet: ' + e);
      }
    }

    // 2. Fallback to DOM parsing if JSON failed or was incomplete
    if (!regular_price) {
        const $ = cheerio.load(html);
        
        // Check if page shows Pre-Market indicator
        const isPreMarketPage = /Pre[-\s]?Market/i.test(html);
        
        // Price is often in a header with class containing 'SymbolHeader_price'
        // Example: <span class="SymbolHeader_price__3_2_O">135.58</span>
        // Also check for simple h1 + span structure if class names are obfuscated
        let priceEl = $('[class*="SymbolHeader_price"]');
        if (!priceEl.length) {
             // Fallback: Look for the large price text near the H1 symbol
             // The HTML shows: <div><h1>BRK.B ...</h1> ... <span>$514.38</span> ... </div>
             // Often the price is the first large number after the H1
             // Or look for a span with text starting with '$' inside the main header area
             const potentialPrice = $('span').filter((i, el) => /^\$\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test($(el).text().trim())).first();
             if (potentialPrice.length) {
                 priceEl = potentialPrice;
             }
        }

        let extractedPrice = '';
        let extractedChangeDec = '';
        let extractedChangePct = '';
        
        if (priceEl.length) {
          extractedPrice = cleanNumberText(priceEl.first().text());
        }
        
        // Change
        // Example: <span class="SymbolHeader_change__...">+3.13 (+1.76%)</span>
        const changeEl = $('[class*="SymbolHeader_change"]');
        if (changeEl.length) {
          const txt = changeEl.first().text();
          const m = txt.match(/([+-]?[0-9.,]+)\s*(?:\(?\s*([+-]?[0-9.,]+%?)\s*\)?)?/);
          if (m) {
            extractedChangeDec = cleanNumberText(m[1]).replace(/^\+/, '');
            extractedChangePct = m[2] ? String(m[2]).replace(/\s/g, '') : '';
          }
        }
        
        // If Pre-Market is shown, the displayed price IS the pre-market price
        // We need to find the regular/close price separately
        if (isPreMarketPage && extractedPrice) {
          pre_market_price = extractedPrice;
          pre_market_change_decimal = extractedChangeDec;
          pre_market_change_percent = extractedChangePct;
          pre_market_time = new Date().toISOString();
          extendedHoursType = 'pre-market';
        } else {
          regular_price = extractedPrice;
          regular_change_decimal = extractedChangeDec;
          regular_change_percent = extractedChangePct;
        }
    }

  } catch (e) {
    logDebug('parseStocktwitsHtml error: ' + e);
  }

  return {
    key: ticker,
    regular_price: regular_price || '',
    regular_change_decimal: regular_change_decimal || '',
    regular_change_percent: regular_change_percent || '',
    previous_close_price: previous_close_price || '',
    after_hours_price: after_hours_price || '',
    after_hours_change_decimal: after_hours_change_decimal || '',
    after_hours_change_percent: after_hours_change_percent || '',
    after_hours_time: parseToIso(after_hours_time) || '',
    pre_market_price: pre_market_price || '',
    pre_market_change_decimal: pre_market_change_decimal || '',
    pre_market_change_percent: pre_market_change_percent || '',
    pre_market_time: parseToIso(pre_market_time) || '',
    source: 'stocktwits',
    capture_time: new Date().toISOString(),
    regular_time: parseToIso(regular_time) || ''
  };
}

module.exports = { scrapeStocktwits, parseStocktwitsHtml };
