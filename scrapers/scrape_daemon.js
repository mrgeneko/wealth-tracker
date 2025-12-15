const fs = require('fs');
require('dotenv').config();
const version = 'VERSION:33'
console.log(version);
// Diagnostic: record startup timestamps of key files so we can trace which
// version of code is actually running (helps detect stale in-memory loads).
try {
	const df = '/usr/src/app/scrapers/scrape_yahoo.js';
	const pf = '/usr/src/app/scrapers/publish_to_kafka.js';
	const stDF = fs.existsSync(df) ? fs.statSync(df).mtime.toISOString() : '<missing>';
	const stPF = fs.existsSync(pf) ? fs.statSync(pf).mtime.toISOString() : '<missing>';
	console.log(`Startup files: scrape_yahoo.js@${stDF}, publish_to_kafka.js@${stPF}`);
} catch (e) { console.warn('Startup diagnostics failed: ' + (e && e.message ? e.message : e)); }

const { scrapeGoogle, scrapeGoogleWithPage } = require('./scrape_google');
const { sanitizeForFilename, getDateTimeString, getTimestampedLogPath, logDebug, reportMetrics, resetMetrics, getMetrics, isWeekday, isPreMarketSession, isRegularTradingSession, isAfterHoursSession, getConstructibleUrls, normalizedKey } = require('./scraper_utils');
const { recordScraperMetrics, getMetricsCollector } = require('./metrics-integration');
const mysql = require('mysql2/promise');
const puppeteer = require('puppeteer');
const debugLogPath = getTimestampedLogPath();
const path = require('path');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const { publishToKafka } = require('./publish_to_kafka');
const http = require('http');
const { OnDemandScrapeApi, DEFAULT_ON_DEMAND_LIMITS } = require('./on_demand_scrape_api');

// Phase 11: watchlist management API
const { watchlistManager } = require('./watchlist/watchlist_manager');
const { WatchlistConfigLoader } = require('../services/watchlist_config_loader');

// Phase 7: page pool & persistent page registry
const PagePool = require('./page_pool');
const PersistentPageRegistry = require('./persistent_page_registry');

const { scrapeInvestingComWatchlists } = require('./scrape_investingcom_watchlists');
const { scrapeTradingViewWatchlists } = require('./scrape_tradingview_watchlists');
const { scrapeWebullWatchlists } = require('./scrape_webull_watchlists');

const { scrapeCNBC } = require('./scrape_cnbc');
const { scrapeMarketBeat } = require('./scrape_marketbeat');
const { scrapeMoomoo } = require('./scrape_moomoo');
const { scrapeMarketWatch } = require('./scrape_marketwatch');
const { scrapeNasdaq } = require('./scrape_nasdaq');
const { scrapeRobinhood } = require('./scrape_robinhood');
const { scrapeStockAnalysis } = require('./scrape_stockanalysis');
const { scrapeStocktwits } = require('./scrape_stocktwits');
const { scrapeWebull } = require('./scrape_webull');
const { scrapeWSJ } = require('./scrape_wsj');
const { scrapeYCharts } = require('./scrape_ycharts');

const { scrapeStockMarketWatch } = require('./scrape_stockmarketwatch');
const { scrapeStockEvents } = require('./scrape_stockevents');
const scraperMap = {
	'cnbc': scrapeCNBC,
	'google': scrapeGoogle,
	'marketbeat': scrapeMarketBeat,
	//'marketwatch': scrapeMarketWatch,
	//'moomoo': scrapeMoomoo,
	'nasdaq': scrapeNasdaq,
	'robinhood': scrapeRobinhood,
	'stockanalysis': scrapeStockAnalysis,
	'stocktwits': scrapeStocktwits,
	'ycharts': scrapeYCharts,
	'webull': scrapeWebull,
	'wsj': scrapeWSJ,
	'stockmarketwatch': scrapeStockMarketWatch,
	'stockevents': scrapeStockEvents
};

// Determine canonical data directory (host mount or repo folder). This
// avoids relying on a `config/` folder and prefers the host-mounted
// `/usr/src/app/data` or repo `wealth_tracker_data`.
// Use the container-hosted data directory for runtime data (logs, cache, etc.)
// Configuration files live in /usr/src/app/config (mounted from ./config)
const DATA_DIR = path.join('/usr/src/app', 'data');
const CONFIG_DIR = path.join('/usr/src/app', 'config');
const ATTR_PATH = path.join(CONFIG_DIR, 'config.json');
let _cachedAttrs = null;
let _cachedMtime = 0;

function loadScraperAttributes() {
	try {
		const st = fs.statSync(ATTR_PATH);
		const mtime = st && st.mtimeMs ? st.mtimeMs : 0;
		if (_cachedAttrs && _cachedMtime === mtime) {
			return _cachedAttrs;
		}
		const txt = fs.readFileSync(ATTR_PATH, 'utf8');
		const parsed = JSON.parse(txt);
		_cachedAttrs = parsed || {};
		_cachedMtime = mtime;
		try { logDebug('Loaded/updated scraper attributes (mtime=' + _cachedMtime + ')'); } catch (e) {}
		return _cachedAttrs;
	} catch (e) {
		try { logDebug('Failed to read/parse scraper attributes: ' + (e && e.message ? e.message : e)); } catch (e2) { console.error('Failed to read/parse scraper attributes', e); }
		return _cachedAttrs || {};
	}
}

function getConfig(name) {
	if (!name) return {};
	const attrs = loadScraperAttributes();
	if (attrs[name]) return attrs[name];
	const lc = name.toLowerCase();
	if (attrs[lc]) return attrs[lc];
	return {};
}

