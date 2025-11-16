// Load environment variables from .env if present (for local dev)
require('dotenv').config();
console.log('VERSION:18');
const puppeteer = require('puppeteer');
const fs = require('fs');
function getDateTimeString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function getTimestampedLogPath() {
    return `/usr/src/app/logs/investing_watchlist.${getDateTimeString()}.log`;
}

const debugLogPath = getTimestampedLogPath();
function logDebug(msg) {
	const line = `[${new Date().toISOString()}] ${msg}\n`;
	fs.appendFileSync(debugLogPath, line);
}
const path = require('path');
// Add puppeteer-extra and stealth plugin
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());

const { publishToKafka } = require('./publish_to_kafka');

const http = require('http');


async function scrapeInvestingComMonitor(outputDir) {
	const investingUrl = process.env.INVESTING_URL;
	if (!investingUrl) {
		logDebug('WARNING: INVESTING_URL is not set in .env. Please set your portfolio URL.');
		throw new Error('INVESTING_URL is not set in .env');
	}
	const investingEmail = process.env.INVESTING_EMAIL;
	const investingPassword = process.env.INVESTING_PASSWORD;
	let browser = null;
	try {
		logDebug('Launching or connecting to browser for Investing.com...');
		logDebug(`outputDir: ${outputDir}`);
		// Use a persistent user-data-dir for extension reliability
		const persistentProfileDir = '/tmp/chrome-profile2';
		// Try to connect to an existing Chrome instance first
		let connected = false;
		let connectError = null;
		let launchError = null;
		try {
			logDebug('Trying to connect to existing Chrome instance...');
			const wsEndpoint = await new Promise((resolve, reject) => {
				const http = require('http');
				http.get('http://localhost:9222/json/version', res => {
					let data = '';
					res.on('data', chunk => data += chunk);
					res.on('end', () => {
						try {
							const json = JSON.parse(data);
							resolve(json.webSocketDebuggerUrl);
						} catch (e) {
							reject(e);
						}
					});
				}).on('error', reject);
			});
			browser = await puppeteerExtra.connect({ browserWSEndpoint: wsEndpoint });
			connected = true;
			logDebug('Connected to existing Chrome instance.');
		} catch (err) {
			connectError = err;
			logDebug('[CONNECT ERROR] No running Chrome instance found or failed to connect: ' + err.message);
		}
		if (!connected) {
			try {
				logDebug('Launching new Chrome instance...');
				browser = await puppeteerExtra.launch({
					headless: false,
					executablePath: '/opt/google/chrome/chrome',
					args: [
						// '--load-extension=' + extensionPath, // SingleFile extension temporarily disabled
						// '--disable-extensions-except=' + extensionPath, // SingleFile extension temporarily disabled
						'--no-sandbox',
						'--disable-gpu',
						'--disable-dev-shm-usage',
						'--disable-setuid-sandbox',
						'--display=:99',
						`--user-data-dir=${persistentProfileDir}`,
						'--no-first-run',
						'--no-default-browser-check',
						'--disable-default-apps',
						'--remote-debugging-port=9222',
						'--disable-features=AudioServiceOutOfProcess',
						'--disable-component-update',
						'--disable-background-networking',
						'--disable-domain-reliability'
					],
					env: {
						...process.env,
						DISPLAY: ':99',
						CHROME_DISABLE_UPDATE: '1'
					}
				});
				logDebug('Launched new Chrome instance.');
			} catch (err) {
				launchError = err;
				logDebug('[LAUNCH ERROR] Failed to launch new Chrome instance: ' + err.message);
			}
		}
		if (!browser) {
			logDebug('[FATAL] Could not connect to or launch Chrome.');
			if (connectError) logDebug('[CONNECT ERROR DETAILS] ' + connectError.stack);
			if (launchError) logDebug('[LAUNCH ERROR DETAILS] ' + launchError.stack);
			throw new Error('Could not connect to or launch Chrome.');
		}


		// Find an existing tab with the target URL, or open a new one if not found
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
			// Log browser page errors for debugging
			page.on('pageerror', (err) => {
				logDebug(`[BROWSER PAGE ERROR] ${err && err.stack ? err.stack : err}`);
			});
			page.on('error', (err) => {
				logDebug(`[BROWSER ERROR] ${err && err.stack ? err.stack : err}`);
			});
			// Set a realistic user agent
			logDebug('Setting user agent and viewport, navigating to Investing.com...');
			await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
			await page.setViewport({ width: 1280, height: 900 });
			logDebug('Navigating to: ' + investingUrl);
			await page.goto(investingUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
			logDebug('Navigation complete.');
		} else {
			// Only bring to front, do not reload if already at the correct URL
			await page.bringToFront();
			logDebug('Brought existing tab to front, skipping reload.');
		}

		// Close all other tabs except the Investing.com tab
		const allPages = await browser.pages();
		for (const p of allPages) {
			if (p !== page) {
				try { await p.close(); } catch (e) {}
			}
		}
		// Bring the Investing.com tab to the front
		await page.bringToFront();
		logDebug('Page brought to front.');

		// Set download behavior
		logDebug('Setting download behavior...');
		const client = await page.target().createCDPSession();
		await client.send('Page.setDownloadBehavior', {
			behavior: 'allow',
			downloadPath: outputDir
		});
		logDebug('Download behavior set.');

		// Check for login form
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
			// Wait for either the heading or the Summary tab link
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

		// Wait for 'My Watchlist' or Summary tab to be visible
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


		// Wait for the watchlist table to load
		logDebug('Waiting for watchlist table to load...');
		try {
			await page.waitForSelector('[id^="tbody_overview_"]', { timeout: 7000 });
			logDebug('Watchlist table loaded. Extracting HTML...');
		} catch (e) {
			logDebug('Watchlist table did not load: ' + e.message);
			throw e;
		}
		const tableHtml = await page.$eval('[id^="tbody_overview_"]', el => el.outerHTML);

		// Write tableHtml to a separate file in wealth_tracker_logs
		const htmlOutPath = `/usr/src/app/logs/investing_watchlist.${getDateTimeString()}.html`;
		const fullPageHtml = await page.content();
		require('fs').writeFileSync(htmlOutPath, fullPageHtml, 'utf-8');

		// --- DEBUG LOGGING AND FULL PAGE PARSE FOR STOCK DATA ---
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
						// logDebug(`Row ${i} Col ${columnName}: ${rowData[columnName]}`);
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

		// Write the parsed data to a JSON file in the outputDir
		// logDebug(`securities contents: ${JSON.stringify(securities, null, 2)}`);
		const outPath = require('path').join(outputDir, `investing_watchlist.${getDateTimeString()}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(securities, null, 2), 'utf-8');

		logDebug(`Parsed data written to ${outPath}`);

		// Publish each security to Kafka
		const kafkaTopic = process.env.KAFKA_TOPIC || 'investing_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of securities) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}

		// Close the browser to release resources
		//await browser.close();
		//logDebug('Done. Browser closed.');
	} catch (err) {
		logDebug('Error in scrapeInvestingComMonitor: ' + err);
	}
}

// Usage
const outputDir = process.argv[3] || '/usr/src/app/logs';

// To use the new Investing.com monitor function, uncomment:
scrapeInvestingComMonitor(outputDir);
