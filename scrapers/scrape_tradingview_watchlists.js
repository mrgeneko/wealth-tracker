const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');
const { DateTime } = require('luxon');

// Helper to check if error is from a known ad/tracker domain
function isSuppressedPageError(err) {
	if (!err || !err.stack) return false;
	const suppressedPatterns = [
		'pagead2.googlesyndication.com',
		'doubleclick.net',
		'securepubads.g.doubleclick.net',
		'creativedot2.net',
		'media.net',
		'googletagservices.com',
		'googletagmanager.com',
		'adservice.google.com',
		'adservice.google.',
		'adservice.',
		'ads.',
		'adserver.'
	];
	return suppressedPatterns.some(pattern => err.stack.includes(pattern));
}

function cleanNumber(str) {
    if (!str) return null;
    // Remove commas, non-breaking spaces, and handle different minus signs
    // The HTML might contain LTR marks or other invisible characters
    const cleaned = str.replace(/,/g, '')
                       .replace(/[−]/g, '-') // specific unicode minus
                       .replace(/[^\d.-]/g, ''); // remove anything that isn't a digit, dot, or minus
    const val = parseFloat(cleaned);
    return isNaN(val) ? null : val;
}

async function scrapeTradingViewWatchlists(browser, watchlist, outputDir) {
	const tvUrl = watchlist.url;
	if (!tvUrl) {
		logDebug('WARNING: TRADINGVIEW_URL is missing or invalid');
		throw new Error('TRADINGVIEW_URL is not set in .env');
	}
	const tvEmail = process.env.TRADINGVIEW_EMAIL;
	const tvPassword = process.env.TRADINGVIEW_PASSWORD;
	const dateTimeString = getDateTimeString();
	const safeWatchlistKey = sanitizeForFilename(watchlist.key);
	let page;

	try {
        logDebug('scrapeTradingViewWatchlists [UPDATED] started');
		logDebug('Using createPreparedPage (reuse tradingview tab if present)');
		page = await createPreparedPage(browser, {
			reuseIfUrlMatches: /tradingview\.com/,
			url: tvUrl,
			downloadPath: outputDir,
			waitUntil: 'domcontentloaded',
			timeout: 15000,
			attachCounters: true,
			gotoRetries: 3,
			reloadExisting: false
		});

		const snapshotBase = require('path').join(outputDir, `${dateTimeString}.tradingview_watchlist.${safeWatchlistKey}`);
		await savePageSnapshot(page, snapshotBase);
		logDebug(`Saved initial snapshot to ${snapshotBase}`);

        // Bypass CSP to prevent EvalErrors from TradingView/Recaptcha scripts
        try {
            await page.setBypassCSP(true);
            logDebug('Enabled CSP bypass');
        } catch (e) {
            logDebug('Failed to enable CSP bypass: ' + e.message);
        }

		// Ensure we have standard page error handlers
		try {
			page.on('pageerror', (err) => {
				if (!isSuppressedPageError(err)) {
					logDebug(`[BROWSER PAGE ERROR] ${err && err.stack ? err.stack : err}`);
				}
			});
			page.on('error', (err) => {
				logDebug(`[BROWSER ERROR] ${err && err.stack ? err.stack : err}`);
			});
		} catch (e) { /* ignore if page closed or events not supported */ }

		await page.bringToFront();

		// Login logic
		let needsLogin = false;
		try {
			logDebug('Checking for login button...');

            // Check for and close popups
            try {
                const closeBtn = await page.$('.tv-dialog__close, .js-dialog__close, [data-name="close"]');
                if (closeBtn) {
                    logDebug('Popup detected. Closing...');
                    await closeBtn.click();
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (popupErr) {
                logDebug('Error checking/closing popup: ' + popupErr.message);
            }

            const is404 = await page.evaluate(() => !!document.evaluate("//a[contains(., 'Head to homepage')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue);

            if (is404) {
                logDebug('404 Page detected. Navigating to homepage to login...');
                await Promise.all([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
                    page.evaluate(() => document.evaluate("//a[contains(., 'Head to homepage')]", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click())
                ]);
                await page.setBypassCSP(true);
                
                const userMenu = await page.waitForSelector('button[data-name="header-user-menu-button"]');
                await userMenu.click();
                await new Promise(r => setTimeout(r, 1000));

                const signInButton = await page.waitForSelector('button[data-name="header-user-menu-sign-in"]');
                await signInButton.click();
                needsLogin = true;
            } else {
                 const userButton = await page.$('button[data-name="header-user-menu-button"]');
                 if(userButton){
                    const isAnonymous = await page.evaluate(el => el.classList.contains('tv-header__user-menu-button--anonymous'), userButton);
                    if(isAnonymous){
                        logDebug('Anonymous user button found, attempting login...');
                        await userButton.click();
                        await new Promise(r => setTimeout(r, 1000));
                        const signInButton = await page.waitForSelector('button[data-name="header-user-menu-sign-in"]');
                        await signInButton.click();
                        needsLogin = true;
                    }
                 }
            }
		} catch (e) {
			logDebug('Error checking for login state: ' + e.message);
		}

		if (needsLogin) {
            logDebug('Login required. Attempting to log in...');
            try {
                await new Promise(r => setTimeout(r, 1000));
                const emailButton = await page.waitForSelector('button span.label-vyj6fJ_4:contains("Email")', { timeout: 5000 });
                await emailButton.click();

                await page.type('input[name="username"]', tvEmail, { delay: 50 });
                await page.type('input[name="password"]', tvPassword, { delay: 50 });
                
                await page.click('button[type="submit"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                
                logDebug(`Login successful. Navigating back to watchlist URL: ${tvUrl}`);
                await page.goto(tvUrl, { waitUntil: 'domcontentloaded' });
            } catch (loginErr) {
                logDebug('Login failed: ' + loginErr.message);
				throw loginErr;
            }
		}

		logDebug('Waiting for watchlist table to load...');
		await page.waitForSelector('.listItem-gfVnbvfd', { timeout: 10000 });
		logDebug('Watchlist table loaded.');

        await page.evaluate(async () => {
            const el = document.querySelector('.listContainer-I0S22tFp');
            if(el) for (let i = 0; i < el.scrollHeight; i += 100) await new Promise(r => setTimeout(() => { el.scrollTo(0, i); r(); }, 100));
        });

		const fullPageHtml = await page.content();
		const cheerio = require('cheerio');
		const $ = cheerio.load(fullPageHtml);
		const dataObjects = [];
        const rows = $('.listItem-gfVnbvfd');

		rows.each((i, row) => {
            const symbolEl = $(row).find('.symbolWrap-nNqEjNlw .symbol-nNqEjNlw');
            if (!symbolEl.length) return;

            const symbol = symbolEl.text().trim();
            const cells = $(row).find('.cell-l4PFpEb8');
            if (cells.length < 3) return;
            
            const lastPriceStr = $(cells[0]).find('.value-dCK2c9ft').text().trim();
            const chgPctStr = $(cells[1]).find('.value-dCK2c9ft').text().trim();
            const chgStr = $(cells[2]).find('.value-dCK2c9ft').text().trim();

            const lastPrice = cleanNumber(lastPriceStr);
            const chg = cleanNumber(chgStr);

            if (lastPrice !== null) {
                let prevClose = (chg !== null) ? Math.round((lastPrice - chg) * 100) / 100 : null;
                dataObjects.push({
                    key: symbol,
                    last_price: lastPrice,
                    price_change_decimal: chgStr,
                    price_change_percent: chgPctStr,
                    source: "tradingview",
                    previous_close_price: prevClose,
                    capture_time: new Date().toISOString(),
                    quote_time: new Date().toISOString()
                });
            }
        });
		logDebug(`Total valid stock rows found: ${dataObjects.length}`);

		const outPath = require('path').join(outputDir, `${dateTimeString}.tradingview_watchlist.${safeWatchlistKey}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);

		const kafkaTopic = process.env.KAFKA_TOPIC || 'tradingview_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of dataObjects) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}

	} catch (err) {
		logDebug('Error in scrapeTradingViewWatchlists: ' + err);
		if (err.stack) console.error('Occurred at:', err.stack.split('\n')[1].trim());

		try {
			if (page) {
				const base = require('path').join(outputDir, `${dateTimeString}.tradingview_failure`);
				await savePageSnapshot(page, base);
				logDebug('Wrote diagnostic snapshot to ' + base + '.*');
			}
		} catch (snapErr) {
			logDebug('Failed to write diagnostic snapshot: ' + snapErr.message);
		}
	}
}

module.exports = { scrapeTradingViewWatchlists };
