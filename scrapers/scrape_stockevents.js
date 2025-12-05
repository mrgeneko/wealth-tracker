// scrape_stockevents.js
// Scrape StockEvents stock/bond page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  try {
    // Expected formats: "Today", "Thursday 00:00", etc.
    // For simplicity, use current time if not parseable
    const now = DateTime.now();
    return now.toISO();
  } catch (e) {
    return '';
  }
}

async function scrapeStockEvents(browser, security, outputDir) {
	let page = null;
	let data = {};
	const dateTimeString = getDateTimeString();
	try {
		const url = security.stockevents;
		const ticker = sanitizeForFilename(security.key);
		logDebug(`Security: ${ticker}   open StockEvents: ${url}`);
		const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.stockevents`);
		const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
		page = await createPreparedPage(browser, pageOpts);
		logDebug('Page loaded. Extracting HTML...');
		const html = await savePageSnapshot(page, snapshotBase);
		if (html) logDebug(`Saved StockEvents snapshot base ${snapshotBase}`);
		
		const $ = cheerio.load(html);
		
		let regular_last_price = '';
		let regular_change_decimal = '';
		let regular_change_percent = '';
		let previous_close_price = '';
		let regular_time = '';
		
		try {
			// Extract price from the main price display
			// Format: $338.09 [Image: Image] 26827 +$1+0.3% Today  1D1W1M3M1Y5Y
			const bodyText = $('body').text();
			
			// Find price pattern: $ followed by number
			const priceMatch = bodyText.match(/\$([\d,]+\.?\d*)/);
			if (priceMatch) {
				regular_last_price = priceMatch[1].replace(',', '');
			}
			
			// Find change pattern: +$1+0.3% or -$0.01-0.01%
			const changeMatch = bodyText.match(/([+-]\$[\d,]+\.?\d*)([+-][\d,]+\.?\d*%)/);
			if (changeMatch) {
				regular_change_decimal = changeMatch[1].replace('$', '');
				regular_change_percent = changeMatch[2];
			}
			
			// Extract time - for stockevents, if it shows "Today", use current time
			if (bodyText.includes('Today')) {
				regular_time = new Date().toISOString();
			} else {
				// Try to extract specific time if available
				const timeMatch = bodyText.match(/(\d{1,2}:\d{2})/);
				if (timeMatch) {
					regular_time = parseToIso(timeMatch[1]);
				}
			}
			
			// For previous close, look in Statistics section
			const statsText = bodyText.match(/Statistics\s+Day High.*?52W Low.*?Volume.*?Avg\. Volume.*?Mkt Cap.*?P\/E Ratio.*?Dividend Yield.*?Dividend.*?/s);
			if (statsText) {
				// Previous close might not be directly available, skip for now
			}
			
		} catch (e) {
			logDebug('Error extracting StockEvents data: ' + e);
		}
		
		data = {
			source: 'stockevents',
			symbol: security.key,
			regular_last_price,
			regular_change_decimal,
			regular_change_percent,
			previous_close_price,
			regular_time,
			scraped_at: new Date().toISOString()
		};
		
		logDebug(`StockEvents data for ${security.key}: price=${regular_last_price}, change=${regular_change_decimal} (${regular_change_percent})`);
		
	} catch (e) {
		logDebug('Error scraping StockEvents: ' + e.message);
		data.error = e.message;
	} finally {
		if (page) {
			try {
				await page.close();
			} catch (e) {
				logDebug('Error closing page: ' + e);
			}
		}
	}
	
	return data;
}

module.exports = { scrapeStockEvents };