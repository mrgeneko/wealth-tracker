// scrape_google.js
// Scrape Google Finance stock page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function parseToIso(timeStr) {
  if (!timeStr) return '';
  try {
    // Expected format: "Nov 14, 8:00:00 PM GMT-5"
    // Luxon's fromFormat with 'z' or 'Z' can be tricky with "GMT-5".
    // We can try to parse it directly if it matches standard formats, or strip the offset and apply it manually.
    
    // Try parsing with offset included
    let dt = DateTime.fromFormat(timeStr, "MMM d, h:mm:ss a 'GMT'Z", { locale: 'en-US' });
    if (dt.isValid) return dt.toISO();

    // Try without seconds
    dt = DateTime.fromFormat(timeStr, "MMM d, h:mm a 'GMT'Z", { locale: 'en-US' });
    if (dt.isValid) return dt.toISO();

    // Fallback: try standard JS Date parsing (often handles "Nov 14, 8:00:00 PM GMT-5" well)
    // But we need to add the current year if it's missing (Google often omits year)
    let parseStr = timeStr;
    if (!/\d{4}/.test(timeStr)) {
        const year = new Date().getFullYear();
        // Insert year after "Nov 14" -> "Nov 14 2025"
        parseStr = timeStr.replace(/([A-Z][a-z]{2} \d{1,2})/, `$1 ${year}`);
    }
    
    const jsDate = new Date(parseStr);
    if (!isNaN(jsDate.getTime())) {
        return jsDate.toISOString();
    }

    return timeStr;
  } catch (e) {
    return timeStr;
  }
}

