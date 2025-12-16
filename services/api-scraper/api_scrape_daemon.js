const fs = require('fs');
const http = require('http');
const path = require('path');
const mysql = require('mysql2/promise');

const { scrapeYahooBatch } = require('../../scrapers/scrape_yahoo');
const { normalizedKey } = require('../../scrapers/scraper_utils');

function log(msg) {
	const ts = new Date().toISOString();
	process.stdout.write(`[api-scraper ${ts}] ${msg}\n`);
}

function resolveDir({ envName, fallbackCandidates }) {
	const v = process.env[envName];
	if (v) return v;
	for (const candidate of fallbackCandidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch (e) {}
	}
	return fallbackCandidates[fallbackCandidates.length - 1];
}

const CONFIG_DIR = resolveDir({
	envName: 'CONFIG_DIR',
	fallbackCandidates: [
		path.join(process.cwd(), 'config'),
		path.join('/usr/src/app', 'config')
	]
});

const DATA_DIR = resolveDir({
	envName: 'DATA_DIR',
	fallbackCandidates: [
		path.join(process.cwd(), 'data'),
		path.join('/usr/src/app', 'data')
	]
});

const LOG_DIR = resolveDir({
	envName: 'LOG_DIR',
	fallbackCandidates: [
		path.join(process.cwd(), 'logs'),
		path.join('/usr/src/app', 'logs')
	]
});

const ATTR_PATH = process.env.CONFIG_PATH || path.join(CONFIG_DIR, 'config.json');

let cachedAttrs = null;
let cachedMtime = 0;

function loadAttributes() {
	try {
		const st = fs.statSync(ATTR_PATH);
		const mtime = st && st.mtimeMs ? st.mtimeMs : 0;
		if (cachedAttrs && cachedMtime === mtime) return cachedAttrs;
		const txt = fs.readFileSync(ATTR_PATH, 'utf8');
		cachedAttrs = JSON.parse(txt) || {};
		cachedMtime = mtime;
		return cachedAttrs;
	} catch (e) {
		return cachedAttrs || {};
	}
}

function getScrapeGroupSettings(groupName, defaultIntervalSeconds) {
	const attrs = loadAttributes();
	const groups = attrs && attrs.scrape_groups ? attrs.scrape_groups : {};
	let interval = defaultIntervalSeconds;
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

function shouldRunTask(settings, markerPath) {
	if (!settings.enabled) return false;
	const intervalSeconds = settings.interval;

	let lastRun = 0;
	try {
		if (fs.existsSync(markerPath)) {
			const lines = fs.readFileSync(markerPath, 'utf8').split('\n');
			lastRun = parseInt(lines[0], 10);
		}
	} catch (e) {}

	const now = Date.now();
	if (now - lastRun >= intervalSeconds * 1000) {
		const human = new Date(now).toLocaleString('en-US', { hour12: false });
		try { fs.mkdirSync(path.dirname(markerPath), { recursive: true }); } catch (e) {}
		fs.writeFileSync(markerPath, now.toString() + '\n' + human + '\n');
		return true;
	}
	return false;
}

let mysqlPool = null;
function getMysqlPool() {
	if (!mysqlPool) {
		mysqlPool = mysql.createPool({
			host: process.env.MYSQL_HOST || 'mysql',
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

async function fetchStockPositions() {
	try {
		const pool = getMysqlPool();
		const [rows] = await pool.query(
			"SELECT DISTINCT ticker, type FROM positions WHERE type IN ('stock', 'etf') AND ticker IS NOT NULL AND ticker != ''"
		);
		return rows.map(r => ({
			ticker: r.ticker,
			type: r.type,
			normalized_key: (r && r.normalized_key) ? r.normalized_key : normalizedKey(r.ticker)
		}));
	} catch (e) {
		log('Error fetching stock positions from MySQL: ' + (e && e.message ? e.message : e));
		return [];
	}
}

const state = {
	startedAt: Date.now(),
	lastYahooBatchAt: null,
	lastYahooBatchCount: 0,
	lastYahooBatchError: null
};

async function runYahooBatch(outputDir) {
	const positions = await fetchStockPositions();
	const tickers = positions.map(p => p.ticker).filter(Boolean);
	log(`Found ${tickers.length} stock/etf positions for Yahoo batch`);

	const yahooSecurities = tickers.map(ticker => ({
		key: ticker,
		ticker,
		ticker_yahoo: ticker
	}));

	if (!yahooSecurities.length) {
		state.lastYahooBatchAt = Date.now();
		state.lastYahooBatchCount = 0;
		state.lastYahooBatchError = null;
		return;
	}

	try {
		const results = await scrapeYahooBatch(null, yahooSecurities, outputDir, { chunkSize: 50, delayMs: 500 });
		state.lastYahooBatchAt = Date.now();
		state.lastYahooBatchCount = Array.isArray(results) ? results.length : 0;
		state.lastYahooBatchError = null;
		log(`Yahoo batch completed: ${state.lastYahooBatchCount} results`);
	} catch (e) {
		state.lastYahooBatchAt = Date.now();
		state.lastYahooBatchCount = 0;
		state.lastYahooBatchError = (e && e.message) ? e.message : String(e);
		log('Yahoo batch error: ' + state.lastYahooBatchError);
	}
}

function startHealthServer() {
	const port = parseInt(process.env.API_SCRAPER_HEALTH_PORT || '3020', 10);
	const server = http.createServer((req, res) => {
		if (req.url === '/health') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ok: true }));
			return;
		}
		if (req.url === '/status') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({
				ok: true,
				uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
				lastYahooBatchAt: state.lastYahooBatchAt,
				lastYahooBatchCount: state.lastYahooBatchCount,
				lastYahooBatchError: state.lastYahooBatchError
			}));
			return;
		}
		res.writeHead(404, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: 'not_found' }));
	});

	server.listen(port, () => {
		log(`Health server listening on ${port}`);
	});
	return server;
}

async function main() {
	log('Starting API scraper daemon');
	log(`CONFIG_DIR=${CONFIG_DIR} ATTR_PATH=${ATTR_PATH}`);
	log(`DATA_DIR=${DATA_DIR} LOG_DIR=${LOG_DIR}`);

	const outputDir = process.env.OUTPUT_DIR || path.join(DATA_DIR, 'scraper_output');
	try { fs.mkdirSync(outputDir, { recursive: true }); } catch (e) {}

	const healthServer = startHealthServer();

	const markerPath = path.join(LOG_DIR, 'last.yahoo_batch.txt');

	let stopped = false;
	async function tick() {
		if (stopped) return;
		const yahooSettings = getScrapeGroupSettings('yahoo_batch', 2700);
		if (shouldRunTask(yahooSettings, markerPath)) {
			log('Begin yahoo_batch');
			await runYahooBatch(outputDir);
		}
	}

	// Run once immediately, then on interval.
	await tick();
	const timer = setInterval(() => { tick().catch(e => log('Tick error: ' + (e && e.message ? e.message : e))); }, 1000);

	async function shutdown(signal) {
		if (stopped) return;
		stopped = true;
		log(`Shutting down (${signal})`);
		clearInterval(timer);
		try { healthServer.close(); } catch (e) {}
		try { if (mysqlPool) await mysqlPool.end(); } catch (e) {}
		process.exit(0);
	}

	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
	main().catch((e) => {
		log('Fatal error: ' + (e && e.stack ? e.stack : e));
		process.exit(1);
	});
}
