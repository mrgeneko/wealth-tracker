

const fs = require('fs');
require('dotenv').config();
const version = 'VERSION:33'
console.log(version);

const { scrapeGoogle } = require('./scrape_google');
const { sanitizeForFilename, getDateTimeString, getTimestampedLogPath, logDebug } = require('./scraper_utils');
const puppeteer = require('puppeteer');
const debugLogPath = getTimestampedLogPath();
const path = require('path');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const { publishToKafka } = require('./publish_to_kafka');
const http = require('http');
const { scrapeWebull } = require('./scrape_webull');
const { scrapeInvestingComWatchlists } = require('./scrape_investingcom_watchlists');

function shouldRunTask(intervalMinutes, markerPath) {
	let lastRun = 0;
	if (fs.existsSync(markerPath)) {
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
	const day = now.getDay();
	const hour = now.getHours();
	const minute = now.getMinutes();
	if (day === 0 || day === 6) return false;
	if (hour < 4 || (hour === 20 && minute > 2) || hour > 20) return false;
	return true;
}

async function ensureBrowser() {
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
	return browser;
}

async function runCycle(browser, outputDir) {
	//if (!isBusinessHours()) {
	//	logDebug('Outside business hours, skipping cycle.');
//		return;
//	}
	const investingMarker = path.join('/usr/src/app/logs/', 'last_investing_scrape.txt');
	const investingInterval = 2; // minutes
	if (shouldRunTask(investingInterval, investingMarker)) {
		logDebug('Begin investing.com scrape');
		const csvPath = path.join('/usr/src/app/data/', 'investingcom_watchlists.csv');
		const content = fs.readFileSync(csvPath, 'utf8');
		const { parse } = require('csv-parse/sync');
		const records = parse(content, { columns: true, skip_empty_lines: true, comment: '#'});
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

	const urlMarker = path.join('/usr/src/app/logs/', 'last_group_c_scrape.txt');
	const urlInterval = 60; // minutes
	if (shouldRunTask(urlInterval, urlMarker)) {
		const csvPath = path.join('/usr/src/app/data/', 'wealth_tracker.csv');
		const content = fs.readFileSync(csvPath, 'utf8');
		const { parse } = require('csv-parse/sync');
		const records = parse(content, { columns: true, skip_empty_lines: true, comment: '#'});
		const filtered_securities = records.filter(row => row.scrape_group === 'c');
		for (const security of filtered_securities) {
			logDebug('security type:' + security.type);
			if (security.type && security.type == 'bond' && security.webull && security.webull.startsWith('http')) {
				const webullData = await scrapeWebull(browser, security, outputDir);
				logDebug(`Webull scrape result: ${JSON.stringify(webullData)}`);
			} else if (security.type && (security.type == 'stock' || security.type == 'etf')) {
				if (security.google && security.google.startsWith('http')) {
					const googleData = await scrapeGoogle(browser, security, outputDir);
					logDebug(`Google scrape result: ${JSON.stringify(googleData)}`);
				} else if (security.webull && security.webull.startsWith('http')) {
					const webullData = await scrapeWebull(browser, security, outputDir);
					logDebug(`Webull scrape result: ${JSON.stringify(webullData)}`);
				} else {
					logDebug('unhandled UNHANDLED SECURITY:' + security.key);
				}
			}
			await new Promise(r => setTimeout(r, 1000));
		}
	} else {
		logDebug('Skipping URL scrape (interval not reached)');
	}
	logDebug('Cycle complete.');
}

async function daemon() {
	const outputDir = '/usr/src/app/logs';
	logDebug(version);
	let browser = null;
	// Retry connecting/launching Chrome with backoff to avoid early exit if Chrome not ready yet
	for (let attempt = 1; attempt <= 5; attempt++) {
		try {
			browser = await ensureBrowser();
			break;
		} catch (e) {
			logDebug(`ensureBrowser attempt ${attempt} failed: ${e.message}`);
			await new Promise(r => setTimeout(r, attempt * 2000)); // incremental backoff
		}
	}
	if (!browser) {
		logDebug('Giving up after 5 ensureBrowser attempts; exiting daemon.');
		return;
	}
	while (true) {
		try {
			await runCycle(browser, outputDir);
		} catch (e) {
			logDebug('Fatal error in cycle: ' + e);
		}
		await new Promise(r => setTimeout(r, 60000)); // sleep 60s between cycles
	}
}

(async () => {
	try {
		await daemon();
	} catch (e) {
		// If daemon throws synchronously, log and try one more full restart after short delay
		logDebug('Daemon outer failure: ' + e.message);
		await new Promise(r => setTimeout(r, 5000));
		try {
			await daemon();
		} catch (e2) {
			logDebug('Daemon second failure, giving up: ' + e2.message);
		}
	}
})();
