const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');

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

async function scrapeInvestingComWatchlists(browser, watchlist, outputDir) {
	const investingUrl = watchlist.url;
	if (!investingUrl) {
		logDebug('WARNING: INVESTING_URL is missing or invalid');
		throw new Error('INVESTING_URL is not set in .env');
	}
	const investingEmail = process.env.INVESTING_EMAIL;
	const investingPassword = process.env.INVESTING_PASSWORD;
	try {
		logDebug('Using createPreparedPage (reuse investing tab if present)');
		logDebug(`outputDir: ${outputDir}`);
		const page = await createPreparedPage(browser, {
			reuseIfUrlMatches: /investing\.com/,
			url: investingUrl,
			downloadPath: outputDir,
			waitUntil: 'domcontentloaded',
			timeout: 15000,
			attachCounters: true,
			gotoRetries: 3,
			// do not force a reload of an existing tab by default; keep existing session
			reloadExisting: false
		});
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
		try { await page.bringToFront(); } catch (e) { /* ignore */ }
		let needsLogin = false;
		try {
			logDebug('Checking for login form...');
			await page.waitForSelector('#loginFormUser_email', { timeout: 5000 });
			needsLogin = true;
			logDebug('Login form detected.');
		} catch (e) {
			logDebug('No login form detected, likely already logged in.');
		}
		if (needsLogin) {
			logDebug('Typing email and password...');
			await page.type('#loginFormUser_email', investingEmail, { delay: 50 });
			await page.type('#loginForm_password', investingPassword, { delay: 50 });
			logDebug('Sending Enter key to submit login form...');
			await page.keyboard.press('Enter');
			logDebug('Waiting for My Watchlist heading or Summary tab after login...');
			try {
				await Promise.race([
					page.waitForSelector('h1', { timeout: 10000 }).then(async h1 => {
						const text = await page.evaluate(el => el.textContent, h1);
						if (!text.includes('My Watchlist')) throw new Error('h1 does not contain My Watchlist');
					}),
					page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
				]);
				logDebug('Login form submitted, My Watchlist heading or Summary tab found.');
			} catch (e) {
				logDebug('Login post-submit wait failed: ' + e.message);
				throw e;
			}
		}
		logDebug('Waiting for My Watchlist heading or Summary tab...');
		try {
			await Promise.race([
				page.waitForSelector('h1', { timeout: 10000 }).then(async h1 => {
					const text = await page.evaluate(el => el.textContent, h1);
					if (!text.includes('My Watchlist')) throw new Error('h1 does not contain My Watchlist');
				}),
				page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
			]);
			logDebug('FOUND My Watchlist heading or Summary tab...');
		} catch (e) {
			logDebug('Wait for My Watchlist heading/Summary tab failed: ' + e.message);
			throw e;
		}
		try {
			const tabSelector = `li[title="${watchlist.key}"]`;
			await page.waitForSelector(tabSelector, { visible: true, timeout: 5000 });
			await page.click(tabSelector);
			logDebug(`Clicked the tab with title="${watchlist.key}".`);
			await new Promise(resolve => setTimeout(resolve, 4000));
		} catch (e) {
			logDebug(`Tab with title="${watchlist.key}" not found or not clickable: ` + e.message);
		}
		logDebug('Waiting for watchlist table to load...');
		try {
			await page.waitForSelector('[id^="tbody_overview_"]', { timeout: 7000 });
			logDebug('Watchlist table loaded. Extracting HTML...');
		} catch (e) {
			logDebug('Watchlist table did not load: ' + e.message);
			throw e;
		}
		const tableHtml = await page.$eval('[id^="tbody_overview_"]', el => el.outerHTML);
		const safeWatchlistKey = sanitizeForFilename(watchlist.key);
		const htmlOutPath = `/usr/src/app/logs/${getDateTimeString()}.investingcom_watchlist.${safeWatchlistKey}.html`;
		const fullPageHtml = await page.content();
		require('fs').writeFileSync(htmlOutPath, fullPageHtml, 'utf-8');
		logDebug('Parsing full page HTML for stock table...');
		const cheerio = require('cheerio');
		const $ = cheerio.load(fullPageHtml);
		const requiredColumns = [
			"symbol", "exchange", "last", "bid", "ask", "extended_hours", "extended_hours_percent",
			"open", "prev", "high", "low", "chg", "chgpercent", "vol", "next_earning", "time"
		];
		const table = $('[id^="tbody_overview_"]').first();
		logDebug('Table found: ' + (table.length > 0));
		const securities = [];
		const dataObjects = [];
		if (table.length === 0) {
			logDebug("No table found in the HTML.");
		} else {
			table.find('tr').each((i, row) => {
				const rowData = {};
				$(row).find('td').each((j, col) => {
					const columnName = $(col).attr('data-column-name');
					if (requiredColumns.includes(columnName)) {
						rowData[columnName] = $(col).text().trim();
					}
				});
				// Check if we have at least some critical columns, not necessarily all
				// Some rows might be missing extended_hours or next_earning
				if (rowData["symbol"] && rowData["last"]) {
					securities.push(rowData);
					const data = {
						key: rowData["symbol"],
						last_price: rowData["last"],
						source: "investing",
						previous_close_price: rowData["prev"],
						capture_time: new Date().toISOString().replace("T", " ").replace("Z", " UTC"),
						quote_time: rowData["time"]
					};
					dataObjects.push(data);
					logDebug(`Data object for row ${i}: ${JSON.stringify(data)}`);
				} else {
					logDebug(`Row ${i} missing critical columns (symbol/last): ${JSON.stringify(rowData)}`);
				}
			});
			logDebug(`Total valid stock rows found: ${dataObjects.length}`);
		}
		const outPath = require('path').join(outputDir, `${getDateTimeString()}.investingcom_watchlist.${safeWatchlistKey}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);
		const kafkaTopic = process.env.KAFKA_TOPIC || 'investingcom_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of dataObjects) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}
	} catch (err) {
		logDebug('Error in scrapeInvestingComWatchlist: ' + err);
		if (err.stack) {
			const stackLine = err.stack.split('\n')[1];
			console.error('Occurred at:', stackLine.trim());
		}
		// Attempt to save a diagnostic snapshot for later analysis
		try {
			if (typeof savePageSnapshot === 'function' && typeof page !== 'undefined' && page) {
				const base = `/usr/src/app/logs/${getDateTimeString()}.investingcom_login_failure`;
				await savePageSnapshot(page, base);
				logDebug('Wrote diagnostic snapshot to ' + base + '.*');
			}
		} catch (snapErr) {
			logDebug('Failed to write diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
		}
	}
}

module.exports = { scrapeInvestingComWatchlists };
