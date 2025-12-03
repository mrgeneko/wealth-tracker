
// scrape_wsj.js
// Scrape WSJ ETF quote pages, e.g. https://www.wsj.com/market-data/quotes/etf/QQQM


const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const {
  sanitizeForFilename,
  getDateTimeString,
  logDebug,
  createPreparedPage,
  savePageSnapshot
} = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  // Remove "Last Updated:", "As of", etc.
  let clean = String(timeStr).replace(/Last Updated:?/i, '').replace(/As of/i, '').trim();
  // Normalize p.m. / a.m.
  clean = clean.replace(/p\.?m\.?/i, 'PM').replace(/a\.?m\.?/i, 'AM');
  // Remove timezone abbreviations to rely on explicit zone
  clean = clean.replace(/\s+(?:EST|EDT|ET)\s*$/i, '');
  clean = clean.replace(/\s+/g, ' ').trim();

  const zone = 'America/New_York';
  // WSJ formats: "Nov 22, 2025 4:00 PM", "11/22/25"
  const formats = [
    'MMM d, yyyy h:mm a',
    'MMM d, yyyy HH:mm',
    'MM/dd/yy',
    'MM/dd/yyyy'
  ];
  
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(clean, fmt, { zone });
    if (dt.isValid) return dt.toUTC().toISO();
  }
  // Try ISO
  const dtIso = DateTime.fromISO(clean, { zone });
  if (dtIso.isValid) return dtIso.toUTC().toISO();
  
  return timeStr;
}

function cleanNumberText(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[\,\s]/g, '').replace(/[^0-9.\-]/g, '');
}

async function scrapeWSJ(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.wsj;
    if (!url) {
      logDebug('No WSJ URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open WSJ: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.wsj`);
    const pageOpts = {
      url,
      downloadPath: outputDir,
      waitUntil: 'domcontentloaded',
      timeout: 15000,
      gotoRetries: 2
    };

    page = await createPreparedPage(browser, pageOpts);
    if (!page) {
      logDebug('Failed to create Puppeteer page for WSJ.');
      return {};
    }

    await page.waitForTimeout(8000);

    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
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

    try {
      await page.waitForSelector('[data-field="Last"]', { timeout: 15000 });
    } catch (waitErr) {
      logDebug('Timeout waiting for WSJ main content selector: ' + waitErr);
    }

    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved WSJ snapshot base ${snapshotBase}`);

    const $ = cheerio.load(html || '');
    let regular_last_price = cleanNumberText($('[data-field="Last"] .WSJTheme--last--3M1ny').first().text().trim() || $('[data-field="Last"] [class*="last"]').first().text().trim());
    let regular_change_decimal = cleanNumberText($('[data-field="Change"] .WSJTheme--change--2oFqg').first().text().trim() || $('[data-field="Change"] [class*="change"]').first().text().trim());
    let regular_change_percent = cleanNumberText($('[data-field="PercentChange"] .WSJTheme--percentChange--2aLrj').first().text().trim() || $('[data-field="PercentChange"] [class*="percentChange"]').first().text().trim());
    let previous_close_price = cleanNumberText($('[data-field="PrevClose"] .WSJTheme--prevClose--1Hk8a').first().text().trim() || $('[data-field="PrevClose"] [class*="prevClose"]').first().text().trim());
    let regular_time = parseToIso($('[data-field="Time"] .WSJTheme--timestamp--1o1tF').first().text().trim() || $('[data-field="Time"] [class*="timestamp"]').first().text().trim());

    if (!regular_last_price) {
      regular_last_price = cleanNumberText($('span:contains("Last")').parent().find('span').last().text().trim());
    }
    if (!previous_close_price) {
      previous_close_price = cleanNumberText($('span:contains("Previous Close")').parent().find('span').last().text().trim());
    }

    data = {
      key: ticker,
      regular_last_price: regular_last_price || '',
      regular_change_decimal: regular_change_decimal || '',
      regular_change_percent: regular_change_percent || '',
      previous_close_price: previous_close_price || '',
      after_hours_price: '',
      after_hours_change_decimal: '',
      after_hours_change_percent: '',
      source: 'wsj',
      capture_time: new Date().toISOString(),
      regular_time: regular_time || ''
    };

    logDebug('WSJ data: ' + JSON.stringify(data));

    try {
      const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeWSJ';
      const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
      await publishToKafka(data, kafkaTopic, kafkaBrokers);
      logDebug(`Published WSJ data to Kafka topic ${kafkaTopic}`);
    } catch (kafkaErr) {
      logDebug('Kafka publish error (WSJ): ' + kafkaErr);
    }

    try {
      const jsonFileName = `${dateTimeString}.${ticker}.wsj.json`;
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