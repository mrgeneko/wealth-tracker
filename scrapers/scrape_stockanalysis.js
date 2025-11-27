// scrape_stockanalysis.js
// Scrape StockAnalysis pages (e.g., ETF or stock pages) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

function parseToIso(timeStr) {
  if (!timeStr) return '';
  try {
    // Expected format: "Nov 21, 2025, 7:59 PM EST"
    // We strip the timezone abbreviation and force America/New_York to avoid ambiguity
    const cleaned = timeStr.replace(/\s+[A-Z]{3}$/, '').trim();
    const dt = DateTime.fromFormat(cleaned, "MMM d, yyyy, h:mm a", { zone: 'America/New_York', locale: 'en-US' });
    if (dt.isValid) return dt.toISO(); // Returns ISO 8601 with offset (e.g. -05:00)
    return timeStr; // Return original if parsing fails
  } catch (e) {
    return timeStr;
  }
}

async function scrapeStockAnalysis(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.stockanalysis || security.stockanalysis || security.stockAnalysis;
    if (!url) {
      logDebug('No StockAnalysis URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open StockAnalysis: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.stockanalysis`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved StockAnalysis snapshot base ${snapshotBase}`);

    // Parse the HTML to extract data
    data = parseStockAnalysisHtml(html || await page.content(), { key: ticker });

    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeStockAnalysis';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (StockAnalysis): ' + kafkaErr); }

    try {
      const jsonFileName = `${dateTimeString}.${ticker}.stockanalysis.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved StockAnalysis JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving StockAnalysis JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeStockAnalysis: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing StockAnalysis tab: ' + e); } } }
  return data;
}

function parseStockAnalysisHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';
  
  let last_price = '';
  let last_price_quote_time = '';
  let previous_close_price = '';
  let pre_market_price = '';
  let pre_market_price_change_decimal = '';
  let pre_market_price_change_percent = '';
  let pre_market_price_quote_time = '';
  let price_change_decimal = '';
  let price_change_percent = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';
  let after_hours_price_quote_time = '';

  try {
    const mainPriceEl = $('[class*="text-4xl"]').first();
    if (mainPriceEl && mainPriceEl.length) {
      last_price = cleanNumberText(mainPriceEl.text());
      // Extract last_price_quote_time
      // Look for sibling div with "At close:"
      const timeContainer = mainPriceEl.parent().find('div').filter((i, el) => $(el).text().includes('At close:')).first();
      if (timeContainer && timeContainer.length) {
        const text = timeContainer.text().replace('At close:', '').trim();
        if (text) last_price_quote_time = parseToIso(text);
      }
    }

    // Main change extraction
    try {
      const changeRegex = /([+-]?[0-9,.]+)\s*\(?([+-]?[0-9,.]+%?)?\)?/;
      let changeText = '';
      
      // Strategy 1: Look for red/green text in same container
      const changeEl = mainPriceEl && mainPriceEl.length ? mainPriceEl.closest('div').find('[class*="text-red-vivid"], [class*="text-green-vivid"]').first() : null;
      if (changeEl && changeEl.length) changeText = changeEl.text().trim();

      // Strategy 2: Look for siblings matching regex
      if (!changeText && mainPriceEl && mainPriceEl.length) {
        const parent = mainPriceEl.parent();
        const mainText = mainPriceEl.text().trim();
        const found = parent.find('*').filter((i, el) => {
          const t = $(el).text().trim();
          return el !== mainPriceEl[0] && t && t !== mainText && changeRegex.test(t);
        }).first();
        if (found && found.length) changeText = found.text().trim();
      }

      // Strategy 3: Look for next siblings
      if (!changeText && mainPriceEl && mainPriceEl.length) {
        const mainText = mainPriceEl.text().trim();
        const nextFound = mainPriceEl.nextAll().filter((i, el) => {
          const t = $(el).text().trim();
          return t && t !== mainText && changeRegex.test(t);
        }).first();
        if (nextFound && nextFound.length) changeText = nextFound.text().trim();
      }

      // Strategy 4: Look in top row container
      if (!changeText) {
        const topRow = $('div.mb-5').first();
        const mainText = mainPriceEl && mainPriceEl.length ? mainPriceEl.text().trim() : '';
        const anyFound = topRow.find('*').filter((i, el) => {
          const t = $(el).text().trim();
          return t && t !== mainText && changeRegex.test(t);
        }).first();
        if (anyFound && anyFound.length) changeText = anyFound.text().trim();
      }

      if (changeText) {
        const m = changeText.match(changeRegex);
        if (m) {
          price_change_decimal = cleanNumberText(m[1]).replace(/^\+/, '');
          price_change_percent = m[2] ? String(m[2]).replace(/\s/g, '') : '';
        }
      }
    } catch (e) { /* ignore change extraction errors */ }

    // Previous Close
    const prevLabel = $('td').filter((i, el) => $(el).text().trim() === 'Previous Close').first();
    if (prevLabel && prevLabel.length) {
      const val = prevLabel.next('td').text() || prevLabel.parent().find('td').eq(1).text();
      if (val) previous_close_price = cleanNumberText(val);
    }

    // Pre-market
    const preLabel = $('span:contains("Pre-market:")').filter((i, el) => $(el).text().trim().includes('Pre-market')).first();
    if (preLabel && preLabel.length) {
      // Extract time
      // Structure: <div><span>...<span>Pre-market:</span></span> <span class="sm:ml-1">Nov 19, 2025...</span></div>
      // The time might be in a sibling span or just text in the parent
      const timeContainer = preLabel.closest('div');
      if (timeContainer && timeContainer.length) {
        const fullText = timeContainer.text();
        const timeText = fullText.split('Pre-market:')[1];
        if (timeText) pre_market_price_quote_time = parseToIso(timeText.trim());
      }

      // Extract price and change
      let container = preLabel.parents().filter((i, el) => {
        const c = $(el).attr('class') || '';
        return c.includes('border-l');
      }).first();
      
      if (!container || !container.length) container = preLabel.closest('div').parent();

      if (container && container.length) {
        // Price is usually in a div with text-[1.7rem] or similar large text
        let priceEl = container.find('div').filter((i, el) => {
           const c = $(el).attr('class') || '';
           return c.includes('text-[1.7rem]') || c.includes('text-2xl');
        }).first();
        
        if (!priceEl.length) {
             // Fallback: look for any number that isn't the change
             priceEl = container.find('div').filter((i, el) => {
                 const t = $(el).text().trim();
                 return /[0-9]/.test(t) && !t.includes('(') && !t.includes('%');
             }).first();
        }

        if (priceEl && priceEl.length) {
            pre_market_price = cleanNumberText(priceEl.text());
        }

        // Change
        const changeEl = container.find('div').filter((i, el) => {
            const t = $(el).text();
            return t.includes('(') && t.includes('%');
        }).first();

        if (changeEl && changeEl.length) {
            const cs = changeEl.text().trim();
            const cm = cs.match(/([+-]?[0-9,.]+)\s*\(([+-]?[0-9,.]+%?)\)/);
            if (cm) {
                pre_market_price_change_decimal = cleanNumberText(cm[1]).replace(/^\+/, '');
                pre_market_price_change_percent = cm[2] ? String(cm[2]).replace(/\s/g, '') : '';
            }
        }
      }
    }

    // After-hours
    const afterLabel = $('span:contains("After-hours:")').filter((i, el) => $(el).text().trim().includes('After-hours')).first();
    if (afterLabel && afterLabel.length) {
      // Extract time
      const timeContainer = afterLabel.closest('div');
      if (timeContainer && timeContainer.length) {
        const fullText = timeContainer.text();
        const parts = fullText.split('After-hours:');
        if (parts.length > 1) after_hours_price_quote_time = parseToIso(parts[1].trim());
      }

      let container = afterLabel.parents().filter((i, el) => {
        const c = $(el).attr('class') || '';
        return c.includes('border-l');
      }).first();
      
      if (!container || !container.length) container = afterLabel.closest('div');
      
      let candidate = container.find('div').filter((i, el) => /[0-9]/.test($(el).text())).first();
      
      if ((!candidate || !candidate.length)) {
        const topRow = $('div.mb-5').first();
        const bordered = topRow.find('div.border-l').first();
        if (bordered && bordered.length) candidate = bordered.find('div').filter((i, el) => /[0-9]/.test($(el).text())).first();
      }

      if (candidate && candidate.length) {
        after_hours_price = cleanNumberText(candidate.text());
        let changeSmall = null;
        try {
          const bordered = $('div.mb-5').first().find('div.border-l').first();
          const scopes = [container, candidate, candidate && candidate.parent(), bordered].filter(Boolean);
          for (let s of scopes) {
            changeSmall = s.find('div').filter((i, el) => /\([+-]?[0-9,.]+%?\)/.test($(el).text())).first();
            if (changeSmall && changeSmall.length) break;
          }
        } catch (e) { changeSmall = null; }

        if (changeSmall && changeSmall.length) {
          const cs = changeSmall.text().trim();
          const cm = cs.match(/([+-]?[0-9,.]+)\s*\(([+-]?[0-9,.]+%?)\)/);
          if (cm) {
            after_hours_change_decimal = cleanNumberText(cm[1]).replace(/^\+/, '');
            after_hours_change_percent = cm[2] ? String(cm[2]).replace(/\s/g, '') : '';
          } else {
            const dm = cs.match(/([+-]?[0-9,.]+)/);
            if (dm) after_hours_change_decimal = cleanNumberText(dm[1]).replace(/^\+/, '');
          }
        }
      }
    }
  } catch (e) {
    logDebug('parseStockAnalysisHtml error: ' + e);
  }

  return {
    key: ticker,
    last_price: last_price || '',
    last_price_quote_time: last_price_quote_time || '',
    price_change_decimal: price_change_decimal || '',
    price_change_percent: price_change_percent || '',
    previous_close_price: previous_close_price || '',
    pre_market_price: pre_market_price || '',
    pre_market_price_change_decimal: pre_market_price_change_decimal || '',
    pre_market_price_change_percent: pre_market_price_change_percent || '',
    pre_market_price_quote_time: pre_market_price_quote_time || '',
    after_hours_price: after_hours_price || '',
    after_hours_change_decimal: after_hours_change_decimal || '',
    after_hours_change_percent: after_hours_change_percent || '',
    after_hours_price_quote_time: after_hours_price_quote_time || '',
    source: 'stockanalysis',
    capture_time: new Date().toISOString(),
    quote_time: ''
  };
}

module.exports = { scrapeStockAnalysis, parseStockAnalysisHtml };
