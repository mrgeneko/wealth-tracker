// scrape_google.js
// Scrape Google Finance stock page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');

async function scrapeGoogle(browser, security, outputDir) {
	let page = null;
	let data = {};
	try {
		const url = security.google;
		const ticker = sanitizeForFilename(security.key);
		logDebug(`Security: ${ticker}   open Google Finance: ${url}`);
		const snapshotBase = path.join(outputDir, `${getDateTimeString()}.${ticker}.google`);
		const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
		page = await createPreparedPage(browser, pageOpts);
		logDebug('Page loaded. Extracting HTML...');
		const html = await savePageSnapshot(page, snapshotBase);
		if (html) logDebug(`Saved Google snapshot base ${snapshotBase}`);
		
		const $ = cheerio.load(html);
		// Extract main price
		let last_price = '';
		let price_change_decimal = '';
		let price_change_percent = '';
		let previous_close_price = '';
		let after_hours_price = '';
		let pre_market_price = '';
		let pre_market_price_change_decimal = '';
		let pre_market_price_change_percent = '';
		try {
			const main_element = $('[class="Gfxi4"]').first();
			const price_element = main_element.find('[class="YMlKec fxKbKc"]').first();
			if (price_element.length) {
				last_price = price_element.text().replace('$', '').replace(',', '');
			}
			// Previous close
			const prev_close_label = $('div').filter((i, el) => $(el).text().trim().toLowerCase() === 'previous close').first();
			if (prev_close_label.length) {
				const parent = prev_close_label.closest('div.gyFHrc');
				if (parent.length) {
					const price_div = parent.find('div.P6K39c').first();
					if (price_div.length) {
						previous_close_price = price_div.text().replace('$', '').replace(',', '').trim();
					}
				}
			}
			// Price change
			let change_element = main_element.find('[class="P2Luy Ez2Ioe ZYVHBb"], [class="P2Luy Ebnabc ZYVHBb"]').first();
			if (change_element.length) {
				const change_text = change_element.text();
				if (change_text.startsWith('+') || change_text.startsWith('-')) {
					const parts = change_text.split(' ');
					price_change_decimal = parts[0];
					// Percent is in a sibling span with class JwB6zf
					const percent_element = main_element.find('[class="JwB6zf"]').first();
					if (percent_element.length) {
						price_change_percent = (change_text[0] || '') + percent_element.text();
					}
				}
			}
			// After/pre-market
			const ext_hours_section = $('[jsname="QRHKC"]').first();
			if (ext_hours_section.length) {
				const ext_price = ext_hours_section.find('[class="YMlKec fxKbKc"]').first();
				if (ext_price.length) {
					if (ext_hours_section.text().startsWith('After Hours')) {
						after_hours_price = ext_price.text().replace('$', '').replace(',', '').trim();
					} else if (ext_hours_section.text().startsWith('Pre-market')) {
						pre_market_price = ext_price.text().replace('$', '').replace(',', '').trim();
						let preMarketChangeElem = $('span.P2Luy.Ebnabc.DnMTof');
						if (preMarketChangeElem.length) {
							logDebug('premarketchange text:' + preMarketChangeElem.text());
							const changeText = preMarketChangeElem.text().trim();
							// Expect format like "1.77%-3.36" or just "-3.36"
							const match = changeText.match(/^([+-]?[0-9,.]+%)?\s*([+-]?[0-9,.]+)$/);
							if (match) {
								let percent = match[1] ? match[1].replace(',', '') : '';
								let decimal = match[2].replace(',', '');
								// Try to find the arrow in the same parent node
								let arrowElem = preMarketChangeElem.parent().find('span.notranslate.V53LMb').first();
								logDebug('arrowElem.html:' + (arrowElem.length ? arrowElem.html() : 'null'));
								logDebug('length:' + arrowElem.length);
								let sign = '';
								let svgHtml = '';
								if (arrowElem.length) {
									svgHtml = arrowElem.html() || '';
									logDebug('premarket arrow SVG HTML: ' + svgHtml);
									if (svgHtml.includes('M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z')) {
										sign = '-'; // Down arrow
									} else if (svgHtml.includes('M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.58L20 12l-8-8-8 8z')) {
										sign = '+'; // Up arrow
									}
								}
								logDebug('premarket percent before sign logic: ' + percent);
								logDebug('premarket detected sign: ' + sign);
								// Only set the sign for percent
								if (percent) {
									percent = percent.replace(/^[-+]/, ''); // Remove any sign
									if (sign) percent = sign + percent;
									logDebug('premarket percent after sign logic: ' + percent);
									pre_market_price_change_percent = percent;
								}
								pre_market_price_change_decimal = decimal;
							}
						}
					}
				}
			}
			// Extract quote time (e.g., 'Nov 14, 8:00:00 PM GMT-5')
			let quote_time = '';
			const time_regex = /([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s*[AP]M\s*GMT[+-]\d+)/;
			const body_text = $('body').text();
			const match = body_text.match(time_regex);
			if (match) {
				quote_time = match[1];
			}
			if (!quote_time) {
				$('[class], span, div').each((i, el) => {
					const t = $(el).text();
					if (/GMT[+-]\d+/.test(t) && /\d{1,2}:\d{2}:\d{2}/.test(t)) {
						quote_time = t.trim();
						return false;
					}
				});
			}
			// Use a local variable instead of globalThis to avoid side effects across concurrent scrapes
			var local_quote_time = quote_time;
		} catch (extractErr) {
			logDebug('Error extracting Google Finance data: ' + extractErr);
		}

		data = {
			"key" : ticker,
			"last_price" : last_price,
			"price_change_decimal" : price_change_decimal,
			"price_change_percent" : price_change_percent,
			"previous_close_price" : previous_close_price,
			"after_hours_price" : after_hours_price,
			"pre_market_price" : pre_market_price,
			"pre_market_price_change_decimal": pre_market_price_change_decimal,
			"pre_market_price_change_percent": pre_market_price_change_percent,
			source: 'google_finance',
			capture_time: new Date().toISOString().replace("T", " ").replace("Z", " UTC"),
			quote_time: typeof local_quote_time !== 'undefined' ? local_quote_time : ''
		};

		logDebug('Google Finance data: ' + JSON.stringify(data));

		// Publish the data object to Kafka
		try {
			const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeGoogle';
			const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
			await publishToKafka(data, kafkaTopic, kafkaBrokers);
			logDebug(`Published Google Finance data to Kafka topic ${kafkaTopic}`);
		} catch (kafkaErr) {
			logDebug('Kafka publish error (Google Finance): ' + kafkaErr);
		}

		// Save the data object to google.yyyymmdd_hhmmss.json using getDateTimeString
		const jsonFileName = `${getDateTimeString()}.${ticker}.google.json`;
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
