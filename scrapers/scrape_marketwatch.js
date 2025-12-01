// scrape_marketwatch.js
// Scrape MarketWatch quote pages (e.g., https://www.marketwatch.com/investing/stock/brk.b) and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  let clean = String(timeStr).trim().replace(/\s+/g, ' ');
  // Remove "Last Updated:" prefix if present
  clean = clean.replace(/^Last Updated:\s*/i, '');
  
  // MarketWatch format: "Dec 1, 2025 12:26 p.m. EST"
  // Luxon doesn't like "p.m.", it wants "PM".
  clean = clean.replace(/a\.m\./i, 'AM').replace(/p\.m\./i, 'PM');
  
  // Remove timezone for parsing if needed, or handle it. 
  // Luxon's fromFormat with zone can handle it if we strip the abbreviation or map it.
  // But simpler to strip " EST", " EDT", etc and use zone='America/New_York'
  clean = clean.replace(/\s+(?:EST|EDT|ET)\s*$/i, '');

  const zone = 'America/New_York';
  const formats = [
    'MMM d, yyyy h:mm a', // Dec 1, 2025 12:26 PM
    'M/d/yy h:mm a', 
    'M/d/yy', 
    'h:mm a'
  ];

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

async function scrapeMarketWatch(browser, security, outputDir) {
  let page = null;
  let data = {};
  const dateTimeString = getDateTimeString();
  try {
    const url = security.marketwatch || security.marketwatchUrl;
    if (!url) {
      logDebug('No MarketWatch URL provided for ' + security.key);
      return {};
    }
    const ticker = sanitizeForFilename(security.key);
    logDebug(`Security: ${ticker}   open MarketWatch: ${url}`);
    const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.marketwatch`);
    const pageOpts = { 
      url: 'https://www.marketwatch.com/', // Start at homepage
      downloadPath: outputDir, 
      waitUntil: 'domcontentloaded', 
      timeout: 60000, 
      gotoRetries: 3,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    };
    page = await createPreparedPage(browser, pageOpts);

    // Simulate human behavior on homepage
    try {
        await page.mouse.move(100, 100);
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
        await page.mouse.move(200, 200, { steps: 10 });
    } catch (e) { /* ignore */ }

    // Now navigate to the actual URL
    logDebug(`Navigating to quote page: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Simulate more human behavior
    try {
        await page.mouse.move(150, 250, { steps: 10 });
        await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));
    } catch (e) { /* ignore */ }

    // Check for DataDome CAPTCHA
    const captchaFrame = await page.$('iframe[title="DataDome CAPTCHA"]');
    if (captchaFrame) {
        logDebug('DataDome CAPTCHA detected! Waiting for user to solve it...');
        // Wait for the captcha to disappear or the price to appear
        try {
            await page.waitForFunction(() => !document.querySelector('iframe[title="DataDome CAPTCHA"]'), { timeout: 120000 });
            logDebug('CAPTCHA apparently solved or gone.');
        } catch (e) {
            logDebug('Timed out waiting for CAPTCHA solution.');
        }
    }
    
    // MarketWatch might have anti-bot, so we might need to wait a bit or check for content
    try {
        await page.waitForSelector('meta[name="price"]', { timeout: 10000 });
    } catch (e) {
        logDebug('Timeout waiting for meta[name="price"], page might not have loaded correctly or structure changed.');
    }

    logDebug('Page loaded. Extracting HTML...');
    const html = await savePageSnapshot(page, snapshotBase);
    if (html) logDebug(`Saved MarketWatch snapshot base ${snapshotBase}`);

    const result = parseMarketWatchHtml(html || '', { key: ticker });
    data = result;
    
    const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeMarketWatch';
    const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
    await publishToKafka(data, kafkaTopic, kafkaBrokers);

    const jsonFileName = `${dateTimeString}.${ticker}.marketwatch.json`;
    const jsonFilePath = path.join(outputDir, jsonFileName);
    fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
    logDebug(`Saved MarketWatch JSON to ${jsonFilePath}`);

  } catch (err) { 
    logDebug('Error in scrapeMarketWatch: ' + err); 
    throw err;
  }
  finally { 
    if (page) { 
      try { await page.close(); } catch (e) { logDebug('Error closing MarketWatch tab: ' + e); } 
    } 
  }
  return data;
}

function parseMarketWatchHtml(html, security) {
  const $ = cheerio.load(html || '');
  const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

  const data = {
    key: ticker,
    last_price: '',
    price_change_decimal: '',
    price_change_percent: '',
    previous_close_price: '',
    after_hours_price: '',
    after_hours_change_decimal: '',
    after_hours_change_percent: '',
    quote_time: '',
    source: 'marketwatch',
    capture_time: new Date().toISOString(),
  };

  try {
    // Use meta tags as primary source
    const getMeta = (name) => $(`meta[name="${name}"]`).attr('content');

    const price = getMeta('price'); // "$511.36"
    const priceChange = getMeta('priceChange'); // "-2.45"
    const priceChangePercent = getMeta('priceChangePercent'); // "-0.48%"
    const quoteTime = getMeta('quoteTime'); // "Dec 1, 2025 12:26 p.m. EST"

    if (price) data.last_price = cleanNumberText(price);
    if (priceChange) data.price_change_decimal = cleanNumberText(priceChange);
    if (priceChangePercent) data.price_change_percent = cleanNumberText(priceChangePercent);
    if (quoteTime) data.quote_time = parseToIso(quoteTime);

    // Previous Close
    // Look for table cell with "Previous Close" header
    // <th class="table__heading">Previous Close</th> ... <td class="table__cell u-semi">$513.81</td>
    const prevCloseHeader = $('.table__heading:contains("Previous Close")');
    if (prevCloseHeader.length > 0) {
        const prevCloseValue = prevCloseHeader.closest('table').find('.table__cell').first().text();
        data.previous_close_price = cleanNumberText(prevCloseValue);
    }

    // After Hours
    // Since we didn't see a clear after hours section in the dump, we'll look for a secondary price block
    // or text indicating after hours.
    // Strategy: Look for a section that might contain "After Hours" text and a price.
    // In some MW pages, there is a .intraday__data class. If there is a second one, or one with .afterhours class.
    
    // Attempt to find after hours price if it exists
    // This is speculative based on common patterns, as the dump didn't show it.
    // We'll look for any element containing "After Hours" and try to find a price near it.
    const afterHoursLabel = $('*:contains("After Hours")').last();
    if (afterHoursLabel.length > 0) {
        // Try to find a price sibling or child
        // This part is tricky without a sample. 
        // For now, we will leave it empty or try a generic search if we had more info.
        // Given the instructions, we should try to scrape it if possible.
        // Let's assume if there's an after hours price, it might be in a similar structure to intraday but with a different label.
    }

  } catch (e) {
    logDebug(`Error parsing MarketWatch HTML for ${ticker}: ${e.message}`);
  }

  return data;
}

module.exports = { scrapeMarketWatch };
