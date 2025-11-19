

const fs = require('fs');
require('dotenv').config();
const version = 'VERSION:33'
console.log(version);

const { scrapeGoogle } = require('./scrape_google');
const { sanitizeForFilename, getDateTimeString, getTimestampedLogPath, logDebug, reportMetrics, resetMetrics, getMetrics } = require('./scraper_utils');
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
const { scrapeYahoo, scrapeYahooBatch } = require('./scrape_yahoo');
const { scrapeStockAnalysis } = require('./scrape_stock_analysis');

// Global reference to the Puppeteer browser so we can close it on shutdown
let globalBrowser = null;
// Health state
let lastCycleAt = null;
let lastCycleStatus = 'not-run';
let lastCycleError = null;
let lastCycleDurationMs = null;
const startTime = Date.now();

// Health server
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
let healthServer = null;

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
			// If Chrome failed to launch because X isn't available, attempt a headless fallback
			if (launchError && /X server|Missing X server|headful/i.test(launchError.message || '')) {
				logDebug('[LAUNCH ERROR] Detected X/server issue in Chrome launch, attempting headless fallback...');
				try {
					browser = await puppeteerExtra.launch({
						headless: true,
						executablePath: '/opt/google/chrome/chrome',
						args: [
							'--no-sandbox',
							'--disable-gpu',
							'--disable-dev-shm-usage',
							'--disable-setuid-sandbox',
							`--user-data-dir=${persistentProfileDir}`,
							'--disable-features=AudioServiceOutOfProcess',
						],
						env: { ...process.env, CHROME_DISABLE_UPDATE: '1' }
					});
					logDebug('Headless Chrome fallback launched.');
				} catch (headlessErr) {
					logDebug('[LAUNCH ERROR] Headless fallback failed: ' + (headlessErr && headlessErr.message ? headlessErr.message : headlessErr));
					// keep original launchError in place for diagnostics
				}
			}
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
	const investingInterval = 4; // minutes
	if (0 && shouldRunTask(investingInterval, investingMarker)) {
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

	const yahooBatchMarker = path.join('/usr/src/app/logs/', 'last_yahoo_batch_api.txt');
	const yahooBatchInterval = 30; // minutes
	if (0 && shouldRunTask(yahooBatchInterval, yahooBatchMarker)) {
		const csvPath = path.join('/usr/src/app/data/', 'wealth_tracker.csv');
		const content = fs.readFileSync(csvPath, 'utf8');
		const { parse } = require('csv-parse/sync');
		const records = parse(content, { columns: true, skip_empty_lines: true, comment: '#'});

		// Run Yahoo batch for any record that has a `yahoo` column populated
		const yahooSecurities = records.filter(s => s.yahoo && s.yahoo.toString().trim());
		if (yahooSecurities.length) {
			try {
				const batchResults = await scrapeYahooBatch(browser, yahooSecurities, outputDir, { chunkSize: 50, delayMs: 500 });
				logDebug(`Yahoo batch fetched ${batchResults.length} items`);
			} catch (e) {
				logDebug('Yahoo batch fetch error: ' + e);
			}
		}
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
				if (security.stock_analysis && security.stock_analysis.startsWith('http')) {
					const stockAnalysisData = await scrapeStockAnalysis(browser, security, outputDir);
					logDebug(`Stock_analysis scrape result: ${JSON.stringify(stockAnalysisData)}`);
				} else if (security.google && security.google.startsWith('http')) {
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
	// expose browser for graceful shutdown
	globalBrowser = browser;

	// Heartbeat configuration: emit periodic heartbeat messages to logs/stdout
	const HEARTBEAT_INTERVAL_MINUTES = parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '5', 10);
	let lastHeartbeat = 0;

	// start health server so external monitors can query status and (optionally) metrics
	try {
		const METRICS_ENABLED = (process.env.METRICS_ENABLED || 'false').toLowerCase() === 'true';
		healthServer = http.createServer((req, res) => {
			if (req.url === '/health') {
				const compactMetrics = getMetrics ? getMetrics() : null;
				const payload = {
					status: 'ok',
					pid: process.pid,
					uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
					last_cycle_at: lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
					last_cycle_status: lastCycleStatus,
					last_cycle_error: lastCycleError,
					last_cycle_duration_ms: lastCycleDurationMs,
					metrics: compactMetrics
				};
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(payload));
				return;
			}
			if (req.url === '/metrics') {
				if (!METRICS_ENABLED) {
					res.writeHead(404);
					res.end('Not found');
					return;
				}
				// Expose a minimal Prometheus exposition format using current metrics
				const m = getMetrics ? getMetrics() : { totalNavigations: 0, failedNavigations: 0, totalRequests: 0, failedRequests: 0 };
				const uptime = Math.floor((Date.now() - startTime) / 1000);
				const lines = [];
				lines.push('# HELP scrape_uptime_seconds Daemon uptime in seconds');
				lines.push('# TYPE scrape_uptime_seconds gauge');
				lines.push(`scrape_uptime_seconds ${uptime}`);
				lines.push('# HELP scrape_last_cycle_duration_ms Duration of last cycle in milliseconds');
				lines.push('# TYPE scrape_last_cycle_duration_ms gauge');
				lines.push(`scrape_last_cycle_duration_ms ${lastCycleDurationMs || 0}`);
				lines.push('# HELP scrape_total_navigations Total navigation attempts this cycle');
				lines.push('# TYPE scrape_total_navigations counter');
				lines.push(`scrape_total_navigations ${m.totalNavigations || 0}`);
				lines.push('# HELP scrape_failed_navigations Total failed navigations this cycle');
				lines.push('# TYPE scrape_failed_navigations counter');
				lines.push(`scrape_failed_navigations ${m.failedNavigations || 0}`);
				lines.push('# HELP scrape_total_requests Total requests observed this cycle');
				lines.push('# TYPE scrape_total_requests counter');
				lines.push(`scrape_total_requests ${m.totalRequests || 0}`);
				lines.push('# HELP scrape_failed_requests Total failed requests this cycle');
				lines.push('# TYPE scrape_failed_requests counter');
				lines.push(`scrape_failed_requests ${m.failedRequests || 0}`);
				// last cycle status as labeled gauge
				lines.push('# HELP scrape_last_cycle_status Status of last cycle (1 for status label present)');
				lines.push('# TYPE scrape_last_cycle_status gauge');
				const statusLabel = lastCycleStatus || 'unknown';
				lines.push(`scrape_last_cycle_status{status="${statusLabel}"} 1`);
				res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
				res.end(lines.join('\n') + '\n');
				return;
			}
			res.writeHead(404);
			res.end('Not found');
		});
		healthServer.listen(HEALTH_PORT, () => {
			logDebug(`Health endpoint listening on ${HEALTH_PORT}`);
		});
	} catch (e) {
		logDebug('Failed to start health server: ' + e.message);
	}
	while (true) {
		let cycleStart = null;
		try {
			lastCycleStatus = 'running';
			lastCycleError = null;
			// reset per-cycle metrics so each cycle reports its own counts
			try { resetMetrics(); } catch (e) {}
			cycleStart = Date.now();
			try { resetMetrics(); } catch (e) {}
			await runCycle(browser, outputDir);
			lastCycleAt = Date.now();
			lastCycleDurationMs = Date.now() - cycleStart;
			lastCycleStatus = 'ok';
			// report navigation/request metrics and alert if thresholds exceeded
			try {
				const thresholds = { navFail: parseInt(process.env.NAV_FAIL_THRESHOLD || '5', 10), reqFail: parseInt(process.env.REQ_FAIL_THRESHOLD || '10', 10) };
				reportMetrics(thresholds, debugLogPath);
			} catch (e) { logDebug('Error reporting metrics: ' + e); }
		} catch (e) {
			lastCycleAt = Date.now();
			lastCycleStatus = 'error';
			lastCycleError = String(e && e.message ? e.message : e);
			// set duration even on error
			try { lastCycleDurationMs = Date.now() - (typeof cycleStart === 'number' ? cycleStart : Date.now()); } catch (err) { lastCycleDurationMs = null; }
			logDebug('Fatal error in cycle: ' + e);
			try {
				const thresholds = { navFail: parseInt(process.env.NAV_FAIL_THRESHOLD || '5', 10), reqFail: parseInt(process.env.REQ_FAIL_THRESHOLD || '10', 10) };
				reportMetrics(thresholds, debugLogPath);
			} catch (e2) { logDebug('Error reporting metrics after failure: ' + e2); }
		}
		// Emit heartbeat if interval elapsed
		try {
			const now = Date.now();
			if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MINUTES * 60 * 1000) {
				const hb = `[${new Date().toISOString()}] HEARTBEAT: daemon alive\n`;
				logDebug('HEARTBEAT: daemon alive');
				try { require('fs').writeSync(1, hb); } catch (e) {}
				lastHeartbeat = now;
			}
		} catch (e) {
			// ignore heartbeat errors
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

// Graceful shutdown: attempt to close the browser when container is stopped
async function gracefulShutdown(signal) {
	try {
		const msg = 'Received ' + signal + ', shutting down...';
		logDebug(msg);
		try { require('fs').writeSync(1, `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {}
		if (globalBrowser) {
			await globalBrowser.close();
			logDebug('Browser closed.');
			try { require('fs').writeSync(1, `[${new Date().toISOString()}] Browser closed.\n`); } catch (e) {}
		}
		// close health server if running
		try {
			if (healthServer) {
				healthServer.close(() => { logDebug('Health server closed.'); });
			}
		} catch (e) {
			// ignore
		}
	} catch (e) {
		logDebug('Error during shutdown: ' + e);
		try { require('fs').writeSync(2, `[${new Date().toISOString()}] Error during shutdown: ${e}\n`); } catch (e2) {}
	} finally {
		// give a moment for logs to flush
		await new Promise(r => setTimeout(r, 250));
		process.exit(0);
	}
}

process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
