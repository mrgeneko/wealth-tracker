const fs = require('fs');
const path = require('path');
const { sanitizeForFilename, getDateTimeString, getTimestampedLogPath, logDebug, parseToIso } = require('./scraper_utils');

async function scrapeYCharts(browser, security, outputDir) {
    const url = security.ycharts;
    const ticker = security.key || security.ticker;
    const logPrefix = `[YCharts ${ticker}]`;

    logDebug(`${logPrefix} Starting scrape for ${url}`);

    let page = null;
    try {
        page = await browser.newPage();
        // Set a realistic user agent and viewport
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // Navigate to the page
        // Use domcontentloaded as networkidle2 often times out due to ads/popups/trackers
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Attempt to remove the registration modal/backdrop if present so it doesn't obscure screenshots
        try {
            await page.evaluate(() => {
                const selectors = [
                    '.modal-backdrop',
                    '.modal',
                    'div[class*="modal"]',
                    'div[class*="Overlay"]'
                ];
                selectors.forEach(sel => {
                    document.querySelectorAll(sel).forEach(el => {
                        // Only hide if it looks like an overlay covering the screen
                        if (el.offsetHeight > 500 || window.getComputedStyle(el).position === 'fixed') {
                            el.style.display = 'none';
                        }
                    });
                });
            });
        } catch (e) {
            // Ignore errors removing modals
        }

        // Wait for the price element to appear
        const priceSelector = '.index-rank-value';
        await page.waitForSelector(priceSelector, { timeout: 30000 });

        // Extract data
        const extractedData = await page.evaluate((ticker) => {
            const priceEl = document.querySelector('.index-rank-value');
            const changeContainer = document.querySelector('.index-change');
            const infoEl = document.querySelector('.index-info');

            let regular_last_price = '';
            let regular_change_decimal = '';
            let regular_change_percent = '';
            let regular_time = '';

            if (priceEl) {
                regular_last_price = priceEl.innerText.trim().replace(/[,\s]/g, '');
            }

            if (infoEl) {
                // Format: "USD | NASDAQ | Nov 24, 12:09"
                const parts = infoEl.innerText.split('|');
                if (parts.length > 0) {
                    regular_time = parts[parts.length - 1].trim();
                }
            }

            if (changeContainer) {
                // Try to find specific value elements first (handling positive and negative classes)
                const valEls = changeContainer.querySelectorAll('.valPos, .valNeg');
                if (valEls.length >= 2) {
                    regular_change_decimal = valEls[0].innerText.trim().replace(/[,\s]/g, '').replace(/^\+/, '');
                    regular_change_percent = valEls[1].innerText.trim().replace(/\s/g, '');
                } else {
                    // Fallback: Parse the full text content
                    // Expected format: "+13.27 (+2.25%)" or "-1.23 (-0.50%)"
                    const text = changeContainer.innerText.trim();
                    // Matches: start, optional sign, digits, dot, digits, space, (, optional sign, digits, dot, digits, %, )
                    const match = text.match(/([+-]?[\d,]+\.?\d*)\s*\(\s*([+-]?[\d,]+\.?\d*%)\s*\)/);
                    if (match) {
                        regular_change_decimal = match[1].replace(/[,\s]/g, '').replace(/^\+/, '');
                        regular_change_percent = match[2].replace(/\s/g, '');
                    }
                }
            }

            return {
                key: ticker,
                regular_last_price: regular_last_price || '',
                regular_time: regular_time || '',
                regular_change_decimal: regular_change_decimal || '',
                regular_change_percent: regular_change_percent || '',
                previous_close_price: '', // Not currently extracted
                pre_market_price: '',
                pre_market_price_change_decimal: '',
                pre_market_price_change_percent: '',
                pre_market_time: '',
                after_hours_price: '',
                after_hours_change_percent: '',
            };
        }, ticker);

        const data = {
            ...extractedData,
            regular_time: parseToIso(extractedData.regular_time),
            capture_time: new Date().toISOString()
        };

        logDebug(`${logPrefix} Extracted data: ${JSON.stringify(data)}`);

        // Save HTML
        const htmlContent = await page.content();
        const timestamp = getDateTimeString();
        const safeTicker = sanitizeForFilename(ticker);
        const htmlFilename = `${timestamp}.${safeTicker}.ycharts.html`;
        const htmlPath = path.join(outputDir, htmlFilename);
        fs.writeFileSync(htmlPath, htmlContent);
        logDebug(`${logPrefix} Saved HTML to ${htmlPath}`);

        // Save JSON
        const jsonFilename = `${timestamp}.${safeTicker}.ycharts.json`;
        const jsonPath = path.join(outputDir, jsonFilename);
        fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
        logDebug(`${logPrefix} Saved JSON to ${jsonPath}`);

        return data;

    } catch (error) {
        logDebug(`${logPrefix} Error scraping: ${error.message}`);
        // Take a screenshot on error for debugging
        if (page) {
            try {
                const timestamp = getDateTimeString();
                const safeTicker = sanitizeForFilename(ticker);
                const errorScreenshotPath = path.join(outputDir, `${timestamp}.${safeTicker}.ycharts.error.png`);
                await page.screenshot({ path: errorScreenshotPath });
                logDebug(`${logPrefix} Saved error screenshot to ${errorScreenshotPath}`);
            } catch (e) {
                logDebug(`${logPrefix} Failed to save error screenshot: ${e.message}`);
            }
        }
        return null;
    } finally {
        if (page) {
            await page.close();
        }
    }
}

module.exports = { scrapeYCharts };
