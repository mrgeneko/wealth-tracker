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

function parseToIso(timeStr) {
  if (!timeStr) return '';
  try {
    // Investing.com formats:
    // 1. "16:00:00" (time only, assume today)
    // 2. "21/11" (date only, assume current year)
    // 3. "21/11/2025" (full date)
    
    // Try time only (HH:mm:ss)
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(timeStr)) {
        const dt = DateTime.fromFormat(timeStr, "H:mm:ss", { zone: 'America/New_York', locale: 'en-US' });
        if (dt.isValid) return dt.toISO();
    }

    // Try date only (dd/MM)
    if (/^\d{1,2}\/\d{1,2}$/.test(timeStr)) {
        // Append current year
        const year = new Date().getFullYear();
        const dt = DateTime.fromFormat(`${timeStr}/${year}`, "d/M/yyyy", { zone: 'America/New_York', locale: 'en-US' });
        if (dt.isValid) return dt.toISO();
    }

    // Try full date (dd/MM/yyyy)
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(timeStr)) {
        const dt = DateTime.fromFormat(timeStr, "d/M/yyyy", { zone: 'America/New_York', locale: 'en-US' });
        if (dt.isValid) return dt.toISO();
    }

    return timeStr;
  } catch (e) {
    return timeStr;
  }
}

async function scrapeInvestingComWatchlists(browser, watchlist, outputDir) {
	const investingUrl = watchlist.url;
	if (!investingUrl) {
		logDebug('WARNING: INVESTING_URL is missing or invalid');
		throw new Error('INVESTING_URL is not set in .env');
	}
	const investingEmail = process.env.INVESTING_EMAIL;
	const investingPassword = process.env.INVESTING_PASSWORD;
	const dateTimeString = getDateTimeString();
	const safeWatchlistKey = sanitizeForFilename(watchlist.key);
	let page;

	try {
		logDebug('Using createPreparedPage (reuse investing tab if present)');
		page = await createPreparedPage(browser, {
			reuseIfUrlMatches: /investing\.com/,
			url: investingUrl,
			downloadPath: outputDir,
			waitUntil: 'domcontentloaded',
			timeout: 15000,
			attachCounters: true,
			gotoRetries: 3,
			reloadExisting: false
		});

		try {
			page.on('pageerror', (err) => {
				if (!isSuppressedPageError(err)) {
					logDebug(`[BROWSER PAGE ERROR] ${err && err.stack ? err.stack : err}`);
				}
			});
			page.on('error', (err) => {
				logDebug(`[BROWSER ERROR] ${err && err.stack ? err.stack : err}`);
			});
		} catch (e) { /* ignore */ }

		await page.bringToFront();

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
			await page.keyboard.press('Enter');
			logDebug('Waiting for My Watchlist heading or Summary tab after login...');
			await Promise.race([
				page.waitForSelector('h1::-p-text("My Watchlist")', { timeout: 10000 }),
				page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
			]);
			logDebug('Login successful.');
		}

		logDebug('Waiting for My Watchlist heading or Summary tab...');
		await Promise.race([
			page.waitForSelector('h1::-p-text("My Watchlist")', { timeout: 10000 }),
			page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: 10000 })
		]);
		logDebug('On watchlist page.');

		try {
			const tabSelector = `li[title="${watchlist.key}"]`;
			await page.waitForSelector(tabSelector, { visible: true, timeout: 5000 });
			await page.click(tabSelector);
			logDebug(`Clicked the tab with title="${watchlist.key}".`);
			await new Promise(resolve => setTimeout(resolve, 5000));
		} catch (e) {
			logDebug(`Tab with title="${watchlist.key}" not found or not clickable: ` + e.message);
		}

		logDebug('Waiting for watchlist table to load...');
		await page.waitForSelector('[id^="tbody_overview_"]', { timeout: 7000 });
		logDebug('Watchlist table loaded.');

		const snapshotBase = require('path').join(outputDir, `${dateTimeString}.investingcom_watchlist.${safeWatchlistKey}`);
		const fullPageHtml = await savePageSnapshot(page, snapshotBase);
		logDebug(`Saved snapshot to ${snapshotBase}`);

		const cheerio = require('cheerio');
		const $ = cheerio.load(fullPageHtml);
		const requiredColumns = ["symbol", "exchange", "last", "bid", "ask", "extended_hours", "extended_hours_percent", "open", "prev", "high", "low", "chg", "chgpercent", "vol", "next_earning", "time"];
		const table = $('[id^="tbody_overview_"]').first();
		const dataObjects = [];

		if (table.length) {
			table.find('tr').each((i, row) => {
				const rowData = {};
				$(row).find('td').each((j, col) => {
					const columnName = $(col).attr('data-column-name');
					if (requiredColumns.includes(columnName)) {
						rowData[columnName] = $(col).text().trim();
						if (columnName === 'time') rowData['time_value'] = $(col).attr('data-value');
					}
				});

				if (rowData["symbol"] && rowData["last"]) {
					let qTime = parseToIso(rowData["time"]);
					if (rowData["time_value"]) {
						const ts = parseInt(rowData["time_value"], 10);
						if (!isNaN(ts)) qTime = new Date(ts * 1000).toISOString();
					}

					let extendedHoursChange = null;
					const extHoursPrice = parseFloat(String(rowData["extended_hours"] || '').replace(/[$,]/g, ''));
					const prevClose = parseFloat(String(rowData["prev"] || '').replace(/[$,]/g, ''));
					if (!isNaN(extHoursPrice) && !isNaN(prevClose) && prevClose !== 0) {
						extendedHoursChange = (extHoursPrice - prevClose).toFixed(2);
					}

					dataObjects.push({
						key: rowData["symbol"],
						last_price: rowData["last"],
						price_change_decimal: rowData["chg"],
						price_change_percent: rowData["chgpercent"],
						extended_hours_price: rowData["extended_hours"] || null,
						extended_hours_change: extendedHoursChange,
						extended_hours_change_percent: rowData["extended_hours_percent"] || null,
						source: "investing",
						previous_close_price: rowData["prev"],
						capture_time: new Date().toISOString(),
						last_price_quote_time: qTime
					});
				}
			});
			logDebug(`Total valid stock rows found: ${dataObjects.length}`);
		} else {
			logDebug("No table found in the HTML.");
		}

		const outPath = require('path').join(outputDir, `${dateTimeString}.investingcom_watchlist.${safeWatchlistKey}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);

		const kafkaTopic = process.env.KAFKA_TOPIC || 'investingcom_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of dataObjects) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}
	} catch (err) {
		logDebug('Error in scrapeInvestingComWatchlist: ' + err);
		if (err.stack) console.error('Occurred at:', err.stack.split('\n')[1].trim());

		try {
			if (page) {
				const base = require('path').join(outputDir, `${dateTimeString}.investingcom_login_failure`);
				await savePageSnapshot(page, base);
				logDebug('Wrote diagnostic snapshot to ' + base + '.*');
			}
		} catch (snapErr) {
			logDebug('Failed to write diagnostic snapshot: ' + snapErr.message);
		}
	}
}

module.exports = { scrapeInvestingComWatchlists };
