// scrape_stocktwits.js
// Scrape Stocktwits quote pages (e.g., https://stocktwits.com/symbol/NVDA) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

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
    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeStocktwits';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
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
  let last_price = '';
  let price_change_decimal = '';
  let price_change_percent = '';
  let previous_close_price = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let quote_time = '';

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
    
    const symbolPattern = new RegExp(`"symbol"\\s*:\\s*"${ticker}"`, 'i');
    const symbolMatch = html.match(symbolPattern);
    
    if (symbolMatch) {
      // Found the symbol. Now look for "priceData" after it.
      const afterSymbol = html.substring(symbolMatch.index);
      const priceDataMatch = afterSymbol.match(/"priceData"\s*:\s*(\{.*?\})/);
      
      if (priceDataMatch) {
        // We have a candidate JSON string. It might be cut off if we just match non-greedy until },
        // because the object might contain nested braces.
        // But priceData usually contains simple key-values.
        // Let's try to parse it.
        try {
            // Heuristic: match until the matching closing brace.
            // Since regex can't do recursive balancing, we'll take a chunk and try to parse.
            // Or we can just regex extract the fields we need from the string.
            const pdStr = priceDataMatch[1];
            
            // Extract fields using regex from the JSON string to avoid parsing issues
            const extractVal = (key) => {
                const m = pdStr.match(new RegExp(`"${key}"\\s*:\\s*(".*?"|[0-9.-]+|null|true|false)`, 'i'));
                if (m) {
                    let val = m[1];
                    if (val.startsWith('"')) val = val.slice(1, -1);
                    return val === 'null' ? '' : val;
                }
                return '';
            };

            last_price = cleanNumberText(extractVal('Last'));
            price_change_decimal = cleanNumberText(extractVal('Change'));
            price_change_percent = cleanNumberText(extractVal('PercentChange'));
            previous_close_price = cleanNumberText(extractVal('PreviousClose'));
            
            // Extended hours
            const extPrice = extractVal('ExtendedHoursPrice');
            if (extPrice) {
                after_hours_price = cleanNumberText(extPrice);
                after_hours_change_decimal = cleanNumberText(extractVal('ExtendedHoursChange'));
                after_hours_change_percent = cleanNumberText(extractVal('ExtendedHoursPercentChange'));
            }
            
            // Time
            const dt = extractVal('DateTime'); // "2025-11-26 09:42:08"
            if (dt) quote_time = dt;
            
        } catch (e) {
            logDebug('Error parsing Stocktwits JSON snippet: ' + e);
        }
      }
    }

    // 2. Fallback to DOM parsing if JSON failed or was incomplete
    if (!last_price) {
        const $ = cheerio.load(html);
        
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

        if (priceEl.length) {
            last_price = cleanNumberText(priceEl.first().text());
        }
        
        // Change
        // Example: <span class="SymbolHeader_change__...">+3.13 (+1.76%)</span>
        const changeEl = $('[class*="SymbolHeader_change"]');
        if (changeEl.length) {
            const txt = changeEl.first().text();
            const m = txt.match(/([+-]?[0-9.,]+)\s*(?:\(?\s*([+-]?[0-9.,]+%?)\s*\)?)?/);
            if (m) {
                price_change_decimal = cleanNumberText(m[1]).replace(/^\+/, '');
                price_change_percent = m[2] ? String(m[2]).replace(/\s/g, '') : '';
            }
        }
    }

  } catch (e) {
    logDebug('parseStocktwitsHtml error: ' + e);
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
    source: 'stocktwits',
    capture_time: new Date().toISOString(),
    quote_time: parseToIso(quote_time) || ''
  };
}

module.exports = { scrapeStocktwits, parseStocktwitsHtml };
