// Scrape Google Finance stock page and extract price data
function sanitizeForFilename(str) {
	return String(str).replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function scrapeGoogle(browser, security, outputDir) {
	let page = null;
	let data = {};
	try {
		const url = security.google;
		const ticker = sanitizeForFilename(security.key);
		logDebug(`Security: ${ticker}   open Google Finance: ${url}`);
		page = await browser.newPage();
		await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
		await page.setViewport({ width: 1280, height: 900 });
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
		logDebug('Page loaded. Extracting HTML...');
		const html = await page.content();

		// Save the HTML to google.yyyymmdd_hhmmss.html using getDateTimeString
		const htmlFileName = `${ticker}.google.${getDateTimeString()}.html`;
		const htmlFilePath = require('path').join(outputDir, htmlFileName);
		require('fs').writeFileSync(htmlFilePath, html, 'utf-8');
		logDebug(`Saved Google HTML to ${htmlFilePath}`);
		
		const cheerio = require('cheerio');
		const $ = cheerio.load(html);
		// Extract main price
		let last_price = '';
		let price_change_decimal = '';
		let price_change_percent = '';
		let previous_close_price = '';
		let after_hours_price = '';
		let pre_market_price = '';
		let pre_market_price_change_decimal = '';
		let pre_market_price_change_percent = '';
	
		try {
			const main_element = $('[class="Gfxi4"]').first();
			const price_element = main_element.find('[class="YMlKec fxKbKc"]').first();
			if (price_element.length) {
				last_price = price_element.text().replace('$', '').replace(',', '');
			}
			// Previous close
			const prev_close_label = $('div').filter((i, el) => $(el).text().trim().toLowerCase() === 'previous close').first();
			if (prev_close_label.length) {
				const parent = prev_close_label.closest('div.gyFHrc');
				if (parent.length) {
					const price_div = parent.find('div.P6K39c').first();
					if (price_div.length) {
						previous_close_price = price_div.text().replace('$', '').replace(',', '').trim();
					}
				}
			}
			// Price change
			let change_element = main_element.find('[class="P2Luy Ez2Ioe ZYVHBb"], [class="P2Luy Ebnabc ZYVHBb"]').first();
			if (change_element.length) {
				const change_text = change_element.text();
				if (change_text.startsWith('+') || change_text.startsWith('-')) {
					const parts = change_text.split(' ');
					price_change_decimal = parts[0];
					// Percent is in a sibling span with class JwB6zf
					const percent_element = main_element.find('[class="JwB6zf"]').first();
					if (percent_element.length) {
						price_change_percent = (change_text[0] || '') + percent_element.text();
					}
				}
			}
			// After/pre-market
			const ext_hours_section = $('[jsname="QRHKC"]').first();
			if (ext_hours_section.length) {
				const ext_price = ext_hours_section.find('[class="YMlKec fxKbKc"]').first();
				if (ext_price.length) {
					if (ext_hours_section.text().startsWith('After Hours')) {
						after_hours_price = ext_price.text().replace('$', '').replace(',', '').trim();
					} else if (ext_hours_section.text().startsWith('Pre-market')) {
						pre_market_price = ext_price.text().replace('$', '').replace(',', '').trim();
						// Extract pre-market price change decimal
						// No longer restrict to ext_hours_section: search whole document for pre-market price change
						let preMarketChangeElem = $('span.P2Luy.Ebnabc.DnMTof');
						if (preMarketChangeElem.length) {
							logDebug('premarketchange text:' + preMarketChangeElem.text());
							const changeText = preMarketChangeElem.text().trim();
							// Expect format like "1.77%-3.36" or just "-3.36"
							const match = changeText.match(/^([+-]?[0-9,.]+%)?\s*([+-]?[0-9,.]+)$/);
							if (match) {
								let percent = match[1] ? match[1].replace(',', '') : '';
								let decimal = match[2].replace(',', '');

								// Try to find the arrow in the same parent node
								let arrowElem = preMarketChangeElem.parent().find('span.notranslate.V53LMb').first();
								logDebug('arrowElem.html:' + (arrowElem.length ? arrowElem.html() : 'null'));
								logDebug('length:' + arrowElem.length);

								let sign = '';
								let svgHtml = '';
								if (arrowElem.length) {
									svgHtml = arrowElem.html() || '';
									logDebug('premarket arrow SVG HTML: ' + svgHtml);
									if (svgHtml.includes('M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z')) {
										sign = '-'; // Down arrow
									} else if (svgHtml.includes('M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.58L20 12l-8-8-8 8z')) {
										sign = '+'; // Up arrow
									}
								}
								logDebug('premarket percent before sign logic: ' + percent);
								logDebug('premarket detected sign: ' + sign);
								// Only set the sign for percent
								if (percent) {
									percent = percent.replace(/^[-+]/, ''); // Remove any sign
									if (sign) percent = sign + percent;
									logDebug('premarket percent after sign logic: ' + percent);
									pre_market_price_change_percent = percent;
								}
								pre_market_price_change_decimal = decimal;
							}
						}
					}
				}
			}
			// Extract quote time (e.g., 'Nov 14, 8:00:00 PM GMT-5')
			let quote_time = '';
			// Look for a div/span with a date/time string in the format 'Nov 14, 8:00:00 PM GMT-5'
			// This is often found in a span with class "ygUjEc" or similar, but fallback to regex search
			const time_regex = /([A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2}\s*[AP]M\s*GMT[+-]\d+)/;
			const body_text = $('body').text();
			const match = body_text.match(time_regex);
			if (match) {
				quote_time = match[1];
			}
			// fallback: look for any span/div with GMT in text
			if (!quote_time) {
				$('[class], span, div').each((i, el) => {
					const t = $(el).text();
					if (/GMT[+-]\d+/.test(t) && /\d{1,2}:\d{2}:\d{2}/.test(t)) {
						quote_time = t.trim();
						return false;
					}
				});
			}
			// Attach to outer scope
			globalThis._google_quote_time = quote_time;
		} catch (extractErr) {
			logDebug('Error extracting Google Finance data: ' + extractErr);
		}

		data = {
			"key" : ticker,
			"last_price" : last_price,
			"price_change_decimal" : price_change_decimal,
			"price_change_percent" : price_change_percent,
			"previous_close_price" : previous_close_price,
			"after_hours_price" : after_hours_price,
			"pre_market_price" : pre_market_price,
			"pre_market_price_change_decimal": pre_market_price_change_decimal,
			"pre_market_price_change_percent": pre_market_price_change_percent,
			source: 'google_finance',
			capture_time: new Date().toISOString().replace("T", " ").replace("Z", " UTC"),
			quote_time: globalThis._google_quote_time || ''
		};

		logDebug('Google Finance data: ' + JSON.stringify(data));

		// Publish the data object to Kafka
		try {
			const kafkaTopic = process.env.KAFKA_TOPIC || 'scrapeGoogle';
			const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
			await publishToKafka(data, kafkaTopic, kafkaBrokers);
			logDebug(`Published Google Finance data to Kafka topic ${kafkaTopic}`);
		} catch (kafkaErr) {
			logDebug('Kafka publish error (Google Finance): ' + kafkaErr);
		}

		// Save the data object to google.yyyymmdd_hhmmss.json using getDateTimeString
		const jsonFileName = `${ticker}.google.${getDateTimeString()}.json`;
		const jsonFilePath = require('path').join(outputDir, jsonFileName);
		require('fs').writeFileSync(jsonFilePath, JSON.stringify(data, null, 2), 'utf-8');
		logDebug(`Saved Google JSON to ${jsonFilePath}`);
		
	} catch (err) {
		logDebug('Error in scrapeGoogle: ' + err);
	} finally {
		if (page) {
			try { await page.close(); logDebug('Closed Google Finance tab.'); } catch (e) { logDebug('Error closing tab: ' + e); }
		}
	}
	return data;
}
// Load environment variables from .env if present (for local dev)
require('dotenv').config();
const fs = require('fs');
const version = 'VERSION:33'
console.log(version);
const puppeteer = require('puppeteer');

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
    return `/usr/src/app/logs/scrape_security_data.${getDateTimeString()}.log`;
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


async function scrapeInvestingComWatchlists(browser, watchlist, outputDir) {
	investingUrl=watchlist.url;
	//const investingUrl = process.env.INVESTING_URL;
	if (!investingUrl) {
		logDebug('WARNING: INVESTING_URL is missing or invalid');
		throw new Error('INVESTING_URL is not set in .env');
	}
	const investingEmail = process.env.INVESTING_EMAIL;
	const investingPassword = process.env.INVESTING_PASSWORD;
	try {
		logDebug('Using provided browser for investing.com...');
		logDebug(`outputDir: ${outputDir}`);
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

		// Try to click the tab with title=watchlist.key if it exists
		try {
			const tabSelector = `li[title="${watchlist.key}"]`;
			await page.waitForSelector(tabSelector, { visible: true, timeout: 5000 });
			await page.click(tabSelector);
			logDebug(`Clicked the tab with title="${watchlist.key}".`);
			// Wait for 4 seconds after clicking the tab
			await new Promise(resolve => setTimeout(resolve, 4000));
		} catch (e) {
			logDebug(`Tab with title="${watchlist.key}" not found or not clickable: ` + e.message);
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
		const safeWatchlistKey = sanitizeForFilename(watchlist.key);
		const htmlOutPath = `/usr/src/app/logs/investingcom_watchlist.${safeWatchlistKey}.${getDateTimeString()}.html`;
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
		const outPath = require('path').join(outputDir, `investingcom_watchlist.${safeWatchlistKey}.${getDateTimeString()}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(securities, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);

		// Publish each security to Kafka
		const kafkaTopic = process.env.KAFKA_TOPIC || 'investingcom_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',');
		for (const sec of securities) {
			publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
		}
	} catch (err) {
		logDebug('Error in scrapeInvestingComWatchlist: ' + err);
		if (err.stack) {
			// Extract the first stack line after the error message
			const stackLine = err.stack.split('\n')[1];
			console.error('Occurred at:', stackLine.trim());
		}
	}
}

function shouldRunTask(intervalMinutes, markerPath) {
	let lastRun = 0;
	if (fs.existsSync(markerPath)) {
		// Read only the first line (timestamp) for compatibility
		const lines = fs.readFileSync(markerPath, 'utf8').split('\n');
		lastRun = parseInt(lines[0], 10);
	}
	const now = Date.now();
	if (now - lastRun >= intervalMinutes * 60 * 1000) {
		const human = new Date(now).toLocaleString('en-US', { hour12: false });
		fs.writeFileSync(markerPath, now.toString() + '\n' + human + '\n');
		return true;
	}
	return false;
}

function isBusinessHours() {
	const now = new Date();
	const day = now.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
	const hour = now.getHours();
	const minute = now.getMinutes();
	// Monday–Friday, 4:00am–20:02pm
	if (day === 0 || day === 6) return false;
	if (hour < 4 || (hour === 20 && minute > 2) || hour > 20) return false;
	return true;
}

async function main() {
	const outputDir = process.argv[3] || '/usr/src/app/logs';
	logDebug(version);
	if (!isBusinessHours()) {
		// logDebug('Not within business hours, exiting/');
		// return;
	}		

	// Browser connect/launch logic
	let browser = null;
	let connected = false;
	let connectError = null;
	let launchError = null;
	const persistentProfileDir = '/tmp/chrome-profile2';
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
					   '--disable-domain-reliability',
					   '--disable-certificate-transparency'
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

	// Close any tab opened to "chrome://welcome"
	//try {
	//	const pages = await browser.pages();
	//	for (const page of pages) {
	//		if (page.url().startsWith('chrome://welcome')) {
	//			await page.close();
	//			logDebug('Closed chrome://welcome tab.');
	//		}
	//	}
	//} catch (e) {
	//	logDebug('Error closing chrome://welcome tab: ' + e);
	//}

	try {
		// Scrape Investing.com every Y minutes
		const investingMarker = path.join('/usr/src/app/logs/', 'last_investing_scrape.txt');
		const investingInterval = 2; // set your interval in minutes
		if (shouldRunTask(investingInterval, investingMarker)) {
			logDebug('Begin investing.com scrape');
			// Use /usr/src/app/data/investingcom_watchlists.csv for input data
			const csvPath = path.join('/usr/src/app/data/', 'investingcom_watchlists.csv');
			const content = fs.readFileSync(csvPath, 'utf8');
			const { parse } = require('csv-parse/sync');
			const records = parse(content, { columns: true, skip_empty_lines: true, comment: '#'});
			// Loop over records and call scrapeInvestingComWatchlists for each valid investing URL
			for (const record of records) {
				logDebug(`investingcom watchlist: ${record.key} ${record.interval} ${record.url}`)
				const investingUrl = record.url;
				if (investingUrl && investingUrl.startsWith('http')) {
					await scrapeInvestingComWatchlists(browser, record, outputDir);
				} else {
					logDebug(`Skipping record with missing or invalid investing URL: ${JSON.stringify(record)}`);
				}
			}
		} else {
			logDebug('Skipping investing.com scrape (interval not reached)');
		}

		// scrape_group c URLs every X minutes
		const urlMarker = path.join('/usr/src/app/logs/', 'last_group_c_scrape.txt');
		const urlInterval = 2; // set your interval in minutes
		if (shouldRunTask(urlInterval, urlMarker)) {
			// Use /usr/src/app/data/wealth_tracker.csv for input data
			const csvPath = path.join('/usr/src/app/data/', 'wealth_tracker.csv');
			const content = fs.readFileSync(csvPath, 'utf8');
			const { parse } = require('csv-parse/sync');
			const records = parse(content, { columns: true, skip_empty_lines: true, comment: '#'});
			// Filter securities where the 'scrape_group' column equals 'c'
			const filtered_securities = records.filter(row => row.scrape_group === 'c');

			   for (const security of filtered_securities) {
				   if (security.google && security.google.startsWith('http')) {
					   const googleData = await scrapeGoogle(browser, security, outputDir);
					   logDebug(`Google scrape result: ${JSON.stringify(googleData)}`);
					   // Sleep for 1 second between Google scrapes
					   await new Promise(resolve => setTimeout(resolve, 1000));
				   }
			   }
		} else {
			logDebug('Skipping URL scrape (interval not reached)');
		}
	} finally {
		// Do not close the browser to keep it open for the next run
		// if (browser) {
		//     try { await browser.close(); logDebug('Browser closed.'); } catch (e) { logDebug('Error closing browser: ' + e); }
		// }
	}
}

main().catch(e => logDebug('Fatal error in main: ' + e));
