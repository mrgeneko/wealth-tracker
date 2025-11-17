const { sanitizeForFilename, getDateTimeString, logDebug } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');

async function scrapeInvestingComWatchlists(browser, watchlist, outputDir) {
	const investingUrl = watchlist.url;
	if (!investingUrl) {
		logDebug('WARNING: INVESTING_URL is missing or invalid');
		throw new Error('INVESTING_URL is not set in .env');
	}
	const investingEmail = process.env.INVESTING_EMAIL;
	const investingPassword = process.env.INVESTING_PASSWORD;
	try {
		logDebug('Using provided browser for investing.com...');
		logDebug(`outputDir: ${outputDir}`);
		logDebug('Looking for existing tab with target URL...');
		let page = null;
		const pages = await browser.pages();
		for (const p of pages) {
			const url = p.url();
			logDebug('Tab URL: ' + url);
			if (url && url.startsWith(investingUrl.split('?')[0])) {
				page = p;
				logDebug('Found existing tab with target URL.');
				break;
			}
		}
		if (!page) {
			logDebug('No existing tab found. Opening new page...');
			page = await browser.newPage();
			page.on('pageerror', (err) => {
				logDebug(`[BROWSER PAGE ERROR] ${err && err.stack ? err.stack : err}`);
			});
			page.on('error', (err) => {
				logDebug(`[BROWSER ERROR] ${err && err.stack ? err.stack : err}`);
			});
			logDebug('Setting user agent and viewport, navigating to Investing.com...');
			await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
			await page.setViewport({ width: 1280, height: 900 });
			logDebug('Navigating to: ' + investingUrl);
			await page.goto(investingUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
			logDebug('Navigation complete.');
		} else {
			await page.bringToFront();
			logDebug('Brought existing tab to front, skipping reload.');
		}

		await page.bringToFront();
		logDebug('Page brought to front.');
		logDebug('Setting download behavior...');
		const client = await page.target().createCDPSession();
		await client.send('Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: outputDir
		});
		logDebug('Download behavior set.');
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
		const htmlOutPath = `/usr/src/app/logs/investingcom_watchlist.${safeWatchlistKey}.${getDateTimeString()}.html`;
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
				if (Object.keys(rowData).length === requiredColumns.length) {
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
					logDebug(`Row ${i} missing columns: ${requiredColumns.filter(c => !(c in rowData)).join(', ')}`);
				}
			});
			logDebug(`Total valid stock rows found: ${dataObjects.length}`);
		}
		const outPath = require('path').join(outputDir, `investingcom_watchlist.${safeWatchlistKey}.${getDateTimeString()}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(securities, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);
		const kafkaTopic = process.env.KAFKA_TOPIC || 'investingcom_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of securities) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}
	} catch (err) {
		logDebug('Error in scrapeInvestingComWatchlist: ' + err);
		if (err.stack) {
			const stackLine = err.stack.split('\n')[1];
			console.error('Occurred at:', stackLine.trim());
		}
	}
}

module.exports = { scrapeInvestingComWatchlists };
