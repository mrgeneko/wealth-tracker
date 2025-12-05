const fs = require('fs');
const path = require('path');
const { sanitizeForFilename, getDateTimeString, getTimestampedLogPath, logDebug, parseToIso } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');

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
            // Get all index-rank containers - first is regular hours, second (if present) is after-hours
            const indexRanks = document.querySelectorAll('.index-rank');
            
            let regular_price = '';
            let regular_change_decimal = '';
            let regular_change_percent = '';
            let regular_time = '';
            let after_hours_price = '';
            let after_hours_change_decimal = '';
            let after_hours_change_percent = '';
            let after_hours_time = '';

            // Helper function to parse change text like "0.00 (0.00%)" or "+13.27 (+2.25%)"
            function parseChangeText(text) {
                const match = text.match(/([+-]?[\d,]+\.?\d*)\s*\(\s*([+-]?[\d,]+\.?\d*%)\s*\)/);
                if (match) {
                    return {
                        decimal: match[1].replace(/[,\s]/g, '').replace(/^\+/, ''),
                        percent: match[2].replace(/\s/g, '')
                    };
                }
                return { decimal: '', percent: '' };
            }

            // Helper function to extract data from an index-rank container
            function extractFromContainer(container) {
                const priceEl = container.querySelector('.index-rank-value');
                const changeEl = container.querySelector('.index-change');
                const infoEl = container.querySelector('.index-info');
                
                let price = '';
                let change_decimal = '';
                let change_percent = '';
                let time = '';
                let isAfterHours = false;

                if (priceEl) {
                    price = priceEl.innerText.trim().replace(/[,\s]/g, '');
                }

                if (infoEl) {
                    const infoText = infoEl.innerText.trim();
                    // Check if this is after-hours data
                    if (infoText.toLowerCase().includes('after-hours')) {
                        isAfterHours = true;
                        // Extract time from "After-Hours: 16:44"
                        const timeMatch = infoText.match(/after-hours:\s*(\d{1,2}:\d{2})/i);
                        if (timeMatch) {
                            time = timeMatch[1];
                        }
                    } else {
                        // Regular hours format: "USD | NASDAQ | Nov 24, 12:09"
                        const parts = infoText.split('|');
                        if (parts.length > 0) {
                            time = parts[parts.length - 1].trim();
                        }
                    }
                }

                if (changeEl) {
                    // Try to find specific value elements first (handling positive and negative classes)
                    const valEls = changeEl.querySelectorAll('.valPos, .valNeg');
                    if (valEls.length >= 2) {
                        change_decimal = valEls[0].innerText.trim().replace(/[,\s]/g, '').replace(/^\+/, '');
                        change_percent = valEls[1].innerText.trim().replace(/\s/g, '');
                    } else {
                        // Fallback: Parse the full text content
                        const text = changeEl.innerText.trim();
                        const parsed = parseChangeText(text);
                        change_decimal = parsed.decimal;
                        change_percent = parsed.percent;
                    }
                }

                return { price, change_decimal, change_percent, time, isAfterHours };
            }

            // Process each index-rank container
            indexRanks.forEach((container) => {
                const data = extractFromContainer(container);
                if (data.isAfterHours) {
                    after_hours_price = data.price;
                    after_hours_change_decimal = data.change_decimal;
                    after_hours_change_percent = data.change_percent;
                    after_hours_time = data.time;
                } else if (!regular_price) {
                    // Only set regular data if not already set (take the first non-after-hours container)
                    regular_price = data.price;
                    regular_change_decimal = data.change_decimal;
                    regular_change_percent = data.change_percent;
                    regular_time = data.time;
                }
            });

            return {
                key: ticker,
                regular_price: regular_price || '',
                regular_time: regular_time || '',
                regular_change_decimal: regular_change_decimal || '',
                regular_change_percent: regular_change_percent || '',
                previous_close_price: '', // Not currently extracted
                pre_market_price: '',
                pre_market_price_change_decimal: '',
                pre_market_price_change_percent: '',
                pre_market_time: '',
                after_hours_price: after_hours_price || '',
                after_hours_change_decimal: after_hours_change_decimal || '',
                after_hours_change_percent: after_hours_change_percent || '',
                after_hours_time: after_hours_time || '',
            };
        }, ticker);

        const data = {
            ...extractedData,
            regular_time: parseToIso(extractedData.regular_time),
            after_hours_time: parseToIso(extractedData.after_hours_time),
            capture_time: new Date().toISOString()
        };

        logDebug(`${logPrefix} Extracted data: ${JSON.stringify(data)}`);

        // Publish the data object to Kafka
        try {
            const kafkaTopic = process.env.KAFKA_TOPIC || 'price_data';
            const kafkaBrokers = (process.env.KAFKA_BROKERS || 'kafka:9092').split(',');
            await publishToKafka(data, kafkaTopic, kafkaBrokers);
            logDebug(`${logPrefix} Published YCharts data to Kafka topic ${kafkaTopic}`);
        } catch (kafkaErr) {
            logDebug(`${logPrefix} Kafka publish error: ${kafkaErr}`);
        }

        // Save HTML
        const htmlContent = await page.content();
        const timestamp = getDateTimeString();
        const safeTicker = sanitizeForFilename(ticker);
        const htmlFilename = `${timestamp}.${safeTicker}.ycharts.html`;
        const htmlPath = path.join(outputDir, htmlFilename);
        fs.writeFileSync(htmlPath, htmlContent);
        logDebug(`${logPrefix} Saved HTML to ${htmlPath}`);

        // Save PNG screenshot
        const pngFilename = `${timestamp}.${safeTicker}.ycharts.png`;
        const pngPath = path.join(outputDir, pngFilename);
        try {
            await page.screenshot({ path: pngPath, fullPage: true });
            logDebug(`${logPrefix} Saved PNG screenshot to ${pngPath}`);
        } catch (e) {
            logDebug(`${logPrefix} Failed to save PNG screenshot: ${e.message}`);
        }

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
