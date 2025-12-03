// scrape_cnbc.js
// Scrape CNBC quote pages (e.g., https://www.cnbc.com/quotes/QQQM) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  let clean = String(timeStr).trim().replace(/\s+/g, ' ');
  clean = clean.replace(/^\|\s*/, '').replace(/Last\s*\|\s*/i, '');
  if (/^\d{4}-\d{2}-\d{2}T/.test(clean)) return clean;
  clean = clean.replace(/\s+(?:EST|EDT|ET)\s*$/i, '');
  
  const zone = 'America/New_York';
  const formats = ['M/d/yy h:mm a', 'M/d/yy', 'h:mm a'];

  for (const fmt of formats) {
    const dt = DateTime.fromFormat(clean, fmt, { zone });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  
  const dtIso = DateTime.fromISO(clean, { zone });
  if (dtIso.isValid) return dtIso.toUTC().toISO();

  return timeStr;
}

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeCNBC(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.cnbc || security.cnbc_quote || security.cnbcUrl;
    if (!url) {
      logDebug('No CNBC URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open CNBC: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.cnbc`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved CNBC snapshot base ${snapshotBase}`);

    const result = parseCNBCHtml(html || '', { key: ticker });
    data = result;
    
    const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeCNBC';
    const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    await publishToKafka(data, kafkaTopic, kafkaBrokers);

    const jsonFileName = `${dateTimeString}.${ticker}.cnbc.json`;
    const jsonFilePath = path.join(outputDir, jsonFileName);
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
    logDebug(`Saved CNBC JSON to ${jsonFilePath}`);

  } catch (err) { 
    logDebug('Error in scrapeCNBC: ' + err); 
    // Re-throw or handle more explicitly if downstream consumers need to know about the failure
    throw err;
  }
  finally { 
    if (page) { 
      try { await page.close(); } catch (e) { logDebug('Error closing CNBC tab: ' + e); } 
    } 
  }
  return data;
}

function parseCNBCHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

  const data = {
    key: ticker,
    regular_last_price: '',
    regular_change_decimal: '',
    regular_change_percent: '',
    regular_time: '',
    previous_close_price: '',
    after_hours_price: '',
    after_hours_change_decimal: '',
    after_hours_change_percent: '',
    source: 'cnbc',
    capture_time: new Date().toISOString(),
  };

  try {
    // --- Step 1: Attempt to extract data from embedded JSON (`window.__s_data`) ---
    const scriptText = $('script').map((i, el) => $(el).html() || '').get().join('\n');
    const sMatch = scriptText.match(/window\.__s_data\s*=\s*(\{[\s\S]*?\});/);
    if (sMatch) {
      try {
        const sObj = JSON.parse(sMatch[1]);
        const quoteData = sObj?.quote?.data?.[0];
        if (quoteData) {
          data.regular_last_price = cleanNumberText(quoteData.last);
          data.regular_change_decimal = cleanNumberText(quoteData.change);
          data.regular_change_percent = cleanNumberText(quoteData.change_pct);
          data.previous_close_price = cleanNumberText(quoteData.previous_day_closing);
          data.regular_time = parseToIso(quoteData.last_timedate);

          const extQuote = quoteData.ExtendedMktQuote;
          if (extQuote) {
            data.after_hours_price = cleanNumberText(extQuote.last);
            data.after_hours_change_decimal = cleanNumberText(extQuote.change);
            data.after_hours_change_percent = cleanNumberText(extQuote.change_pct);
            if (!data.regular_time) data.regular_time = parseToIso(extQuote.last_timedate);
          }
          logDebug(`Successfully extracted data from embedded JSON for ${ticker}`);
        }
      } catch (e) {
        logDebug(`Could not parse embedded __s_data JSON for ${ticker}: ${e.message}`);
      }
    }

    // --- Step 2: Fallback to HTML scraping for any missing data ---
    if (!data.regular_last_price || !data.regular_change_decimal) {
      logDebug(`Falling back to HTML scrape for ${ticker}`);

      const getValue = (selectors) => {
        for (const selector of selectors) {
          const text = $(selector).first().text();
          if (text) return text;
        }
        return '';
      };
      
      function parseChangeText(s) {
        if (!s) return {};
        const m = String(s).match(/([+-]?[0-9.,]+)\s*(?:\(?\s*([+-]?[0-9.,]+%?)\s*\)?)?/);
        if (!m) return {};
        return { dec: cleanNumberText(m[1]).replace(/^\+/, ''), pct: m[2] ? String(m[2]).replace(/\s/g, '') : '' };
      }

      if (!data.regular_last_price) {
        data.regular_last_price = cleanNumberText(getValue([
          '.QuoteStrip-lastPrice',
          '[data-field="last"]',
          '[data-field="price"]',
          '.QuoteHeader-lastPrice',
          '.Summary-value',
        ]));
      }
      
      if (!data.regular_change_decimal) {
        const changeText = getValue([
          '.QuoteStrip-changeUp', '.QuoteStrip-changeDown', '.QuoteStrip-unchanged',
          '.QuoteHeader-changeUp', '.QuoteHeader-changeDown', '.QuoteHeader-unchanged',
        ]);
        const parsedChange = parseChangeText(changeText);
        data.regular_change_decimal = parsedChange.dec || '';
        data.regular_change_percent = parsedChange.pct || '';
      }
      
      if (!data.previous_close_price) {
        data.previous_close_price = cleanNumberText(getValue([
          '.SplitStats-item:contains("Prev Close") .SplitStats-price',
          '.Summary-prevClose .Summary-value',
          '.Summary-stat:contains("Prev Close") .Summary-value',
        ]));
      }

      if (!data.after_hours_price) {
        const extContainer = $('.QuoteStrip-extendedDataContainer');
        if (extContainer.length) {
          data.after_hours_price = cleanNumberText(extContainer.find('.QuoteStrip-lastPrice').first().text());
          const extChangeText = extContainer.find('.QuoteStrip-changeUp, .QuoteStrip-changeDown').first().text();
          const parsedExtChange = parseChangeText(extChangeText);
          data.after_hours_change_decimal = parsedExtChange.dec || '';
          data.after_hours_change_percent = parsedExtChange.pct || '';
        }
      }

      if (!data.regular_time) {
        data.regular_time = parseToIso(getValue([
          '.QuoteStrip-extendedLastTradeTime',
          '.QuoteStrip-lastTradeTime',
          '.QuoteStrip-lastTimeAndPriceContainer',
        ]));
      }
    }

  } catch (e) {
    logDebug(`Fatal error in parseCNBCHtml for ${ticker}: ${e}`);
    // Return partially filled data object
  }

  // Final cleanup on numbers
  Object.keys(data).forEach(key => {
    if (key.includes('_price') || key.includes('_decimal') || key.includes('_percent')) {
      data[key] = cleanNumberText(data[key]);
    }
  });

  return data;
}

module.exports = { scrapeCNBC, parseCNBCHtml };
