// scrape_webull.js
// Scrape Webull stock/bond page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, gotoWithRetries, attachRequestFailureCounters } = require('./scraper_utils');
const { createPreparedPage, savePageSnapshot } = require('./scraper_utils');

function parseToIso(val) {
    if (!val) return '';
    if (typeof val === 'number') {
        return DateTime.fromMillis(val).toUTC().toISO();
    }
    const str = String(val).trim();
    
    const zone = 'America/New_York';
    const dt = DateTime.fromISO(str, { zone });
    if (dt.isValid) return dt.toUTC().toISO();
    return str;
}

async function scrapeWebull(browser, security, outputDir) {
    let page = null;
    let data = {};
    const dateTimeString = getDateTimeString();
    try {
        const url = security.webull;
        const ticker = sanitizeForFilename(security.key);
        logDebug(`Security: ${ticker}   open Webull: ${url}`);
        const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.webull`);
        const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
        page = await createPreparedPage(browser, pageOpts);
        logDebug('Page loaded. Extracting HTML...');
        const html = await savePageSnapshot(page, snapshotBase);
        if (html) logDebug(`Saved Webull snapshot base ${snapshotBase}`);

        const $ = cheerio.load(html);
        //logDebug('webull html:' + html);

        let regular_last_price = '';
        let regular_change_decimal = '';
        let regular_change_percent = '';
        let previous_close_price = '';
        let after_hours_price = '';
        let after_hours_change_decimal = '';
        let after_hours_change_percent = '';
        let after_hours_price_quote_time = '';
        let pre_market_price = '';
        let pre_market_price_change_decimal = '';
        let pre_market_price_change_percent = '';
        let regular_quote_time = '';

        // Detect bond or stock by presence of 'YIELD' and 'MATURITY' in HTML
        // Note: This logic is largely redundant as both branches use the same JSON extraction logic
        // but we keep the structure in case specific handling is needed later.
        const isBond = html.includes('YIELD') && html.includes('MATURITY');
        logDebug(isBond ? 'detected Bond page' : 'detected Stock page');

        // Try to extract embedded JSON from <script id="server-side-script">
        let foundJson = false;
        const scriptTag = $('script#server-side-script').html();
        if (scriptTag && scriptTag.includes('window.__initState__')) {
            try {
                const match = scriptTag.match(/window\.__initState__\s*=\s*(\{[\s\S]*?\});?\s*([\r\n]|$)/);
                if (match && match[1]) {
                    const state = JSON.parse(match[1]);
                    // Find data in tickerMap
                    if (state.tickerMap) {
                        const tickerKeys = Object.keys(state.tickerMap);
                        if (tickerKeys.length > 0) {
                            const tickerObj = state.tickerMap[tickerKeys[0]];
                            if (tickerObj.tickerRT) {
                                const rt = tickerObj.tickerRT;
                                regular_last_price = rt.close || '';
                                regular_change_decimal = rt.change || '';
                                regular_change_percent = rt.changeRatio || '';
                                previous_close_price = rt.preClose || '';
                                
                                // Bond pages typically don't have pre/after market data in the same way
                                if (!isBond) {
                                    after_hours_price = rt.afterHoursPrice || '';
                                    pre_market_price = rt.preMarketPrice || '';
                                    pre_market_price_change_decimal = rt.preMarketChange || '';
                                    pre_market_price_change_percent = rt.preMarketChangeRatio || '';
                                }

                                if (rt.tradeTime) {
                                    regular_quote_time = parseToIso(rt.tradeTime);
                                }
                                foundJson = true;
                            }
                        }
                    }
                }
            } catch (e) {
                logDebug('Error parsing embedded Webull JSON: ' + e);
            }
        }
        
        if (!foundJson) {
            logDebug('Webull embedded JSON not found or parse failed; fields left empty.');
        }

        // Fallback/Supplement with HTML parsing for After Hours if missing
        if (!after_hours_price) {
            try {
                // Look for "After Hours:" text
                // Structure: <div>After Hours: <span>256.06 -0.03 -0.01%</span> 16:38 12/02 EST</div>
                const afterHoursLabel = $('div:contains("After Hours:")').last();
                if (afterHoursLabel.length) {
                    const span = afterHoursLabel.find('span');
                    if (span.length) {
                        const valText = span.text().trim(); // "256.06 -0.03 -0.01%"
                        const parts = valText.split(/\s+/);
                        if (parts.length >= 3) {
                            after_hours_price = parts[0];
                            after_hours_change_decimal = parts[1];
                            after_hours_change_percent = parts[2];
                        } else if (parts.length >= 1) {
                            after_hours_price = parts[0];
                        }
                    }
                    
                    // Time extraction: text after the span
                    const fullText = afterHoursLabel.text(); // "After Hours: 256.06 -0.03 -0.01% 16:38 12/02 EST"
                    const spanText = span.text();
                    const afterSpan = fullText.split(spanText)[1];
                    if (afterSpan) {
                        const timeText = afterSpan.trim(); // "16:38 12/02 EST"
                        // Parse "16:38 12/02 EST"
                        const cleanTime = timeText.replace(/(EST|EDT)/, '').trim();
                        const dt = DateTime.fromFormat(cleanTime, "HH:mm MM/dd", { zone: 'America/New_York' });
                        if (dt.isValid) {
                            // Set year to current year as it's missing in the string
                            const now = DateTime.now().setZone('America/New_York');
                            const finalDt = dt.set({ year: now.year });
                            after_hours_price_quote_time = finalDt.toUTC().toISO();
                        }
                    }
                }
            } catch (e) {
                logDebug('Error parsing Webull HTML for After Hours: ' + e);
            }
        }


        data = {
            key: ticker,
            regular_last_price,
            regular_change_decimal,
            regular_change_percent,
            regular_quote_time,
            after_hours_price,
            after_hours_change_decimal,
            after_hours_change_percent,
            after_hours_price_quote_time,
            pre_market_price,
            pre_market_price_change_decimal,
            pre_market_price_change_percent,
            previous_close_price,
            source: 'webull',
            capture_time: new Date().toISOString()
        };

        logDebug('Webull data: ' + JSON.stringify(data));

        // Publish the data object to Kafka
        try {
            const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeWebull';
            const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
            await publishToKafka(data, kafkaTopic, kafkaBrokers);
            logDebug(`Published Webull data to Kafka topic ${kafkaTopic}`);
        } catch (kafkaErr) {
            logDebug('Kafka publish error (Webull): ' + kafkaErr);
        }

        // Save the data object to webull.yyyymmdd_hhmmss.json using getDateTimeString
        const jsonFileName = `${dateTimeString}.${ticker}.webull.json`;
        const jsonFilePath = path.join(outputDir, jsonFileName);
        fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
        logDebug(`Saved Webull JSON to ${jsonFilePath}`);
    } catch (err) {
        logDebug('Error in scrapeWebull: ' + err);
    } finally {
        if (page) {
            try { await page.close(); logDebug('Closed Webull tab.'); } catch (e) { logDebug('Error closing tab: ' + e); }
        }
    }
    return data;
}

module.exports = { scrapeWebull };
