// scrape_webull.js
// Scrape Webull stock/bond page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, gotoWithRetries, attachRequestFailureCounters } = require('./scraper_utils');
const { createPreparedPage, savePageSnapshot } = require('./scraper_utils');

async function scrapeWebull(browser, security, outputDir) {
    let page = null;
    let data = {};
    try {
        const url = security.webull;
        const ticker = sanitizeForFilename(security.key);
        logDebug(`Security: ${ticker}   open Webull: ${url}`);
        const snapshotBase = path.join(outputDir, `${ticker}.webull.${getDateTimeString()}`);
        const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
        page = await createPreparedPage(browser, pageOpts);
        logDebug('Page loaded. Extracting HTML...');
        const html = await savePageSnapshot(page, snapshotBase);
        if (html) logDebug(`Saved Webull snapshot base ${snapshotBase}`);

        const $ = cheerio.load(html);
        //logDebug('webull html:' + html);

        let last_price = '';
        let price_change_decimal = '';
        let price_change_percent = '';
        let previous_close_price = '';
        let after_hours_price = '';
        let pre_market_price = '';
        let pre_market_price_change_decimal = '';
        let pre_market_price_change_percent = '';
        let quote_time = '';

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
                                last_price = rt.close || '';
                                price_change_decimal = rt.change || '';
                                price_change_percent = rt.changeRatio || '';
                                previous_close_price = rt.preClose || '';
                                
                                // Bond pages typically don't have pre/after market data in the same way
                                if (!isBond) {
                                    after_hours_price = rt.afterHoursPrice || '';
                                    pre_market_price = rt.preMarketPrice || '';
                                    pre_market_price_change_decimal = rt.preMarketChange || '';
                                    pre_market_price_change_percent = rt.preMarketChangeRatio || '';
                                }

                                if (rt.tradeTime) {
                                    quote_time = rt.tradeTime;
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


        data = {
            key: ticker,
            last_price,
            price_change_decimal,
            price_change_percent,
            after_hours_price,
            pre_market_price,
            pre_market_price_change_decimal,
            pre_market_price_change_percent,
            previous_close_price,
            source: 'webull',
            capture_time: new Date().toISOString().replace('T', ' ').replace('Z', ' UTC'),
            quote_time
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
        const jsonFileName = `${ticker}.webull.${getDateTimeString()}.json`;
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
