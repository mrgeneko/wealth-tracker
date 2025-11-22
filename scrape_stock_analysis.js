// scrape_stock_analysis.js
// Scrape StockAnalysis pages (e.g., ETF or stock pages) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeStockAnalysis(browser, security, outputDir) {
  let page = null;
  let data = {};
  try {
    const url = security.stock_analysis || security.stockanalysis || security.stockAnalysis;
    if (!url) {
      logDebug('No StockAnalysis URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open StockAnalysis: ${url}`);
    const snapshotBase = path.join(outputDir, `${ticker}.stockanalysis.${getDateTimeString()}`);
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
      const jsonFileName = `${ticker}.stockanalysis.${getDateTimeString()}.json`;
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
  let previous_close_price = '';
  let price_change_decimal = '';
  let price_change_percent = '';
  let after_hours_price = '';
  let after_hours_change_decimal = '';
  let after_hours_change_percent = '';

  try {
    const mainPriceEl = $('[class*="text-4xl"]').first();
    if (mainPriceEl && mainPriceEl.length) last_price = cleanNumberText(mainPriceEl.text());

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

    // After-hours
    const afterLabel = $('*:contains("After-hours:")').filter((i, el) => $(el).text().trim().includes('After-hours')).first();
    if (afterLabel && afterLabel.length) {
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
    last_price_quote_time: '',
    price_change_decimal: price_change_decimal || '',
    price_change_percent: price_change_percent || '',
    previous_close_price: previous_close_price || '',
    after_hours_price: after_hours_price || '',
    after_hours_price_quote_time: '',
    after_hours_change_decimal: after_hours_change_decimal || '',
    after_hours_change_percent: after_hours_change_percent || '',
    source: 'stock_analysis',
    capture_time: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
    quote_time: ''
  };
}

module.exports = { scrapeStockAnalysis, parseStockAnalysisHtml };
