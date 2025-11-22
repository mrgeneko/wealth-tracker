
// scrape_wsj.js
// Scrape WSJ ETF quote pages, e.g. https://www.wsj.com/market-data/quotes/etf/QQQM


const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const {
  sanitizeForFilename,
  getDateTimeString,
  logDebug,
  createPreparedPage,
  savePageSnapshot
} = require('./scraper_utils');

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[\,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

// Refactored to use Puppeteer with stealth plugin for bot evasion
async function scrapeWSJ(browser, security, outputDir) {
  let page = null;
  let data = {};
  try {
    //`https://www.wsj.com/market-data/quotes/etf/${security.key}`;
    const url = security.wsj;
    if (!url) {
      logDebug('No WSJ URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open WSJ: ${url}`);
    const snapshotBase = path.join(outputDir, `${getDateTimeString()}.${ticker}.wsj`);
    const pageOpts = {
      url,
      downloadPath: outputDir,
      waitUntil: 'domcontentloaded', // Wait for DOM content loaded
      timeout: 15000,
      gotoRetries: 2
    };


      page = await createPreparedPage(browser, pageOpts);
      if (!page) {
        logDebug('Failed to create Puppeteer page for WSJ.');
        return {};
      }

      // --- Non-headless mode: force browser to be visible ---
      try {
        if (browser && browser.process && browser.process() && browser.process().spawnargs) {
          const args = browser.process().spawnargs;
          if (!args.includes('--headless') && !args.includes('--headless=new')) {
            logDebug('Browser is running in non-headless mode.');
          } else {
            logDebug('WARNING: Browser is running in headless mode. For best results, launch Puppeteer with headless: false.');
          }
        }
      } catch (e) { logDebug('Could not check Puppeteer headless mode: ' + e); }

      // Wait longer for page to load and JS to run
      await page.waitForTimeout(8000);

      // Try to interact: scroll, click, accept cookies if present
      logDebug('Try to interact');
      try {
        // Scroll to bottom to trigger lazy loading
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);
        // Try to click a common cookie accept button
        const cookieBtn = await page.$('button, [role="button"]');
        if (cookieBtn) {
          const btnText = await page.evaluate(el => el.innerText, cookieBtn);
          if (/accept|agree|consent|ok/i.test(btnText)) {
            await cookieBtn.click();
            logDebug('Clicked cookie/consent button.');
            await page.waitForTimeout(2000);
          }
        }
      } catch (interactErr) {
        logDebug('Interaction attempt failed: ' + interactErr);
      }

      // Wait for main content selector again
      try {
        await page.waitForSelector('[data-field="Last"]', { timeout: 15000 });
      } catch (waitErr) {
        logDebug('Timeout waiting for WSJ main content selector: ' + waitErr);
      }

    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved WSJ snapshot base ${snapshotBase}`);

    try {
      // Save full HTML to logs dir for reference
      const htmlOutPath = path.join(outputDir, `${getDateTimeString()}.${ticker}.wsj.html`);
      fs.writeFileSync(htmlOutPath, html || await page.content(), 'utf-8');
      logDebug(`Wrote full WSJ HTML to ${htmlOutPath}`);
    } catch (e) { logDebug('Failed to write WSJ full page HTML: ' + e); }

    // Parse HTML for data
    const $ = cheerio.load(html || '');
    let last_price = '';
    let price_change_decimal = '';
    let price_change_percent = '';
    let previous_close_price = '';
    let after_hours_price = '';
    let after_hours_change_decimal = '';
    let after_hours_change_percent = '';
    let quote_time = '';

    // Main quote block selectors (may need adjustment if WSJ changes layout)
    last_price = cleanNumberText($('[data-field="Last"] .WSJTheme--last--3M1ny').first().text().trim() ||
      $('[data-field="Last"] [class*="last"]').first().text().trim());
    price_change_decimal = cleanNumberText($('[data-field="Change"] .WSJTheme--change--2oFqg').first().text().trim() ||
      $('[data-field="Change"] [class*="change"]').first().text().trim());
    price_change_percent = cleanNumberText($('[data-field="PercentChange"] .WSJTheme--percentChange--2aLrj').first().text().trim() ||
      $('[data-field="PercentChange"] [class*="percentChange"]').first().text().trim());
    previous_close_price = cleanNumberText($('[data-field="PrevClose"] .WSJTheme--prevClose--1Hk8a').first().text().trim() ||
      $('[data-field="PrevClose"] [class*="prevClose"]').first().text().trim());
    quote_time = $('[data-field="Time"] .WSJTheme--timestamp--1o1tF').first().text().trim() ||
      $('[data-field="Time"] [class*="timestamp"]').first().text().trim();

    // Fallback: try to find values by label if above fails
    if (!last_price) {
      last_price = cleanNumberText($('span:contains("Last")').parent().find('span').last().text().trim());
    }
    if (!previous_close_price) {
      previous_close_price = cleanNumberText($('span:contains("Previous Close")').parent().find('span').last().text().trim());
    }

    // WSJ does not always provide after-hours, but keep fields for consistency
    // (If you find selectors for after-hours, add them here)

    data = {
      key: ticker,
      last_price: last_price || '',
      price_change_decimal: price_change_decimal || '',
      price_change_percent: price_change_percent || '',
      previous_close_price: previous_close_price || '',
      after_hours_price: after_hours_price || '',
      after_hours_change_decimal: after_hours_change_decimal || '',
      after_hours_change_percent: after_hours_change_percent || '',
      source: 'wsj',
      capture_time: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
      quote_time: quote_time || ''
    };

    logDebug('WSJ data: ' + JSON.stringify(data));

    // Publish to Kafka
    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeWSJ';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
      logDebug(`Published WSJ data to Kafka topic ${kafkaTopic}`);
    } catch (kafkaErr) {
      logDebug('Kafka publish error (WSJ): ' + kafkaErr);
    }

    // Save JSON
    try {
      const jsonFileName = `${getDateTimeString()}.${ticker}.wsj.json`;
      const jsonFilePath = path.join(outputDir, jsonFileName);
      fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
      logDebug(`Saved WSJ JSON to ${jsonFilePath}`);
    } catch (e) { logDebug('Error saving WSJ JSON: ' + e); }

  } catch (err) {
    logDebug('Error in scrapeWSJ: ' + err);
  } finally {
    if (page) {
      try { await page.close(); logDebug('Closed WSJ tab.'); } catch (e) { logDebug('Error closing WSJ tab: ' + e); }
    }
  }
  return data;
}

module.exports = { scrapeWSJ };