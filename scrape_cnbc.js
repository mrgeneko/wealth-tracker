// scrape_cnbc.js
// Scrape CNBC quote pages (e.g., https://www.cnbc.com/quotes/QQQM) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeCNBC(browser, security, outputDir) {
  let page = null;
  let data = {};
  try {
    const url = security.cnbc || security.cnbc_quote || security.cnbcUrl;
    if (!url) {
      logDebug('No CNBC URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open CNBC: ${url}`);
    const snapshotBase = path.join(outputDir, `${ticker}.cnbc.${getDateTimeString()}`);
    const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
    page = await createPreparedPage(browser, pageOpts);
    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved CNBC snapshot base ${snapshotBase}`);

    try {
      const htmlOutPath = `/usr/src/app/logs/cnbc.${ticker}.${getDateTimeString()}.html`;
      fs.writeFileSync(htmlOutPath, html || await page.content(), 'utf-8');
      logDebug(`Wrote full CNBC HTML to ${htmlOutPath}`);
    } catch (e) { logDebug('Failed to write CNBC full page HTML: ' + e); }

    const result = parseCNBCHtml(html || '', { key: ticker });
    data = result;
    // publish & save
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeCNBC';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
    } catch (kafkaErr) { logDebug('Kafka publish error (CNBC): ' + kafkaErr); }

    try {
      const jsonFileName = `${ticker}.cnbc.${getDateTimeString()}.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved CNBC JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving CNBC JSON: ' + e); }

  } catch (err) { logDebug('Error in scrapeCNBC: ' + err); }
  finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing CNBC tab: ' + e); } } }
  return data;
}

function parseCNBCHtml(html, security) {
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
    // Prefer CNBC-specific QuoteStrip selectors first (more reliable)
    function parseChangeText(s) {
      if (!s) return {};
      const m = String(s).match(/([+-]?[0-9.,]+)\s*(?:\(?\s*([+-]?[0-9.,]+%?)\s*\)?)?/);
      if (!m) return {};
      return { dec: cleanNumberText(m[1]).replace(/^\+/, ''), pct: m[2] ? String(m[2]).replace(/\s/g, '') : '' };
    }

    // Quick wins using the visible QuoteStrip area
    const quoteStripLasts = $('.QuoteStrip-lastPrice');
    if (quoteStripLasts && quoteStripLasts.length) {
      // first is usually the live/extended last price (after-hours when present)
      last_price = cleanNumberText(quoteStripLasts.first().text());
    }

    // main change (up/down/unchanged) in QuoteStrip
    const quoteChange = $('.QuoteStrip-changeUp, .QuoteStrip-changeDown, .QuoteStrip-unchanged').first();
    if (quoteChange && quoteChange.length) {
      const parsed = parseChangeText(quoteChange.text());
      price_change_decimal = parsed.dec || '';
      price_change_percent = parsed.pct || '';
    }

    // previous close (mobile/summary sections)
    const prevCloseCandidate = $('.SplitStats-item:contains("Prev Close") .SplitStats-price, .Summary-prevClose .Summary-value, .Summary-stat:contains("Prev Close") .Summary-value').first();
    if (prevCloseCandidate && prevCloseCandidate.length) {
      previous_close_price = cleanNumberText(prevCloseCandidate.text());
    }

    // After-hours / extended price and change
    const extPriceEls = $('.QuoteStrip-extendedDataContainer .QuoteStrip-lastPrice, .QuoteStrip-dataContainer .QuoteStrip-lastPrice');
    if (extPriceEls && extPriceEls.length) {
      after_hours_price = cleanNumberText(extPriceEls.first().text());
      const extChange = $('.QuoteStrip-extendedDataContainer .QuoteStrip-changeUp, .QuoteStrip-extendedDataContainer .QuoteStrip-changeDown').first();
      if (extChange && extChange.length) {
        const p = parseChangeText(extChange.text());
        after_hours_change_decimal = p.dec || '';
        after_hours_change_percent = p.pct || '';
      }
    }

    // If direct selectors populated the primary values, fall through to the broader heuristics below
    // Common CNBC patterns: top quote header contains price and change. Use multiple fallbacks.
    // 1) look for an element with data-field or class names used for quote strip
    const candidates = [];
    // data-field attributes
    $('[data-field]').each((i, el) => { candidates.push($(el)); });
    // well-known classes
    candidates.push($('[class*="QuoteStrip"]'));
    candidates.push($('[class*="QuoteHeader"]'));
    candidates.push($('[class*="QuotePrice"]'));
    candidates.push($('[class*="Quote__price"]'));

    // find main price by searching for a numeric string in large elements near the top
    let mainEl = null;
    // prefer explicit data-field="last" or data-field="price"
    mainEl = $('[data-field="last"]').first();
    if (!mainEl || !mainEl.length) mainEl = $('[data-field="price"]').first();
    if (!mainEl || !mainEl.length) {
      // search candidate elements for a child with price-like text
      for (let c = 0; c < candidates.length && !mainEl; c++) {
        const elem = candidates[c];
        if (!elem || !elem.length) continue;
        const found = elem.find('*').filter((i, el) => /[0-9]+\.[0-9]{1,2}/.test($(el).text())).first();
        if (found && found.length) mainEl = found;
        else {
          // maybe the candidate itself contains the price
          if (/[0-9]+\.[0-9]{1,2}/.test(elem.text())) mainEl = elem;
        }
      }
    }

    if (mainEl && mainEl.length) {
      last_price = cleanNumberText(mainEl.text());
      // look for nearby change text (siblings, parent, next elements)
      const changeRegex = /([+-]?[0-9,.]+)\s*(?:\(|)?\s*([+-]?[0-9,.]+%?)?\s*\)?/;
      let changeText = '';
      // sibling
      const sibling = mainEl.nextAll().filter((i, el) => /[+\-]/.test($(el).text())).first();
      if (sibling && sibling.length) changeText = sibling.text().trim();
      // parent search
      if (!changeText) {
        const parent = mainEl.parent();
        const mainText = mainEl.text().trim();
        const found = parent.find('*').filter((i, el) => { const t = $(el).text().trim(); return t && t !== mainText && /[+\-][0-9]/.test(t); }).first();
        if (found && found.length) changeText = found.text().trim();
      }
      // broader top area
      if (!changeText) {
        const top = $('header, .QuoteStrip, .QuoteHeader, .Quote__header, .quoteHeader, .quote-strip').first();
        const found = top.find('*').filter((i, el) => /[+\-][0-9].*%?/.test($(el).text())).first();
        if (found && found.length) changeText = found.text().trim();
      }

      if (changeText) {
        const m = changeText.match(changeRegex);
        if (m) {
          price_change_decimal = cleanNumberText(m[1]).replace(/^\+/, '');
          price_change_percent = m[2] ? String(m[2]).replace(/\s/g, '') : '';
        }
      }
    }

    // previous close: search for label text
    const prevLabel = $('*:contains("Previous Close")').filter((i, el) => $(el).text().trim().includes('Previous Close')).first();
    if (prevLabel && prevLabel.length) {
      // try sibling or next element
      const next = prevLabel.next();
      if (next && next.length && /[0-9]/.test(next.text())) previous_close_price = cleanNumberText(next.text());
      else {
        const parent = prevLabel.parent();
        const cand = parent.find('*').filter((i, el) => /[0-9]+\.?[0-9]*/.test($(el).text())).first();
        if (cand && cand.length) previous_close_price = cleanNumberText(cand.text());
      }
    }

    // After/pre market or extended hours text on CNBC sometimes labelled 'Extended Hours' or 'After Hours'
    const extLabel = $('*:contains("After Hours")').filter((i, el) => $(el).text().trim().includes('After Hours')).first() || $('*:contains("Extended Hours")').filter((i, el) => $(el).text().trim().includes('Extended Hours')).first();
    if (extLabel && extLabel.length) {
      const container = extLabel.parent();
      const priceEl = container.find('*').filter((i, el) => /[0-9]+\.[0-9]{1,2}/.test($(el).text())).first();
      if (priceEl && priceEl.length) {
        after_hours_price = cleanNumberText(priceEl.text());
        // try to get change nearby
        const changeEl = container.find('*').filter((i, el) => /[+\-][0-9].*%?/.test($(el).text())).first();
        if (changeEl && changeEl.length) {
          const cm = changeEl.text().match(/([+-]?[0-9,.]+)\s*\(?([+-]?[0-9,.]+%?)?\)?/);
          if (cm) {
            after_hours_change_decimal = cleanNumberText(cm[1]).replace(/^\+/, '');
            after_hours_change_percent = cm[2] ? String(cm[2]).replace(/\s/g, '') : '';
          }
        }
      }
    }

    // Try to extract quote time if present
    // Prefer explicit QuoteStrip time elements, then fall back to embedded page JSON
    let timeFound = '';
    const timeEl = $('.QuoteStrip-extendedLastTradeTime, .QuoteStrip-lastTradeTime, .QuoteStrip-lastTimeAndPriceContainer').first();
    if (timeEl && timeEl.length) {
      const txt = timeEl.text().replace(/\s+/g, ' ').trim();
      const m = txt.match(/([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)(?:\s*[A-Z]{2,3})?)/i);
      if (m) timeFound = m[1].trim();
      else {
        // sometimes the time is like 'Last | 9:27 AM EST' — extract the time portion
        const m2 = txt.match(/\|\s*([0-9]{1,2}:[0-9]{2}\s*(?:AM|PM)(?:\s*[A-Z]{2,3})?)/i);
        if (m2) timeFound = m2[1].trim();
      }
    }
    if (!timeFound) {
      // try embedded JSON in script tags (window.__s_data contains quote data)
      try {
        const scriptText = $('script').map((i, el) => $(el).html() || '').get().join('\n');
        const sMatch = scriptText.match(/window\.__s_data\s*=\s*(\{[\s\S]*?\});/);
        if (sMatch) {
          try {
            const sObj = JSON.parse(sMatch[1]);
            if (sObj && sObj.quote && sObj.quote.data && sObj.quote.data[0]) {
              const q = sObj.quote.data[0];
              if (q && q.ExtendedMktQuote && q.ExtendedMktQuote.last_timedate) timeFound = q.ExtendedMktQuote.last_timedate;
              else if (q && q.last_timedate) timeFound = q.last_timedate;
            }
          } catch (e) {
            // ignore JSON parse errors
          }
        }
      } catch (e) {
        // ignore
      }
    }
    if (timeFound) quote_time = String(timeFound).trim();

  } catch (e) {
    logDebug('parseCNBCHtml error: ' + e);
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
    source: 'cnbc',
    capture_time: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
    quote_time: quote_time || ''
  };
}

module.exports = { scrapeCNBC, parseCNBCHtml };
