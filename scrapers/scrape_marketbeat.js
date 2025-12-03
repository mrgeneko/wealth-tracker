const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, cleanNumberText, parseToIso } = require('./scraper_utils');

async function scrapeMarketBeat(browser, security, outputDir) {
    let page = null;
    let data = {};
    const dateTimeString = getDateTimeString();
    try {
        const url = security.marketbeat || security.marketbeatUrl;
        if (!url) {
            logDebug('No MarketBeat URL provided for ' + security.key);
            return {};
        }
        const ticker = sanitizeForFilename(security.key);
        logDebug(`Security: ${ticker}   open MarketBeat: ${url}`);
        const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.marketbeat`);
        const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
        page = await createPreparedPage(browser, pageOpts);
        logDebug('Page loaded. Extracting HTML...');
        const html = await savePageSnapshot(page, snapshotBase);
        if (html) logDebug(`Saved MarketBeat snapshot base ${snapshotBase}`);

        const result = parseMarketBeatHtml(html || '', { key: ticker });
        data = result;
        // publish & save
        try {
            const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeMarketBeat';
            const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
            await publishToKafka(data, kafkaTopic, kafkaBrokers);
        } catch (kafkaErr) { logDebug('Kafka publish error (MarketBeat): ' + kafkaErr); }

        try {
            const jsonFileName = `${dateTimeString}.${ticker}.marketbeat.json`;
            const jsonFilePath = path.join(outputDir, jsonFileName);
            fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
            logDebug(`Saved MarketBeat JSON to ${jsonFilePath}`);
        } catch (e) { logDebug('Error saving MarketBeat JSON: ' + e); }

    } catch (err) { logDebug('Error in scrapeMarketBeat: ' + err); }
    finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing MarketBeat tab: ' + e); } } }
    return data;
}

function parseMarketBeatHtml(html, security) {
    const $ = cheerio.load(html || '');
    const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

    let regular_last_price = '';
    let regular_change_decimal = '';
    let regular_change_percent = '';
    let previous_close_price = '';
    let regular_time = '';

    try {
        // Price and Change are in the .price-info section
        // <div class="price-info ...">
        //   ...
        //   <strong style="font-size:1.7em;color: var(--blue-11);">$501.30</strong> 
        //   <strong style="color:#11824D"> +0.18 (+0.04%)</strong>
        //   ...
        // </div>

        const priceInfo = $('.price-info');
        if (priceInfo.length) {
            // Find the price strong tag. It usually starts with '$' and has a large font size.
            // We filter for text starting with '$' to be safe.
            const priceStrong = priceInfo.find('strong').filter((i, el) => {
                return $(el).text().trim().startsWith('$');
            }).first();
            
            if (priceStrong.length) {
                const priceText = priceStrong.text().trim();
                regular_last_price = cleanNumberText(priceText);

                // Change and Percent Change are in the next strong tag
                const changeStrong = priceStrong.next('strong');
                if (changeStrong.length) {
                    const changeText = changeStrong.text().trim();
                    // Format: "+0.18 (+0.04%)"
                    const changeMatch = changeText.match(/([+-]?[\d\.]+)\s*\(([+-]?[\d\.]+)%\)/);
                    
                    if (changeMatch) {
                        regular_change_decimal = parseFloat(changeMatch[1]);
                        regular_change_percent = parseFloat(changeMatch[2]);
                    }
                }

                // Calculate previous close if we have price and change
                if (regular_last_price && regular_change_decimal !== '') {
                    // Current = Prev + Change  =>  Prev = Current - Change
                    const prev = parseFloat(regular_last_price) - parseFloat(regular_change_decimal);
                    previous_close_price = prev.toFixed(2);
                }
            }
        }

        // Time
        // <div class="price-updated">As of 09:30 AM Eastern ...</div>
        const timeText = $('.price-updated').text().trim();
        // "As of 09:30 AM Eastern"
        const timeMatch = timeText.match(/As of\s+(.*?Eastern)/i);
        if (timeMatch) {
            // "09:30 AM Eastern"
            let timeStr = timeMatch[1].replace('Eastern', 'ET').trim();
            regular_time = parseToIso(timeStr);
        }

    } catch (error) {
        console.error('Error parsing MarketBeat HTML:', error);
    }

    return {
        key: ticker,
        regular_last_price: regular_last_price || '',
        regular_change_decimal: regular_change_decimal || '',
        regular_change_percent: regular_change_percent || '',
        previous_close_price: previous_close_price || '',
        source: 'marketbeat',
        capture_time: new Date().toISOString(),
        regular_time: regular_time || ''
    };
}

module.exports = { scrapeMarketBeat, parseMarketBeatHtml };