async function scrapeGoogle(browser, security, outputDir) {
	let page = null;
	let data = {};
	const dateTimeString = getDateTimeString();
	try {
		const url = security.google;
		const ticker = sanitizeForFilename(security.key);
		logDebug(`Security: ${ticker}   open Google Finance: ${url}`);
		const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.google`);
		const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
		page = await createPreparedPage(browser, pageOpts);
		logDebug('Page loaded. Extracting HTML...');
		const html = await savePageSnapshot(page, snapshotBase);
		if (html) logDebug(`Saved Google snapshot base ${snapshotBase}`);
		
		const $ = cheerio.load(html);
		// Extract main price
		let regular_price = '';
		let regular_change_decimal = '';
		let regular_change_percent = '';
		let regular_time = '';
		let previous_close_price = '';
		let after_hours_price = '';
		let after_hours_change_decimal = '';
		let after_hours_change_percent = '';
		let after_hours_time = '';
		let pre_market_price = '';
		let pre_market_price_change_decimal = '';
		let pre_market_price_change_percent = '';
		try {
			// Parse data from JavaScript AF_initDataCallback script blocks
			// ds:10 contains the most complete data for the quoted ticker
			const scripts = $('script[class^="ds:"]');
			let intradayData = null;
			
			scripts.each((i, script) => {
				const scriptText = $(script).html();
				if (scriptText && scriptText.includes('AF_initDataCallback')) {
					const className = $(script).attr('class');
					// ds:10 contains intraday data with regular hours and after-hours
					if (className === 'ds:10') {
						const match = scriptText.match(/data:\s*(\[[\s\S]*?\]),\s*sideChannel/);
						if (match) {
							try {
								intradayData = JSON.parse(match[1]);
							} catch (e) {
								logDebug('Error parsing ds:10 data: ' + e);
							}
						}
					}
				}
			});

			// Extract from ds:10 intraday data
			// Structure: [[[["BRK.B","NYSE"],"/g/..","USD",[[[1,...],[data points]],[[3,...],[ah points]]],null,-18000,503.23,"Company",60,0]]]
			if (intradayData && intradayData[0] && intradayData[0][0]) {
				const tickerWrapper = intradayData[0][0];
				const tickerInfo = tickerWrapper[0]; // ["BRK.B","NYSE"]
				
				// Verify this is our ticker
				if (tickerInfo && tickerInfo[0] === security.key) {
					// Previous close is at index [6]
					const prevClose = tickerWrapper[6];
					if (prevClose) {
						previous_close_price = prevClose.toString();
					}
					
					// Data sections at index [3]
					const dataSections = tickerWrapper[3];
					if (dataSections) {
						// Regular hours data: dataSections[0]
						// After-hours data: dataSections[1] (if exists)
						
						// Process regular hours
						if (dataSections[0] && dataSections[0][1]) {
							const regularPoints = dataSections[0][1];
							if (regularPoints && regularPoints.length > 0) {
								const lastRegularPoint = regularPoints[regularPoints.length - 1];
								const pointTime = lastRegularPoint[0]; // [2025,12,5,16,null,null,null,[-18000]]
								const pointData = lastRegularPoint[1]; // [504.32,1.09,0.00216,2,2,4]
								
								if (pointData && pointData.length >= 3) {
									regular_price = pointData[0].toString();
									regular_change_decimal = pointData[1].toString();
									regular_change_percent = (pointData[2] * 100).toFixed(2) + '%';
									
									// Build timestamp
									const dt = DateTime.fromObject({
										year: pointTime[0],
										month: pointTime[1],
										day: pointTime[2],
										hour: pointTime[3] || 0,
										minute: pointTime[4] || 0,
										second: pointTime[5] || 0
									}, { zone: 'America/New_York' });
									regular_time = dt.isValid ? dt.toISO() : '';
								}
							}
						}
						
						// Process after-hours if available
						if (dataSections[1] && dataSections[1][1]) {
							const afterHoursPoints = dataSections[1][1];
							if (afterHoursPoints && afterHoursPoints.length > 0) {
								const lastAHPoint = afterHoursPoints[afterHoursPoints.length - 1];
								const ahTime = lastAHPoint[0];
								const ahData = lastAHPoint[1];
								
								if (ahData && ahData.length >= 3) {
									after_hours_price = ahData[0].toString();
									after_hours_change_decimal = ahData[1].toString();
									after_hours_change_percent = (ahData[2] * 100).toFixed(2) + '%';
									
									const dt = DateTime.fromObject({
										year: ahTime[0],
										month: ahTime[1],
										day: ahTime[2],
										hour: ahTime[3] || 0,
										minute: ahTime[4] || 0,
										second: ahTime[5] || 0
									}, { zone: 'America/New_York' });
									after_hours_time = dt.isValid ? dt.toISO() : '';
								}
							}
						}
					}
				}
			}

		} catch (extractErr) {
			logDebug('Error extracting Google Finance data: ' + extractErr);
		}

		data = {
			"key" : ticker,
			"regular_price" : regular_price,
			"regular_change_decimal" : regular_change_decimal,
			"regular_change_percent" : regular_change_percent,
			regular_time: regular_time,
			"previous_close_price" : previous_close_price,
			"after_hours_price" : after_hours_price,
			"after_hours_change_decimal" : after_hours_change_decimal,
			"after_hours_change_percent" : after_hours_change_percent,
			"after_hours_time" : after_hours_time,
			"pre_market_price" : pre_market_price,
			"pre_market_price_change_decimal": pre_market_price_change_decimal,
			"pre_market_price_change_percent": pre_market_price_change_percent,
			source: 'google',
			capture_time: new Date().toISOString()
		};

		logDebug('Google Finance data: ' + JSON.stringify(data));

		// Publish the data object to Kafka
		try {
			const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeGoogle';
			const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
			await publishToKafka(data, kafkaTopic, kafkaBrokers);
			logDebug(`Published Google Finance data to Kafka topic ${kafkaTopic}`);
		} catch (kafkaErr) {
			logDebug('Kafka publish error (Google Finance): ' + kafkaErr);
		}

		// Save the data object to google.yyyymmdd_hhmmss.json using getDateTimeString
		const jsonFileName = `${dateTimeString}.${ticker}.google.json`;
		const jsonFilePath = path.join(outputDir, jsonFileName);
fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
		logDebug(`Saved Google JSON to ${jsonFilePath}`);
		
	} catch (err) {
		logDebug('Error in scrapeGoogle: ' + err);
	} finally {
		if (page) {
			try { await page.close(); logDebug('Closed Google Finance tab.'); } catch (e) { logDebug('Error closing tab: ' + e); }
		}
	}
	return data;
}

module.exports = { scrapeGoogle };
