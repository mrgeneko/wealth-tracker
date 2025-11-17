// scrape_webull.js
// Scrape Webull stock/bond page and extract price data

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug } = require('./scraper_utils');

async function scrapeWebull(browser, security, outputDir) {
    let page = null;
    let data = {};
    try {
        const url = security.webull;
        const ticker = sanitizeForFilename(security.key);
        logDebug(`Security: ${ticker}   open Webull: ${url}`);
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        logDebug('Page loaded. Extracting HTML...');
        
        const html = await page.content();

        // Save the HTML to webull.yyyymmdd_hhmmss.html using getDateTimeString and outputDir
        const htmlFileName = `${ticker}.webull.${getDateTimeString()}.html`;
        const htmlFilePath = path.join(outputDir, htmlFileName);
        fs.writeFileSync(htmlFilePath, html, 'utf-8');
        logDebug(`Saved Webull HTML to ${htmlFilePath}`);

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
        if (html.includes('YIELD') && html.includes('MATURITY')) {
            logDebug('detected Bond page');
            // Try to extract embedded JSON from <script id="server-side-script">
            let foundJson = false;
            const scriptTag = $('script#server-side-script').html();
            if (scriptTag && scriptTag.includes('window.__initState__')) {
                try {
                    const match = scriptTag.match(/window\.__initState__\s*=\s*(\{[\s\S]*?\});?\s*([\r\n]|$)/);
                    if (match && match[1]) {
                        const state = JSON.parse(match[1]);
                        // Find bond data in tickerMap
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
                                    after_hours_price = '';
                                    pre_market_price = '';
                                    // Webull bonds do not have pre/after market
                                    // Try to extract quote time if available
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
        } else {
            logDebug('detected Stock page');
            // Try to extract embedded JSON from <script id="server-side-script"> for stocks
            let foundJson = false;
            const scriptTag = $('script#server-side-script').html();
            if (scriptTag && scriptTag.includes('window.__initState__')) {
                try {
                    const match = scriptTag.match(/window\.__initState__\s*=\s*(\{[\s\S]*?\});?\s*([\r\n]|$)/);
                    if (match && match[1]) {
                        const state = JSON.parse(match[1]);
                        // Find stock data in tickerMap
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
                                    after_hours_price = rt.afterHoursPrice || '';
                                    pre_market_price = rt.preMarketPrice || '';
                                    // Optionally, add pre/after market change fields if available
                                    pre_market_price_change_decimal = rt.preMarketChange || '';
                                    pre_market_price_change_percent = rt.preMarketChangeRatio || '';
                                    if (rt.tradeTime) {
                                        quote_time = rt.tradeTime;
                                    }
                                    foundJson = true;
                                }
                            }
                        }
                    }
                } catch (e) {
                    logDebug('Error parsing embedded Webull JSON (stock): ' + e);
                }
            }
            if (!foundJson) {
                logDebug('Webull embedded JSON not found or parse failed for stock; fields left empty.');
            }
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
