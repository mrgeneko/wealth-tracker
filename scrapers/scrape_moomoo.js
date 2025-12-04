const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { DateTime } = require('luxon');
const { publishToKafka } = require('./publish_to_kafka');
const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, cleanNumberText, parseToIso } = require('./scraper_utils');

async function scrapeMoomoo(browser, security, outputDir) {
    let page = null;
    let data = {};
    const dateTimeString = getDateTimeString();
    try {
        const url = security.moomoo || security.moomooUrl;
        if (!url) {
            logDebug('No Moomoo URL provided for ' + security.key);
            return {};
        }
        const ticker = sanitizeForFilename(security.key);
        logDebug(`Security: ${ticker}   open Moomoo: ${url}`);
        const snapshotBase = path.join(outputDir, `${dateTimeString}.${ticker}.moomoo`);
        const pageOpts = { url, downloadPath: outputDir, waitUntil: 'domcontentloaded', timeout: 20000, gotoRetries: 3 };
        page = await createPreparedPage(browser, pageOpts);
        logDebug('Page loaded. Extracting HTML...');
        const html = await savePageSnapshot(page, snapshotBase);
        if (html) logDebug(`Saved Moomoo snapshot base ${snapshotBase}`);

        const result = parseMoomooHtml(html || '', { key: ticker });
        data = result;
        // publish & save
        try {
            const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeMoomoo';
            const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
            await publishToKafka(data, kafkaTopic, kafkaBrokers);
        } catch (kafkaErr) { logDebug('Kafka publish error (Moomoo): ' + kafkaErr); }

        try {
            const jsonFileName = `${dateTimeString}.${ticker}.moomoo.json`;
            const jsonFilePath = path.join(outputDir, jsonFileName);
            fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
            logDebug(`Saved Moomoo JSON to ${jsonFilePath}`);
        } catch (e) { logDebug('Error saving Moomoo JSON: ' + e); }

    } catch (err) { logDebug('Error in scrapeMoomoo: ' + err); }
    finally { if (page) { try { await page.close(); } catch (e) { logDebug('Error closing Moomoo tab: ' + e); } } }
    return data;
}

function parseMoomooHtml(html, security) {
    const $ = cheerio.load(html || '');
    const ticker = (security && security.key) ? sanitizeForFilename(security.key) : 'unknown';

    let regular_last_price = '';
    let regular_change_decimal = '';
    let regular_change_percent = '';
    let previous_close_price = '';
    let regular_time = '';

    try {
        // Price: .stock-data .price
        const priceEl = $('.stock-data .price');
        if (priceEl.length) {
            const priceText = priceEl.text().trim();
            regular_last_price = cleanNumberText(priceText);
        }

        // Change: .stock-data .change-price
        const changePriceEl = $('.stock-data .change-price');
        if (changePriceEl.length) {
            const changeText = changePriceEl.text().trim();
            regular_change_decimal = parseFloat(changeText);
        }

        // Percent: .stock-data .change-ratio
        const changeRatioEl = $('.stock-data .change-ratio');
        if (changeRatioEl.length) {
            const ratioText = changeRatioEl.text().trim().replace('%', '');
            regular_change_percent = parseFloat(ratioText);
        }

        // Calculate previous close
        if (regular_last_price && !isNaN(regular_change_decimal)) {
            const prev = parseFloat(regular_last_price) - regular_change_decimal;
            previous_close_price = prev.toFixed(3); // Moomoo seems to use 3 decimals
        }

        // Time: .stock-data .status
        // "Trading Nov 24 10:52 ET"
        const statusEl = $('.stock-data .status');
        if (statusEl.length) {
            let timeText = statusEl.text().trim();
            // Remove "Trading " or other prefixes if present
            timeText = timeText.replace(/Trading\s+/i, '').replace(/Closed\s+/i, '').replace(/Pre-Market\s+/i, '').replace(/After-Hours\s+/i, '');
            // Now we expect "Nov 24 10:52 ET"
            regular_time = parseToIso(timeText);
        }

    } catch (error) {
        console.error('Error parsing Moomoo HTML:', error);
    }

    return {
        key: ticker,
        regular_last_price: regular_last_price || '',
        regular_change_decimal: regular_change_decimal || '',
        regular_change_percent: regular_change_percent || '',
        previous_close_price: previous_close_price || '',
        source: 'moomoo',
        capture_time: new Date().toISOString(),
        regular_time: regular_time || ''
    };
}

module.exports = { scrapeMoomoo, parseMoomooHtml };
