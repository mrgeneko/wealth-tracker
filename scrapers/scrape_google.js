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
		let previous_close_price = '';
		let after_hours_price = '';
		let after_hours_change_decimal = '';
		let after_hours_change_percent = '';
		let after_hours_time = '';
		let pre_market_price = '';
		let pre_market_price_change_decimal = '';
		let pre_market_price_change_percent = '';
		try {
			const main_element = $('[class="Gfxi4"]').first();
			const price_element = main_element.find('[class="YMlKec fxKbKc"]').first();
			if (price_element.length) {
				regular_price = price_element.text().replace('$', '').replace(',', '');
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
					regular_change_decimal = parts[0];
					// Percent is in a sibling span with class JwB6zf
					const percent_element = main_element.find('[class="JwB6zf"]').first();
					if (percent_element.length) {
						regular_change_percent = (change_text[0] || '') + percent_element.text();
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
						const ah_text = ext_hours_section.text();
						// Format: After Hours: $110.51 (0.00072%) +0.00080
						const match = ah_text.match(/\(([+\-]?[\d.]+)%\)\s*([+\-]?[\d.]+)/);
						if (match) {
							let percent_str = match[1];
							let change_str = match[2];
							after_hours_change_decimal = change_str;
							
							let percent_val = parseFloat(percent_str);
							// If percent string didn't have a sign, apply sign from change
							if (!percent_str.startsWith('+') && !percent_str.startsWith('-')) {
								if (change_str.startsWith('-')) {
									percent_val = -Math.abs(percent_val);
								} else {
									percent_val = Math.abs(percent_val);
								}
							}
							after_hours_change_percent = percent_val.toString();
						}
						// Extract after hours quote time
						const time_div = ext_hours_section.next('[jsname="Vebqub"]');
						if (time_div.length) {
							const raw_time = time_div.text();
							// Format: "Closed: Dec 2, 6:16:40 PM GMT-5 · USD · ..."
							const parts = raw_time.split('·');
							if (parts.length > 0) {
								let t = parts[0].replace('Closed:', '').replace('As of', '').trim();
								after_hours_time = parseToIso(t);
							}
						}
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
			let regular_time = '';
			const time_regex = /([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s*[AP]M\s*GMT[+-]\d+)/;
			const body_text = $('body').text();
			let match = body_text.match(time_regex);
			if (match) {
				regular_time = match[1];
			}
			if (!regular_time) {
				$('[class], span, div').each((i, el) => {
					const t = $(el).text();
					if (/GMT[+-]\d+/.test(t) && /\d{1,2}:\d{2}:\d{2}/.test(t)) {
						regular_time = t.trim();
						return false;
					}
				});
			}
		} catch (extractErr) {
			logDebug('Error extracting Google Finance data: ' + extractErr);
		}

		data = {
			"key" : ticker,
			"regular_price" : regular_price,
			"regular_change_decimal" : regular_change_decimal,
			"regular_change_percent" : regular_change_percent,
			regular_time: typeof regular_time !== 'undefined' ? parseToIso(regular_time) : '',
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