// MySQL pool for querying positions
let mysqlPool = null;

function getMysqlPool() {
	if (!mysqlPool) {
		mysqlPool = mysql.createPool({
			host: process.env.MYSQL_HOST || 'wealth-tracker-mysql',
			port: parseInt(process.env.MYSQL_PORT || '3306', 10),
			user: process.env.MYSQL_USER || 'test',
			password: process.env.MYSQL_PASSWORD || 'test',
			database: process.env.MYSQL_DATABASE || 'testdb',
			waitForConnections: true,
			connectionLimit: 5,
			queueLimit: 0
		});
	}
	return mysqlPool;
}
 
 // Phase 3: exchange registry now reads from DB; initialize it using the daemon pool.
 try {
 	const { initializeDbPool } = require('./exchange_registry');
 	initializeDbPool(getMysqlPool());
 } catch (e) {
 	// Daemon can continue even if initialization fails; lookups will error when used.
 	try { console.warn('Failed to init exchange registry DB pool: ' + (e && e.message ? e.message : e)); } catch (e2) {}
 }

async function fetchStockPositions() {
	try {
		const pool = getMysqlPool();
		const [rows] = await pool.query(
			"SELECT DISTINCT ticker, type FROM positions WHERE type IN ('stock', 'etf') AND ticker IS NOT NULL AND ticker != ''"
		);
		return rows.map(r => ({ ticker: r.ticker, type: r.type, normalized_key: (r && r.normalized_key) ? r.normalized_key : normalizedKey(r.ticker) }));
	} catch (e) {
		logDebug('Error fetching stock positions from MySQL: ' + (e && e.message ? e.message : e));
		return [];
	}
}

async function fetchBondPositions() {
	try {
		const pool = getMysqlPool();
		const [rows] = await pool.query(
			"SELECT DISTINCT ticker, type FROM positions WHERE type = 'bond' AND ticker IS NOT NULL AND ticker != ''"
		);
		return rows.map(r => ({ ticker: r.ticker, type: r.type, normalized_key: (r && r.normalized_key) ? r.normalized_key : normalizedKey(r.ticker) }));
	} catch (e) {
		logDebug('Error fetching bond positions from MySQL: ' + (e && e.message ? e.message : e));
		return [];
	}
}

function getScrapeGroupSettings(groupName, defaultMinutes = 5) {
	const attrs = loadScraperAttributes();
	const groups = attrs && attrs.scrape_groups ? attrs.scrape_groups : {};
    let interval = defaultMinutes;
    // Default to false. Only set to true if explicitly enabled in config.
    let enabled = false;

	if (groups && groups[groupName]) {
        const val = groups[groupName];
        if (typeof val === 'object' && val !== null) {
            if (val.interval !== undefined) {
                const v = Number(val.interval);
                if (!Number.isNaN(v) && isFinite(v)) interval = v;
            }
            if (val.enabled !== undefined) {
                enabled = val.enabled === true;
            }
        }
	}
	return { interval, enabled };
}

// Global reference to the Puppeteer browser so we can close it on shutdown
let globalBrowser = null;

// Phase 7: global scraping infrastructure (page pool + persistent pages)
let pagePool = null;
let persistentPages = null;
let pagePoolBrowser = null;

let watchlistConfigLoader = null;

async function initializeWatchlistProviders(browser) {
	try {
		if (!browser) return;
		watchlistConfigLoader = new WatchlistConfigLoader(getMysqlPool());
		const providers = await watchlistConfigLoader.getProviders();
		for (const [providerId, providerCfg] of Object.entries(providers || {})) {
			if (!providerCfg || providerCfg.enabled === false) continue;
			const watchlists = Array.isArray(providerCfg.watchlists) ? providerCfg.watchlists : [];
			const first = watchlists.find(w => w && w.enabled !== false && w.url);
			if (!first || !first.url) {
				logDebug(`[Watchlist] No URL configured for provider ${providerId}; skipping initialization`);
				continue;
			}
			try {
				await watchlistManager.initializeProvider(providerId, browser, first.url);
				logDebug(`[Watchlist] Initialized provider ${providerId} with ${first.key || 'default'} URL`);
			} catch (e) {
				logDebug(`[Watchlist] Failed to initialize provider ${providerId}: ${e.message}`);
			}
		}
	} catch (e) {
		logDebug('[Watchlist] initializeWatchlistProviders failed: ' + (e && e.message ? e.message : e));
	}
}

function readJsonBody(req, { maxBytes = 1024 * 1024 } = {}) {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', chunk => {
			body += chunk;
			if (body.length > maxBytes) {
				reject(new Error('Request body too large'));
				try { req.destroy(); } catch (e) {}
			}
		});
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (e) {
				reject(e);
			}
		});
	});
}

async function shutdownScraperInfrastructure() {
	if (pagePool) {
		try { await pagePool.shutdown(); } catch (e) {}
		pagePool = null;
	}
	if (persistentPages) {
		try { await persistentPages.closeAll(); } catch (e) {}
		persistentPages = null;
	}
	pagePoolBrowser = null;
}

