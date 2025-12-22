// scrape_robinhood.js
// Scrape Robinhood quote pages (e.g., https://robinhood.com/stocks/NVDA) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, normalizedKey } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  // If already ISO-like, return as is
  if (/^\d{4}-\d{2}-\d{2}T/.test(timeStr)) return timeStr;
  
  // Try to parse standard formats if needed, but Robinhood JSON usually provides ISO or clear timestamps
  const dt = DateTime.fromISO(timeStr);
  if (dt.isValid) return dt.toUTC().toISO();
  
  return timeStr;
}

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeRobinhood(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.robinhood || security.robinhoodUrl;
    if (!url) {
      logDebug('No Robinhood URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open Robinhood: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.robinhood`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved Robinhood snapshot base ${snapshotBase}`);

    const result = parseRobinhoodHtml(html || '', { key: ticker });
    data = result;
    data.normalized_key = data.normalized_key || normalizedKey(security.key);

    // Preserve routing metadata for DB composite key matching
    data.security_type = data.security_type || security.security_type || security.type || 'NOT_SET';
    data.pricing_class = data.pricing_class || security.pricing_class || 'US_EQUITY';
    if (security.position_source && !data.position_source) data.position_source = security.position_source;

    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeRobinhood';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (Robinhood): ' + kafkaErr); }

    try {
      const jsonFileName = `${dateTimeString}.${ticker}.robinhood.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved Robinhood JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving Robinhood JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeRobinhood: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing Robinhood tab: ' + e); } } }
  return data;
}

function parseRobinhoodHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

  let regular_price = '';
  let regular_change_decimal = '';
  let regular_change_percent = '';
  let previous_close_price = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let regular_time = '';

  try {
    // Try to parse the __NEXT_DATA__ script tag which contains the full state
    const nextDataScript = $('script#__NEXT_DATA__');
    if (nextDataScript.length) {
      try {
        const jsonText = nextDataScript.html();
        const jsonData = JSON.parse(jsonText);
        
        // Navigate to the quote data
        // Structure observed: props.pageProps.quote
        if (jsonData && jsonData.props && jsonData.props.pageProps && jsonData.props.pageProps.quote) {
          const quote = jsonData.props.pageProps.quote;
          
          if (quote.last_trade_price) {
            regular_price = cleanNumberText(quote.last_trade_price);
          }
          
          if (quote.previous_close) {
            previous_close_price = cleanNumberText(quote.previous_close);
          }
          
          if (quote.last_extended_hours_trade_price) {
            after_hours_price = cleanNumberText(quote.last_extended_hours_trade_price);
          }
          
          // Calculate changes if not explicitly provided
          if (regular_price && previous_close_price) {
            const current = parseFloat(regular_price);
            const prev = parseFloat(previous_close_price);
            const diff = current - prev;
            regular_change_decimal = diff.toFixed(2);
            regular_change_percent = ((diff / prev) * 100).toFixed(2) + '%';
          }
          
          // Calculate after hours changes
          // Usually after hours change is relative to the close price (last_trade_price)
          if (after_hours_price && regular_price) {
            const ah = parseFloat(after_hours_price);
            const close = parseFloat(regular_price);
            const diff = ah - close;
            after_hours_change_decimal = diff.toFixed(2);
            after_hours_change_percent = ((diff / close) * 100).toFixed(2) + '%';
          }
          
          // Timestamp
          if (quote.updated_at) {
            regular_time = parseToIso(quote.updated_at);
          } else if (quote.venue_last_trade_time) {
            regular_time = parseToIso(quote.venue_last_trade_time);
          }
        }
      } catch (e) {
        logDebug('Error parsing __NEXT_DATA__ JSON: ' + e);
      }
    }
    
    // Fallback to CSS selectors if JSON parsing failed or returned no data
    if (!last_price) {
      // Main price
      // <div class="css-1akpx1n"><span class="css-udypg9"><span class="css-v72tci">$179.81</span></span></div>
      // This selector is very brittle (generated class names), but we can try looking for the structure
      // Look for "Invest In" section or similar context if possible, but classes are obfuscated.
      // We might rely on the fact that the main price is often the largest text or near the top.
      
      // Try finding the price by looking for the dollar sign in specific containers
      // This is hard with obfuscated classes. The JSON method is much preferred.
    }

  } catch (e) {
    logDebug('parseRobinhoodHtml error: ' + e);
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
    after_hours_time: '',
    source: 'robinhood',
    capture_time: new Date().toISOString(),
    regular_time: regular_time || ''
  };
}

module.exports = { scrapeRobinhood, parseRobinhoodHtml };
