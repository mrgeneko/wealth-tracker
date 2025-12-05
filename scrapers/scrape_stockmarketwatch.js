// scrape_stockmarketwatch.js
// Scrape StockMarketWatch quote pages (e.g., https://stockmarketwatch.com/stock/VOO) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[\,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeStockMarketWatch(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.stockmarketwatch || security.stockmarketwatchUrl;
    if (!url) {
      logDebug('No StockMarketWatch URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open StockMarketWatch: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.stockmarketwatch`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'networkidle2', timeout: 30000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Waiting for price text to render...');
    // Wait for actual price text to appear in the DOM (not just skeleton loaders)
    try {
      await page.waitForFunction(
        () => {
          // Look for price text that matches a dollar amount pattern
          const priceEl = document.querySelector('.stock-price, .current-price, [class*="price"]');
          if (priceEl) {
            const text = priceEl.textContent || '';
            // Check if it contains a number (not just "Loading...")
            return /\d+\.\d+/.test(text);
          }
          // Also check for the header section becoming populated
          const header = document.getElementById('headerSection');
          if (header && !header.classList.contains('header-loading-state')) {
            const headerText = header.textContent || '';
            return /\$?\d+\.\d+/.test(headerText);
          }
          return false;
        },
        { timeout: 20000 }
      );
      logDebug('Price text detected in DOM');
    } catch (e) {
      logDebug('Timeout waiting for price text to render: ' + e.message);
    }
    // Additional small delay to ensure all data is rendered
    await new Promise(r => setTimeout(r, 2000));
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved StockMarketWatch snapshot base ${snapshotBase}`);

    const result = parseStockMarketWatchHtml(html || '', { key: ticker });
    data = result;
    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeStockMarketWatch';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (StockMarketWatch): ' + kafkaErr); }

    try {
      const jsonFileName = `${dateTimeString}.${ticker}.stockmarketwatch.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved StockMarketWatch JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving StockMarketWatch JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeStockMarketWatch: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing StockMarketWatch tab: ' + e); } } }
  return data;
}

function parseStockMarketWatchHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

  let regular_last_price = '';
  let regular_change_decimal = '';
  let regular_change_percent = '';
  let previous_close_price = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let after_hours_time = '';
  let pre_market_price = '';
  let pre_market_change_decimal = '';
  let pre_market_change_percent = '';
  let pre_market_time = '';
  let regular_time = '';

  try {
    // Use specific selectors based on the actual StockMarketWatch HTML structure
    
    // Main price: ".stock-current-price" contains "491.86 USD"
    const mainPriceEl = $('.stock-current-price').first();
    if (!mainPriceEl.length) {
      logDebug(`StockMarketWatch: Expected element .stock-current-price not found for ${ticker}. Page may use chart-only template.`);
    }
    const mainPriceText = mainPriceEl.text().trim();
    if (mainPriceText) {
      const priceMatch = mainPriceText.match(/([\d,]+\.?\d*)/);
      if (priceMatch) {
        regular_last_price = cleanNumberText(priceMatch[1]);
      }
    }
    
    // Change: ".stock-price-change" contains "+0.05 (+0.01%)"
    const changeText = $('.stock-price-change').first().text().trim();
    if (changeText) {
      // Parse "+0.05 (+0.01%)" or "-1.23 (-0.45%)"
      const changeMatch = changeText.match(/([+-]?\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)/);
      if (changeMatch) {
        regular_change_decimal = changeMatch[1];
        regular_change_percent = changeMatch[2];
      }
    }
    
    // Regular market time: ".main-price-label" contains "AT CLOSE (AS OF 04:00 PM EST)"
    const mainTimeLabelText = $('.main-price-label').first().text().trim();
    if (mainTimeLabelText) {
      const timeMatch = mainTimeLabelText.match(/AS OF\s+(\d{1,2}:\d{2}\s*[AP]M\s*[A-Z]{2,4})/i);
      if (timeMatch) {
        regular_time = parseTimeToIso(timeMatch[1]);
      }
    }
    
    // Previous close: Look in metrics-grid for "Prev. Close" label
    $('.metric-item').each((i, el) => {
      const label = $(el).find('.metric-label').text().trim();
      const value = $(el).find('.metric-value').text().trim();
      if (/Prev\.?\s*Close/i.test(label)) {
        previous_close_price = cleanNumberText(value);
      }
    });
    
    // Extended hours section: ".extended-hours-section" contains after-hours or pre-market data
    const extendedSection = $('.extended-hours-section').first();
    if (extendedSection.length) {
      const extLabel = extendedSection.find('.extended-hours-label').text().trim();
      const extPrice = extendedSection.find('.extended-hours-price').text().trim();
      const extChange = extendedSection.find('.extended-hours-change').text().trim();
      
      // Parse the change "+0.73 (+0.15%)"
      let extChangeDecimal = '';
      let extChangePercent = '';
      if (extChange) {
        const extChangeMatch = extChange.match(/([+-]?\d+\.?\d*)\s*\(([+-]?\d+\.?\d*)%\)/);
        if (extChangeMatch) {
          extChangeDecimal = extChangeMatch[1];
          extChangePercent = extChangeMatch[2];
        }
      }
      
      // Parse time from label "POST MARKET (AS OF 06:33 PM EST)" or "PRE MARKET (AS OF 08:15 AM EST)"
      let extTime = '';
      if (extLabel) {
        const extTimeMatch = extLabel.match(/AS OF\s+(\d{1,2}:\d{2}\s*[AP]M\s*[A-Z]{2,4})/i);
        if (extTimeMatch) {
          extTime = parseTimeToIso(extTimeMatch[1]);
        }
      }
      
      // Determine if post-market (after-hours) or pre-market
      if (/POST\s*MARKET|AFTER\s*HOURS?/i.test(extLabel)) {
        after_hours_price = cleanNumberText(extPrice);
        after_hours_change_decimal = extChangeDecimal;
        after_hours_change_percent = extChangePercent;
        after_hours_time = extTime;
      } else if (/PRE\s*MARKET/i.test(extLabel)) {
        pre_market_price = cleanNumberText(extPrice);
        pre_market_change_decimal = extChangeDecimal;
        pre_market_change_percent = extChangePercent;
        pre_market_time = extTime;
      }
    }
    
  } catch (e) {
    console.error('Error parsing StockMarketWatch HTML:', e);
  }

  return {
    key: ticker,
    regular_last_price: regular_last_price || '',
    regular_change_decimal: regular_change_decimal || '',
    regular_change_percent: regular_change_percent || '',
    previous_close_price: previous_close_price || '',
    after_hours_price: after_hours_price || '',
    after_hours_change_decimal: after_hours_change_decimal || '',
    after_hours_change_percent: after_hours_change_percent || '',
    after_hours_time: after_hours_time || '',
    pre_market_price: pre_market_price || '',
    pre_market_change_decimal: pre_market_change_decimal || '',
    pre_market_change_percent: pre_market_change_percent || '',
    pre_market_time: pre_market_time || '',
    source: 'stockmarketwatch',
    capture_time: new Date().toISOString(),
    regular_time: regular_time || ''
  };
}

// Parse time strings like "04:00 PM EST" or "06:33 PM EST" to ISO format
function parseTimeToIso(timeStr) {
  if (!timeStr) return '';
  try {
    // Extract time components: "04:00 PM EST"
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s*([A-Z]{2,4})/i);
    if (!match) return '';
    
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3].toUpperCase();
    const tz = match[4].toUpperCase();
    
    // Convert to 24-hour format
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    
    // Map timezone abbreviation to IANA timezone
    const tzMap = {
      'EST': 'America/New_York',
      'EDT': 'America/New_York',
      'ET': 'America/New_York',
      'CST': 'America/Chicago',
      'CDT': 'America/Chicago',
      'CT': 'America/Chicago',
      'MST': 'America/Denver',
      'MDT': 'America/Denver',
      'MT': 'America/Denver',
      'PST': 'America/Los_Angeles',
      'PDT': 'America/Los_Angeles',
      'PT': 'America/Los_Angeles'
    };
    
    const ianaZone = tzMap[tz] || 'America/New_York';
    
    // Create DateTime for today with the parsed time in the given timezone
    const now = DateTime.now().setZone(ianaZone);
    const dt = now.set({ hour: hours, minute: minutes, second: 0, millisecond: 0 });
    
    return dt.toUTC().toISO();
  } catch (e) {
    return '';
  }
}

module.exports = { scrapeStockMarketWatch, parseStockMarketWatchHtml };