async function initializeScraperInfrastructure(browser) {
	if (!browser) return { pagePool: null, persistentPages: null };
	if (pagePool && pagePoolBrowser === browser) return { pagePool, persistentPages };

	// Re-init on browser change
	await shutdownScraperInfrastructure();

	// Page pool for stateless scrapers
	const poolSize = parseInt(process.env.PAGE_POOL_SIZE || '4', 10);
	const acquireTimeout = parseInt(process.env.PAGE_ACQUIRE_TIMEOUT || '30000', 10);
	const maxOperationsPerPage = parseInt(process.env.PAGE_MAX_OPERATIONS || '100', 10);
	const navigationTimeout = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT || '30000', 10);

	try {
		pagePool = new PagePool(browser, {
			poolSize,
			acquireTimeout,
			maxOperationsPerPage,
			navigationTimeout
		});
		await pagePool.initialize();
		pagePoolBrowser = browser;
	} catch (e) {
		// Daemon can continue without the page pool; Phase 8 will require it.
		try { logDebug('[PagePool] Failed to initialize: ' + (e && e.message ? e.message : e)); } catch (e2) {}
		pagePool = null;
		pagePoolBrowser = null;
	}

	// Persistent page registry for stateful scrapers
	try {
		persistentPages = new PersistentPageRegistry(browser);
	} catch (e) {
		persistentPages = null;
	}

	return { pagePool, persistentPages };
}
// Health state
let lastCycleAt = null;
let lastCycleStatus = 'not-run';
let lastCycleError = null;
let lastCycleDurationMs = null;
const startTime = Date.now();

// Browser health tracking
let browserLaunchTime = null;
let consecutiveProtocolTimeouts = 0;
const MAX_PROTOCOL_TIMEOUTS = 3; // Restart browser after this many consecutive protocol timeouts
const BROWSER_MAX_AGE_MS = 4 * 60 * 60 * 1000; // Restart browser every 4 hours
let browserNeedsRestart = false;

// Check if error message indicates a protocol timeout
function isProtocolTimeoutError(errorMsg) {
	if (!errorMsg) return false;
	const msg = String(errorMsg).toLowerCase();
	return msg.includes('timed out') && (
		msg.includes('protocol') ||
		msg.includes('network.') ||
		msg.includes('emulation.') ||
		msg.includes('runtime.') ||
		msg.includes('page.') ||
		msg.includes('cdp') ||
		msg.includes('increase the')
	);
}

// Check if browser needs restart (age or health issues)
function shouldRestartBrowser() {
	// Check if flagged for restart
	if (browserNeedsRestart) {
		logDebug('Browser flagged for restart');
		return true;
	}
	// Check browser age
	if (browserLaunchTime && (Date.now() - browserLaunchTime) > BROWSER_MAX_AGE_MS) {
		logDebug(`Browser age (${Math.round((Date.now() - browserLaunchTime) / 60000)}min) exceeds max age (${BROWSER_MAX_AGE_MS / 60000}min)`);
		return true;
	}
	// Check consecutive protocol timeouts
	if (consecutiveProtocolTimeouts >= MAX_PROTOCOL_TIMEOUTS) {
		logDebug(`Consecutive protocol timeouts (${consecutiveProtocolTimeouts}) >= threshold (${MAX_PROTOCOL_TIMEOUTS})`);
		return true;
	}
	return false;
}

// Record a protocol timeout error
function recordProtocolTimeout() {
	consecutiveProtocolTimeouts++;
	logDebug(`Protocol timeout recorded (count: ${consecutiveProtocolTimeouts}/${MAX_PROTOCOL_TIMEOUTS})`);
	if (consecutiveProtocolTimeouts >= MAX_PROTOCOL_TIMEOUTS) {
		browserNeedsRestart = true;
	}
}

// Reset protocol timeout counter (call after successful operation)
function resetProtocolTimeoutCounter() {
	if (consecutiveProtocolTimeouts > 0) {
		logDebug(`Resetting protocol timeout counter (was ${consecutiveProtocolTimeouts})`);
		consecutiveProtocolTimeouts = 0;
	}
}

// Restart the browser
async function restartBrowser() {
	logDebug('Attempting browser restart...');
	try { await shutdownScraperInfrastructure(); } catch (e) {}
	try {
		if (globalBrowser) {
			try {
				await globalBrowser.close();
				logDebug('Old browser closed');
			} catch (e) {
				logDebug('Error closing old browser: ' + (e && e.message ? e.message : e));
			}
		}
	} catch (e) {
		logDebug('Error during browser close attempt: ' + (e && e.message ? e.message : e));
	}
	
	// Reset state
	globalBrowser = null;
	browserNeedsRestart = false;
	consecutiveProtocolTimeouts = 0;
	
	// Wait a moment for Chrome to fully exit
	await new Promise(r => setTimeout(r, 2000));
	
	// Launch new browser
	const newBrowser = await ensureBrowser();
	globalBrowser = newBrowser;
	try { await initializeScraperInfrastructure(newBrowser); } catch (e) {}
	logDebug('Browser restarted successfully');
	return newBrowser;
}

// Health server
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
let healthServer = null;

// Phase 8: On-demand scrape API (stateful rate limiter lives here)
const onDemandScrapeApi = new OnDemandScrapeApi({
	limits: DEFAULT_ON_DEMAND_LIMITS,
	maxTickersPerRequest: 25
});

