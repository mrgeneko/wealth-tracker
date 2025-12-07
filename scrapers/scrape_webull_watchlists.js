const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, isProtocolTimeoutError, normalizedKey } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');
const path = require('path');
const fs = require('fs');

async function scrapeWebullWatchlists(browser, watchlist, outputDir) {
    const webullUrl = 'https://app.webull.com/watch';
    const webullEmail = process.env.WEBULL_EMAIL;
    const webullPassword = process.env.WEBULL_PASSWORD;
    const dateTimeString = getDateTimeString();
    const safeWatchlistKey = sanitizeForFilename(watchlist.key || 'webull');
    let page;
    try {
        logDebug('Using createPreparedPage (reuse webull tab if present)');
        page = await createPreparedPage(browser, {
            reuseIfUrlMatches: /webull\.com\/watch/,
            url: webullUrl,
            downloadPath: outputDir,
            waitUntil: 'domcontentloaded',
            timeout: 20000,
            attachCounters: true,
            gotoRetries: 3,
            reloadExisting: false
        });
        await page.bringToFront();

        let needsLogin = false;
        try {
            logDebug('Checking for "Please Login" prompt...');
            await page.waitForXPath("//*[contains(., 'Please')]/descendant::*[normalize-space(.)='Login']", { timeout: 10000 });
            needsLogin = true;
            logDebug('"Please Login" prompt detected.');
        } catch (e) {
            logDebug('"Please Login" prompt not detected.');
        }

        if (needsLogin) {
            logDebug('Attempting Email Login flow...');
            try {
                await page.type('input[type="email"]', webullEmail, { delay: 50 });
                await page.type('input[type="password"]', webullPassword, { delay: 50 });
                await page.click('button[type="submit"]'); // Adjust selector if needed
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                logDebug('Login submitted.');
            } catch (loginErr) {
                logDebug('Login failed: ' + loginErr.message);
            }
        }
        
        logDebug('Waiting for watchlist content...');
        await page.waitForSelector('table, [role="grid"], .watchlist, .quotes-list, .list-root', { timeout: 10000 });
        
        logDebug('Watchlist content detected. Extracting HTML...');
        const snapshotBase = path.join(outputDir, `${dateTimeString}.webull_watchlist.${safeWatchlistKey}`);
        const fullPageHtml = await savePageSnapshot(page, snapshotBase);
        logDebug(`Saved snapshot to ${snapshotBase}`);
        
        const cheerio = require('cheerio');
        const $ = cheerio.load(fullPageHtml);
        const table = $('table').first();
        const dataObjects = [];
        if (table.length) {
            table.find('tbody tr').each((i, row) => {
                const rowData = {};
                $(row).find('td').each((j, col) => {
                    rowData[`col${j}`] = $(col).text().trim();
                });
                if (Object.keys(rowData).length > 0) {
                    dataObjects.push(rowData);
                }
            });
            logDebug(`Total stock rows found: ${dataObjects.length}`);
        } else {
            logDebug('No table found in the HTML.');
        }
        
        const outPath = path.join(outputDir, `${dateTimeString}.webull_watchlist.${safeWatchlistKey}.json`);
        fs.writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
        logDebug(`Parsed data written to ${outPath}`);

        const kafkaTopic = process.env.KAFKA_TOPIC || 'webull_watchlist';
        const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');
        for (const data of dataObjects) {
            if (!data.normalized_key) {
                const keyCandidate = data.key || data.symbol || data.col0 || data.col1 || data.col2;
                if (keyCandidate) data.normalized_key = normalizedKey(keyCandidate);
            }
            publishToKafka(data, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
        }
    } catch (err) {
        logDebug('Error in scrapeWebullWatchlists: ' + err);
        if (err.stack) console.error('Occurred at:', err.stack.split('\n')[1].trim());

        try {
            if (page) {
                const base = path.join(outputDir, `${dateTimeString}.webull_login_failure`);
                await savePageSnapshot(page, base);
                logDebug('Wrote diagnostic snapshot to ' + base + '.*');
            }
        } catch (snapErr) {
            logDebug('Failed to write diagnostic snapshot: ' + snapErr.message);
        }
        
        // Re-throw protocol timeout errors so the main daemon can trigger browser restart
        if (isProtocolTimeoutError(err)) {
            throw err;
        }
    }
}

module.exports = { scrapeWebullWatchlists };