function shouldRunTask(settings, markerPath) {
    if (!settings.enabled) return false;
    const intervalMinutes = settings.interval;

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
	// Use a persistent profile under DATA_DIR if possible, or fallback to /tmp
	const persistentProfileDir = path.join(DATA_DIR, 'chrome_profile');
	try {
		logDebug('Trying to connect to existing Chrome instance...');
		const debugUrl = process.env.CHROME_DEBUG_URL || 'http://localhost:9222';
		const versionUrl = debugUrl.replace(/\/+$/, '') + '/json/version';
		
		const wsEndpoint = await new Promise((resolve, reject) => {
			const url = new URL(versionUrl);
			const req = http.get({
				hostname: url.hostname,
				port: url.port,
				path: url.pathname,
				timeout: 2000 // 2s timeout
			}, res => {
				let data = '';
				res.on('data', chunk => data += chunk);
				res.on('end', () => {
					try {
						if (res.statusCode !== 200) {
							reject(new Error(`HTTP ${res.statusCode} from ${versionUrl}`));
							return;
						}
						const json = JSON.parse(data);
						resolve(json.webSocketDebuggerUrl);
					} catch (e) {
						reject(e);
					}
				});
			});
			req.on('error', reject);
			req.on('timeout', () => { req.destroy(); reject(new Error('Timeout connecting to Chrome')); });
		});
		browser = await puppeteerExtra.connect({ 
			browserWSEndpoint: wsEndpoint,
			protocolTimeout: 180000 // 3 minute timeout for CDP protocol calls
		});
		connected = true;
		browserLaunchTime = Date.now();
		logDebug('Connected to existing Chrome instance at ' + debugUrl);
	} catch (err) {
		connectError = err;
		logDebug('[CONNECT ERROR] No running Chrome instance found or failed to connect: ' + err.message);
	}
	if (!connected) {
		try {
			logDebug('Launching new Chrome instance...');
			// Check for and remove stale SingletonLock if it exists to prevent "Profile Locked" errors
			logDebug('Checking for stale lock files in ' + persistentProfileDir);
			const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
			for (const f of lockFiles) {
				const p = path.join(persistentProfileDir, f);
				try {
					// Use lstatSync to check for existence (including broken symlinks)
					let exists = false;
					try {
						if (fs.existsSync(p) || fs.lstatSync(p)) exists = true;
					} catch (e) {}

					if (exists) {
						logDebug('Removing stale Chrome profile lock file: ' + p);
						fs.unlinkSync(p);
						logDebug('Successfully removed ' + p);
					} else {
						logDebug('Lock file not found: ' + p);
					}
				} catch (e) {
					logDebug('Failed to remove lock file ' + p + ': ' + e.message);
				}
			}
			browser = await puppeteerExtra.launch({
				headless: false,
				executablePath: '/opt/google/chrome/chrome',
				protocolTimeout: 180000, // 3 minute timeout for CDP protocol calls
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
			browserLaunchTime = Date.now();
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
						protocolTimeout: 180000, // 3 minute timeout for CDP protocol calls
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
					browserLaunchTime = Date.now();
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
	// Attach monitoring handlers to detect disconnects/target destroys and log them.
	try {
		if (browser && typeof browser.on === 'function') {
			browser.on('disconnected', () => {
				logDebug('[BROWSER EVENT] browser disconnected');
				// Clear globalBrowser so callers know it's no longer usable
				try { globalBrowser = null; } catch (e) {}
			});
			browser.on('targetdestroyed', (target) => {
				try {
					const turl = target && target.url ? target.url() : '<unknown>';
					logDebug(`[BROWSER EVENT] target destroyed: ${turl}`);
				} catch (e) {
					logDebug('[BROWSER EVENT] target destroyed (failed to get url)');
				}
			});
			browser.on('targetcreated', (target) => {
				try { logDebug('[BROWSER EVENT] target created: ' + (target.url ? target.url() : '<unknown>')); } catch (e) {}
			});
		}
	} catch (e) {
		logDebug('Failed to attach browser event handlers: ' + (e && e.message ? e.message : e));
	}
	return browser;
}

async function runCycle(browser, outputDir) {
	//if (!isBusinessHours()) {
	//	logDebug('Outside business hours, skipping cycle.');
//		return;
//	}

	// Phase 6: Listing updates have been moved out of the scrape daemon.
	// The daemon is now focused solely on price scraping.

	// ======== INVESTING.COM WATCHLISTS ===========
	const investingWatchlistsName = 'investing_watchlists'
	// use the name variable for the filename so it's consistent and easy to change
	const investingMarker = path.join('/usr/src/app/logs', `last.${investingWatchlistsName}.txt`);
	const investingSettings = getScrapeGroupSettings(investingWatchlistsName, 3); // minutes
	if (shouldRunTask(investingSettings, investingMarker)) {
		logDebug('Begin investing.com scrape');
		// Prefer configuration from config.json
		const attrs = getConfig(investingWatchlistsName);
		// Get update_rules from the 'investing' config section
		const investingConfig = getConfig('investing');
		const updateRules = investingConfig && investingConfig.update_rules ? investingConfig.update_rules : null;
		logDebug(`investing updateRules: ${updateRules ? JSON.stringify(updateRules.map(r => r.key)) : 'null'}`);
		if (attrs && attrs.watchlists && Array.isArray(attrs.watchlists) && attrs.url) {
			for (const item of attrs.watchlists) {
				const record = { key: item.key, interval: item.interval, url: attrs.url };
				logDebug(`investingcom watchlist (from attributes): ${record.key} ${record.interval} ${record.url}`);
				if (record.url && record.url.startsWith('http')) {
					// Phase 9: Record metrics during scraper execution
					await recordScraperMetrics('investing', async () => {
						return await scrapeInvestingComWatchlists(browser, record, outputDir, updateRules);
					}, {
						url: record.url
					});
				} else {
					logDebug(`Skipping record with missing or invalid investing URL: ${JSON.stringify(record)}`);
				}
			}
		} else {
			logDebug('No investing watchlists in attributes; skipping investing.com scrape');
		}
	} else {
		logDebug('Skipping investing.com scrape (interval not reached)');
	}

	// ======== WEBULL WATCHLISTS ===========
	const webullWatchListsName = 'webull_watchlists'
	const webullMarker = path.join('/usr/src/app/logs', `last.${webullWatchListsName}.txt`);
	const webullSettings = getScrapeGroupSettings(webullWatchListsName, 3); // minutes
	if (shouldRunTask(webullSettings, webullMarker)) {
		logDebug('Begin webull watchlists scrape');
		// Prefer configuration from config.json (same shape as investing_watchlists)
		const attrs = getConfig(webullWatchListsName);
		// Debug: print attrs content (truncated) so we can confirm what's loaded at runtime
		try {
			const _attrsStr = JSON.stringify(attrs || {}, null, 2);
			logDebug('webull attrs: ' + (_attrsStr.length > 1000 ? _attrsStr.slice(0, 1000) + '... (truncated)' : _attrsStr));
			// Also write a timestamped dump of the attrs to logs for easier inspection inside the container/host
			//try {
			//	const dumpPath = path.join('/usr/src/app/logs', `attrs_dump.webull.${getDateTimeString()}.json`);
			//	fs.writeFileSync(dumpPath, _attrsStr, 'utf8');
			//	logDebug('Wrote attrs dump to ' + dumpPath);
			//} catch (e2) {
			//	logDebug('Failed to write attrs dump: ' + (e2 && e2.message ? e2.message : e2));
			//}
		} catch (e) {
			logDebug('webull attrs: <unstringifiable> ' + String(e));
		}
		if (attrs && attrs.watchlists && Array.isArray(attrs.watchlists) && attrs.url) {
			for (const item of attrs.watchlists) {
				const record = { key: item.key, interval: item.interval, url: attrs.url };
				logDebug(`webull watchlist (from attributes): ${record.key} ${record.interval} ${record.url}`);
				if (record.url && record.url.startsWith('http')) {
					// Phase 9: Record metrics during scraper execution
					await recordScraperMetrics('webull', async () => {
						return await scrapeWebullWatchlists(browser, record, outputDir);
					}, {
						url: record.url
					});
				} else {
					logDebug(`Skipping record with missing or invalid webull URL: ${JSON.stringify(record)}`);
				}
			}
		} else {
			logDebug('No webull watchlists in attributes; skipping webull watchlists scrape');
		}
	} else {
		logDebug('Skipping webull watchlists scrape (interval not reached)');
	}

	// ======== TRADINGVIEW WATCHLISTS ===========
	const tvWatchlistsName = 'tradingview_watchlists'
	const tvMarker = path.join('/usr/src/app/logs', `last.${tvWatchlistsName}.txt`);
	const tvSettings = getScrapeGroupSettings(tvWatchlistsName, 3); // minutes
	if (shouldRunTask(tvSettings, tvMarker)) {
		logDebug('Begin tradingview watchlists scrape');
		const attrs = getConfig(tvWatchlistsName);
		if (attrs && attrs.watchlists && Array.isArray(attrs.watchlists) && attrs.url) {
			for (const item of attrs.watchlists) {
				const record = { key: item.key, interval: item.interval, url: attrs.url };
				logDebug(`tradingview watchlist (from attributes): ${record.key} ${record.interval} ${record.url}`);
				if (record.url && record.url.startsWith('http')) {
					// Phase 9: Record metrics during scraper execution
					await recordScraperMetrics('tradingview', async () => {
						return await scrapeTradingViewWatchlists(browser, record, outputDir);
					}, {
						url: record.url
					});
				} else {
					logDebug(`Skipping record with missing or invalid tradingview URL: ${JSON.stringify(record)}`);
				}
			}
		} else {
			logDebug('No tradingview watchlists in attributes; skipping tradingview watchlists scrape');
		}
	} else {
		logDebug('Skipping tradingview watchlists scrape (interval not reached)');
	}

	// ======== STOCK POSITIONS (from MySQL) ===========
	const stockPositionsName = 'stock_positions';
	const stockPositionsMarker = path.join('/usr/src/app/logs/', `last.${stockPositionsName}.txt`);
	const stockPositionsSettings = getScrapeGroupSettings(stockPositionsName, 30); // default 30 min
	if (shouldRunTask(stockPositionsSettings, stockPositionsMarker)) {
		logDebug('Begin stock_positions scrape');
		
		// Query MySQL for list of stock/etf positions
		const positions = await fetchStockPositions();
		logDebug(`Found ${positions.length} stock/etf positions in database: ${positions.map(p => p.ticker).join(', ')}`);
		
		if (positions.length > 0) {
			// Use round robin through constructible URLs for each position
			for (const position of positions) {
				const { ticker, type } = position;
				// Get list of potential sources using getConstructibleUrls
				const constructibleUrls = await getConstructibleUrls(ticker, type);
				if (!constructibleUrls || constructibleUrls.length === 0) {
					logDebug(`No constructible URLs for ${ticker}, skipping`);
					continue;
				}
				
				// Pick a random starting index for round robin
				let currentIndex = Math.floor(Math.random() * constructibleUrls.length);
				// constructibleUrls.length might be different for each position
				let scraped = false;
				const startIndex = currentIndex;
				
				do {
					const urlInfo = constructibleUrls[currentIndex];
					const sourceName = urlInfo.source;
					const scraperFunc = scraperMap[sourceName];
					
					if (scraperFunc) {
						const sourceConfig = getConfig(sourceName);
						
						// Skip source if explicitly disabled
						if (sourceConfig && sourceConfig.enabled === false) {
							logDebug(`Skipping disabled source: ${sourceName}`);
							currentIndex = (currentIndex + 1) % constructibleUrls.length;
							continue;
						}
						
						// Check session validity
						const isPre = isPreMarketSession();
						const isReg = isRegularTradingSession();
						const isPost = isAfterHoursSession();
						const isWkday = isWeekday();
						
						const isValidSession = 
							(isPre && sourceConfig.has_pre_market) ||
							(isPost && sourceConfig.has_after_hours) ||
							(isReg || !isWkday);
						
						// Check if source supports stock prices
						if (sourceConfig.has_stock_prices !== false && isValidSession) {
							try {
								// Create a security object with the URL
								const security = {
									key: ticker,
									type: 'stock',
									[sourceName]: urlInfo.url
								};
								logDebug(`Scraping position ${ticker} with ${sourceName}: ${urlInfo.url}`);
								// Phase 9: Record metrics during scraper execution
								const data = await recordScraperMetrics(sourceName, async () => {
									return await scraperFunc(browser, security, outputDir);
								}, {
									url: urlInfo.url
								});
								logDebug(`${sourceName} scrape result for ${ticker}: ${JSON.stringify(data)}`);
								scraped = true;
								break; // Successfully scraped, move to next ticker
							} catch (e) {
								logDebug(`Error scraping ${ticker} with ${sourceName}: ${e.message}`);
							}
						}
					}
					
					currentIndex = (currentIndex + 1) % constructibleUrls.length;
				} while (currentIndex !== startIndex && !scraped);
				
				if (!scraped) {
					logDebug(`Could not scrape ${ticker} with any available source`);
				}
				
				await new Promise(r => setTimeout(r, 1000));
			}
		}
	} else {
		logDebug('Skipping stock_positions scrape (interval not reached or not enabled)');
	}

	// ======== BOND POSITIONS (from MySQL) ===========
	const bondPositionsName = 'bond_positions';
	const bondPositionsMarker = path.join('/usr/src/app/logs/', `last.${bondPositionsName}.txt`);
	const bondPositionsSettings = getScrapeGroupSettings(bondPositionsName, 30); // default 30 min
	if (shouldRunTask(bondPositionsSettings, bondPositionsMarker)) {
		logDebug('Begin bond_positions scrape');
		
		// Query MySQL for list of bond positions
		const bondPositions = await fetchBondPositions();
		logDebug(`Found ${bondPositions.length} bond positions in database: ${bondPositions.map(p => p.ticker).join(', ')}`);
		
		if (bondPositions.length > 0) {
			// Use round robin through constructible URLs for each bond position
			for (const position of bondPositions) {
				const { ticker, type } = position;
				// Get list of potential sources using getConstructibleUrls
				const constructibleUrls = await getConstructibleUrls(ticker, type);
				if (!constructibleUrls || constructibleUrls.length === 0) {
					logDebug(`No constructible URLs for bond ${ticker}, skipping`);
					continue;
				}
				
				// Pick a random starting index for round robin
				let currentIndex = Math.floor(Math.random() * constructibleUrls.length);
				let scraped = false;
				const startIndex = currentIndex;
				
				do {
					const urlInfo = constructibleUrls[currentIndex];
					const sourceName = urlInfo.source;
					const scraperFunc = scraperMap[sourceName];
					
					if (scraperFunc) {
						const sourceConfig = getConfig(sourceName);
						
						// Skip source if explicitly disabled
						if (sourceConfig && sourceConfig.enabled === false) {
							logDebug(`Skipping disabled source: ${sourceName}`);
							currentIndex = (currentIndex + 1) % constructibleUrls.length;
							continue;
						}
						
						// Check if source supports bond prices
						if (sourceConfig.has_bond_prices !== false) {
							try {
								// Create a security object with the URL
								const security = {
									key: ticker,
									type: 'bond',
									[sourceName]: urlInfo.url
								};
								logDebug(`Scraping bond ${ticker} with ${sourceName}: ${urlInfo.url}`);
								// Phase 9: Record metrics during scraper execution
								const data = await recordScraperMetrics(sourceName, async () => {
									return await scraperFunc(browser, security, outputDir);
								}, {
									url: urlInfo.url
								});
								logDebug(`${sourceName} scrape result for bond ${ticker}: ${JSON.stringify(data)}`);
								scraped = true;
								break; // Successfully scraped, move to next bond
							} catch (e) {
								logDebug(`Error scraping bond ${ticker} with ${sourceName}: ${e.message}`);
							}
						}
					}
					
					currentIndex = (currentIndex + 1) % constructibleUrls.length;
				} while (currentIndex !== startIndex && !scraped);
				
				if (!scraped) {
					logDebug(`Could not scrape bond ${ticker} with any available source`);
				}
				
				await new Promise(r => setTimeout(r, 1000));
			}
		}
	} else {
		logDebug('Skipping bond_positions scrape (interval not reached or not enabled)');
	}

	logDebug('Cycle complete.');
}

function getDynamicCycleInterval(attrs) {
    const now = new Date();

    // Use New York time for market hours
    const nyTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const day = nyTime.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const hour = nyTime.getHours();
    const minute = nyTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;

    // Defaults based on user request
    const defaults = {
        regular_trading_seconds: 15,
        pre_market_seconds: 60,
        after_hours_seconds: 60,
        overnight_weekday_seconds: 20 * 60,
        weekend_seconds: 30 * 60
    };

    const settings = (attrs && attrs.cycle_intervals) ? attrs.cycle_intervals : {};
    const regularSec = settings.regular_trading_seconds || defaults.regular_trading_seconds;
    const preMarketSec = settings.pre_market_seconds || defaults.pre_market_seconds;
    const afterHoursSec = settings.after_hours_seconds || defaults.after_hours_seconds;
    const overnightSec = settings.overnight_weekday_seconds || defaults.overnight_weekday_seconds;
    const weekendSec = settings.weekend_seconds || defaults.weekend_seconds;

    // Helper for ranges
    const isTueFri = day >= 2 && day <= 5;
    const isMonThu = day >= 1 && day <= 4;

    // Weekend Rule: Fri 20:30 to Mon 04:00
    if (day === 6 || day === 0) return weekendSec * 1000; // Sat, Sun
    if (day === 5 && timeInMinutes >= (20 * 60 + 30)) return weekendSec * 1000; // Fri >= 20:30
    if (day === 1 && timeInMinutes < 4 * 60) return weekendSec * 1000; // Mon < 04:00

    // Weekday Logic (Mon 04:00 to Fri 20:30)
    
    // Pre-market: Mon-Fri 04:00 - 09:30
    if (timeInMinutes >= 4 * 60 && timeInMinutes < 9 * 60 + 30) {
        return preMarketSec * 1000;
    }

    // Regular: Mon-Fri 09:30 - 16:00
    if (timeInMinutes >= 9 * 60 + 30 && timeInMinutes < 16 * 60) {
        return regularSec * 1000;
    }

    // After-hours: Mon-Fri 16:00 - 20:00
    if (timeInMinutes >= 16 * 60 && timeInMinutes < 20 * 60) {
        return afterHoursSec * 1000;
    }

    // Overnight Weekdays: 8:00pm to 4:00AM (Mon night to Fri morning)
    // Tue-Fri < 04:00
    if (isTueFri && timeInMinutes < 4 * 60) {
        return overnightSec * 1000;
    }
    // Mon-Thu >= 20:00
    if (isMonThu && timeInMinutes >= 20 * 60) {
        return overnightSec * 1000;
    }
    
    // Gap check: Fri 20:00 - 20:30 (Treat as overnight/after-hours gap)
    if (day === 5 && timeInMinutes >= 20 * 60 && timeInMinutes < 20 * 60 + 30) {
        return overnightSec * 1000;
    }

    // Fallback
    return 60000;
}

async function daemon() {
	const outputDir = '/usr/src/app/logs';
	logDebug(version);
	// Runtime check: confirm config path is readable and log top-level keys
	try {
		const attrsCheck = loadScraperAttributes();
		const cfgExists = fs.existsSync(ATTR_PATH);
		logDebug(`Config path: ${ATTR_PATH} exists=${cfgExists}`);
		if (attrsCheck && typeof attrsCheck === 'object' && Object.keys(attrsCheck).length) {
			logDebug('Config loaded keys: ' + Object.keys(attrsCheck).join(', '));
		} else {
			logDebug('Config loaded but empty or missing');
		}
	} catch (e) {
		logDebug('Error checking config path: ' + (e && e.message ? e.message : e));
	}
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
	// Phase 7: initialize page pool / persistent page registry
	try { await initializeScraperInfrastructure(browser); } catch (e) {}
	// Phase 11: initialize watchlist providers (best-effort)
	try { await initializeWatchlistProviders(browser); } catch (e) {}

	// Heartbeat configuration: emit periodic heartbeat messages to logs/stdout
	const HEARTBEAT_INTERVAL_MINUTES = parseInt(process.env.HEARTBEAT_INTERVAL_MINUTES || '5', 10);
	let lastHeartbeat = 0;

	// start health server so external monitors can query status and (optionally) metrics
	try {
		const METRICS_ENABLED = (process.env.METRICS_ENABLED || 'false').toLowerCase() === 'true';
		healthServer = http.createServer(async (req, res) => {
			// Phase 8: On-demand scrape endpoint (uses PagePool + rate limiting)
			if (req.url && req.url.startsWith('/scrape') && req.method === 'POST') {
				onDemandScrapeApi.handle(req, res, {
					browser,
					outputDir,
					pagePool,
					getConstructibleUrls,
					scrapeGoogleWithPage
				});
				return;
			}

			// Phase 11: Watchlist management endpoints
			try {
				if (req.url === '/watchlist/providers' && req.method === 'GET') {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						registered: watchlistManager.getRegisteredProviders(),
						initialized: watchlistManager.getInitializedProviders(),
						capabilities: watchlistManager.getAllCapabilities()
					}));
					return;
				}

				const statusMatch = req.url && req.url.match(/^\/watchlist\/([^/]+)\/status$/);
				if (statusMatch && req.method === 'GET') {
					const providerId = statusMatch[1];
					const controller = watchlistManager.getProvider(providerId);
					if (!controller) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: `Provider not found or not initialized: ${providerId}` }));
						return;
					}
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify(controller.getStatus()));
					return;
				}

				const tabsMatch = req.url && req.url.match(/^\/watchlist\/([^/]+)\/tabs$/);
				if (tabsMatch && req.method === 'GET') {
					const providerId = tabsMatch[1];
					const controller = watchlistManager.getProvider(providerId);
					if (!controller) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
						return;
					}
					const tabs = await controller.getWatchlistTabs();
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ provider: providerId, tabs }));
					return;
				}

				const tickersMatch = req.url && req.url.match(/^\/watchlist\/([^/]+)\/tickers$/);
				if (tickersMatch && req.method === 'GET') {
					const providerId = tickersMatch[1];
					const controller = watchlistManager.getProvider(providerId);
					if (!controller) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
						return;
					}
					const tickers = await controller.listTickers();
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ provider: providerId, tickers, count: tickers.length }));
					return;
				}

				const addMatch = req.url && req.url.match(/^\/watchlist\/([^/]+)\/add$/);
				if (addMatch && req.method === 'POST') {
					const providerId = addMatch[1];
					const controller = watchlistManager.getProvider(providerId);
					if (!controller) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
						return;
					}
					const body = await readJsonBody(req);
					const { ticker, watchlist, assetType = 'stock' } = body || {};
					if (!ticker) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'ticker required' }));
						return;
					}
					const result = await controller.addTicker(ticker, { watchlist, assetType });
					res.writeHead(result && result.success ? 200 : 400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ provider: providerId, ...(result || {}) }));
					return;
				}

				const deleteMatch = req.url && req.url.match(/^\/watchlist\/([^/]+)\/delete$/);
				if (deleteMatch && req.method === 'POST') {
					const providerId = deleteMatch[1];
					const controller = watchlistManager.getProvider(providerId);
					if (!controller) {
						res.writeHead(404, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: `Provider not found: ${providerId}` }));
						return;
					}
					const body = await readJsonBody(req);
					const { ticker, watchlist } = body || {};
					if (!ticker) {
						res.writeHead(400, { 'Content-Type': 'application/json' });
						res.end(JSON.stringify({ error: 'ticker required' }));
						return;
					}
					const result = await controller.deleteTicker(ticker, { watchlist });
					res.writeHead(result && result.success ? 200 : 400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ provider: providerId, ...(result || {}) }));
					return;
				}
			} catch (e) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: e.message }));
				return;
			}
			if (req.url === '/health') {
				const compactMetrics = getMetrics ? getMetrics() : null;
				const poolStats = pagePool ? pagePool.getStats() : null;
				const persistentStats = persistentPages ? persistentPages.getStats() : null;
				const payload = {
					status: 'ok',
					pid: process.pid,
					uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
					last_cycle_at: lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
					last_cycle_status: lastCycleStatus,
					last_cycle_error: lastCycleError,
					last_cycle_duration_ms: lastCycleDurationMs,
					metrics: compactMetrics,
					page_pool: poolStats,
					persistent_pages: persistentStats
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
				// Phase 7: page pool gauges
				if (pagePool) {
					const ps = pagePool.getStats();
					lines.push('# HELP scrape_page_pool_current_size Current number of pages in pool');
					lines.push('# TYPE scrape_page_pool_current_size gauge');
					lines.push(`scrape_page_pool_current_size ${ps.currentSize || 0}`);
					lines.push('# HELP scrape_page_pool_available_pages Available pages in pool');
					lines.push('# TYPE scrape_page_pool_available_pages gauge');
					lines.push(`scrape_page_pool_available_pages ${ps.availablePages || 0}`);
					lines.push('# HELP scrape_page_pool_busy_pages Busy pages in pool');
					lines.push('# TYPE scrape_page_pool_busy_pages gauge');
					lines.push(`scrape_page_pool_busy_pages ${ps.busyPages || 0}`);
					lines.push('# HELP scrape_page_pool_wait_queue_length Acquire wait queue length');
					lines.push('# TYPE scrape_page_pool_wait_queue_length gauge');
					lines.push(`scrape_page_pool_wait_queue_length ${ps.waitQueueLength || 0}`);
				}
				if (persistentPages) {
					const st = persistentPages.getStats();
					lines.push('# HELP scrape_persistent_pages_count Persistent pages tracked');
					lines.push('# TYPE scrape_persistent_pages_count gauge');
					lines.push(`scrape_persistent_pages_count ${st.count || 0}`);
				}
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
			// Check if browser needs restart before cycle
			if (shouldRestartBrowser()) {
				logDebug('Browser restart needed before cycle');
				try {
					browser = await restartBrowser();
				} catch (restartErr) {
					logDebug('Browser restart failed: ' + (restartErr && restartErr.message ? restartErr.message : restartErr));
					// Wait before retrying
					await new Promise(r => setTimeout(r, 5000));
					continue;
				}
			}
			
			lastCycleStatus = 'running';
			lastCycleError = null;
			// reset per-cycle metrics so each cycle reports its own counts
			try { resetMetrics(); } catch (e) {}
			cycleStart = Date.now();
			await runCycle(browser, outputDir);
			lastCycleAt = Date.now();
			lastCycleDurationMs = Date.now() - cycleStart;
			lastCycleStatus = 'ok';
			// Successful cycle - reset protocol timeout counter
			resetProtocolTimeoutCounter();
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
			
			// Check if this was a protocol timeout error
			if (isProtocolTimeoutError(lastCycleError)) {
				recordProtocolTimeout();
			}
			
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
        
        // Calculate dynamic sleep interval
        let sleepMs = 60000;
        try {
            const attrs = loadScraperAttributes();
            sleepMs = getDynamicCycleInterval(attrs);
			// FOR TESTING 
			sleepMs = 500;
            logDebug(`Dynamic cycle interval: ${sleepMs/1000}s`);
        } catch (e) {
            logDebug('Error calculating dynamic interval: ' + e);
        }
		await new Promise(r => setTimeout(r, sleepMs)); // sleep dynamic interval between cycles
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
		try { await shutdownScraperInfrastructure(); } catch (e) {}
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
