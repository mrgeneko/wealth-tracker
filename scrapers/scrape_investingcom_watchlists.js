const { sanitizeForFilename, getDateTimeString, logDebug, createPreparedPage, savePageSnapshot, isProtocolTimeoutError, normalizedKey } = require('./scraper_utils');
const { publishToKafka } = require('./publish_to_kafka');
const { DateTime } = require('luxon');
const { InvestingComWatchlistController } = require('./watchlist/investingcom_watchlist_controller');
const WatchlistSyncService = require('../services/watchlist_sync_service');

let _mysqlPool = null;
const _positionMetaCache = new Map();

function getMysqlPool() {
	if (_mysqlPool) return _mysqlPool;
	try {
		const mysql = require('mysql2/promise');
		_mysqlPool = mysql.createPool({
			host: process.env.MYSQL_HOST || 'mysql',
			port: parseInt(process.env.MYSQL_PORT || '3306', 10),
			user: process.env.MYSQL_USER || 'test',
			password: process.env.MYSQL_PASSWORD || 'test',
			database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'wealth_tracker',
			waitForConnections: true,
			connectionLimit: 4,
			queueLimit: 0
		});
		return _mysqlPool;
	} catch (e) {
		logDebug(`MySQL pool init skipped (mysql2 missing or failed): ${e && e.message ? e.message : e}`);
		return null;
	}
}

async function lookupUniquePositionMeta(ticker) {
	try {
		const key = String(ticker || '').trim();
		if (!key) return null;
		if (_positionMetaCache.has(key)) return _positionMetaCache.get(key);

		const pool = getMysqlPool();
		if (!pool) {
			_positionMetaCache.set(key, null);
			return null;
		}

		// Try richer schema first (newer DBs may include these columns)
		let rows = [];
		try {
			const [r] = await pool.query(
				`SELECT DISTINCT type, source, pricing_provider, security_type
				 FROM positions
				 WHERE ticker = ? AND ticker IS NOT NULL`,
				[key]
			);
			rows = Array.isArray(r) ? r : [];
		} catch (err) {
			// Fall back to the base schema (type only)
			if (err && err.message && String(err.message).toLowerCase().includes('unknown column')) {
				const [r] = await pool.query(
					`SELECT DISTINCT type
					 FROM positions
					 WHERE ticker = ? AND ticker IS NOT NULL`,
					[key]
				);
				rows = Array.isArray(r) ? r : [];
			} else {
				throw err;
			}
		}

		// Only safe if the ticker maps to exactly one type/source.
		if (!rows || rows.length !== 1) {
			_positionMetaCache.set(key, null);
			return null;
		}

		const row = rows[0] || {};
		const meta = {
			security_type: (row.security_type || row.type || 'NOT_SET'),
			source: row.source || null,
			pricing_provider: row.pricing_provider || null
		};
		_positionMetaCache.set(key, meta);
		return meta;
	} catch (e) {
		logDebug(`lookupUniquePositionMeta(${ticker}) failed: ${e && e.message ? e.message : e}`);
		_positionMetaCache.set(String(ticker || '').trim(), null);
		return null;
	}
}

/**
 * Check if a ticker is within its update window based on update_rules config.
 * @param {string} ticker - The ticker symbol to check
 * @param {Array} updateRules - Array of update_rules from config
 * @returns {boolean} - true if ticker should be updated, false otherwise
 */
function isWithinUpdateWindow(ticker, updateRules) {
	if (!updateRules || !Array.isArray(updateRules) || updateRules.length === 0) {
		// No rules defined, allow all updates
		logDebug(`isWithinUpdateWindow(${ticker}): No updateRules defined, allowing update`);
		return true;
	}

	// Find rule for this ticker, or fall back to 'default'
	let rule = updateRules.find(r => r.key === ticker);
	if (!rule) {
		rule = updateRules.find(r => r.key === 'default');
	}
	if (!rule || !rule.update_windows || !Array.isArray(rule.update_windows)) {
		// No matching rule or no windows, allow update
		logDebug(`isWithinUpdateWindow(${ticker}): No matching rule or windows, allowing update`);
		return true;
	}

	const now = DateTime.now().setZone('America/New_York');
	const dayNames = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // 1=Monday in Luxon
	const currentDay = dayNames[now.weekday];
	const currentTimeMinutes = now.hour * 60 + now.minute;

	for (const window of rule.update_windows) {
		// Check if current day is in the window's days
		if (!window.days || !Array.isArray(window.days) || !window.days.includes(currentDay)) {
			continue;
		}

		// Parse start and end times
		const [startH, startM] = (window.start || '00:00').split(':').map(Number);
		const [endH, endM] = (window.end || '23:59').split(':').map(Number);
		const startMinutes = startH * 60 + startM;
		const endMinutes = endH * 60 + endM;

		// Check if current time is within window
		if (currentTimeMinutes >= startMinutes && currentTimeMinutes <= endMinutes) {
			logDebug(`isWithinUpdateWindow(${ticker}): WITHIN window ${window.start}-${window.end} (current: ${now.hour}:${now.minute}, ${currentTimeMinutes} mins)`);
			return true;
		}
	}

	logDebug(`isWithinUpdateWindow(${ticker}): OUTSIDE all windows (current: ${currentDay} ${now.hour}:${now.minute}, ${currentTimeMinutes} mins)`);
	return false;
}

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

function inferPricingClass(symbol) {
	// Backward-compatible fallback. Prefer DOM-based inference in the row parser below.
	try {
		const s = String(symbol || '').trim();
		if (!s) return 'US_EQUITY';
		// Avoid treating all slash symbols as crypto (XAU/USD, EUR/USD, etc.)
		return 'US_EQUITY';
	} catch (e) {
		return 'US_EQUITY';
	}
}

function inferSecurityMetaFromRow({ symbol, href, flagClass, exchange }) {
	const s = String(symbol || '').trim();
	const hrefLower = String(href || '').trim().toLowerCase();
	const exchangeLower = String(exchange || '').trim().toLowerCase();
	const cls = String(flagClass || '')
		.split(/\s+/)
		.map(c => c.trim().toLowerCase())
		.filter(Boolean);

	// ceFlags <token> where token is a country code (USA) or an icon slug (bitcoin, gold, etc.)
	const iconToken = cls.find(c => c !== 'ceflags' && c !== 'middle' && c !== 'inlineblock') || null;

	const cryptoIconTokens = new Set([
		'bitcoin', 'tether', 'ethereum', 'solana', 'dogecoin', 'xrp', 'litecoin', 'cardano', 'binance',
		'polkadot', 'polygon', 'avalanche', 'chainlink', 'tron', 'stellar', 'monero', 'uniswap'
	]);

	// 1) Crypto: Investing.com renders crypto pairs with crypto icon tokens (bitcoin/tether/etc.).
	if (iconToken && cryptoIconTokens.has(iconToken)) {
		return {
			security_type: 'crypto',
			pricing_class: 'CRYPTO_INVESTING',
			position_source: 'CRYPTO_INVESTING_FILE'
		};
	}

	// 1b) Crypto fallback: exchange column sometimes shows "Investing.com" for crypto pairs.
	// Use this only as a secondary signal to avoid misclassifying indices.
	if ((exchangeLower === 'investing.com' || exchangeLower === 'investing') && s.includes('/')) {
		return {
			security_type: 'crypto',
			pricing_class: 'CRYPTO_INVESTING',
			position_source: 'CRYPTO_INVESTING_FILE'
		};
	}

	// 2) Bonds
	if (hrefLower.startsWith('/bonds/')) {
		return { security_type: 'bond', pricing_class: 'US_TREASURY' };
	}

	// 3) ETFs vs equities
	if (hrefLower.startsWith('/etfs/')) {
		return { security_type: 'etf', pricing_class: 'US_EQUITY' };
	}
	if (hrefLower.startsWith('/equities/')) {
		return { security_type: 'stock', pricing_class: 'US_EQUITY' };
	}

	// 4) Currencies / other slash instruments (FX, metals, etc.)
	if (hrefLower.startsWith('/currencies/') || (s && s.includes('/'))) {
		return { security_type: 'other', pricing_class: 'US_EQUITY' };
	}

	return { security_type: 'NOT_SET', pricing_class: 'US_EQUITY' };
}

async function scrapeInvestingComWatchlists(browser, watchlist, outputDir, updateRules = null, updateWindowService = null) {
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

		// Initialize Controller
		const controller = new InvestingComWatchlistController(browser);

		// Initialize (Login + Navigate)
		await controller.initialize(investingUrl);
		page = controller.page; // Use the controller's page for consistency

		// Perform Sync
		try {
			logDebug('[Sync] Starting Watchlist Sync...');
			const pool = getMysqlPool();
			if (pool) {
				const syncService = new WatchlistSyncService(pool);
				await syncService.sync(controller);
			} else {
				logDebug('[Sync] MySQL pool not available, skipping sync.');
			}
		} catch (syncErr) {
			logDebug('[Sync] Error during sync: ' + (syncErr && syncErr.message ? syncErr.message : syncErr));
			// Continue with scraping even if sync fails
		}

		// Proceed with scraping logic (page is already at the watchlist URL or close to it)
		// Ensure we are on the correct tab
		if (watchlist.key) {
			await controller.switchToTab(watchlist.key);
		}

		logDebug('Watchlist table loaded.');

		const snapshotBase = require('path').join(outputDir, `${dateTimeString}.investingcom_watchlist.${safeWatchlistKey}`);
		const fullPageHtml = await savePageSnapshot(page, snapshotBase);
		logDebug(`Saved snapshot to ${snapshotBase}`);

		const cheerio = require('cheerio');
		const $ = cheerio.load(fullPageHtml);
		const requiredColumns = ["symbol", "name", "exchange", "last", "bid", "ask", "extended_hours", "extended_hours_percent", "open", "prev", "high", "low", "chg", "chgpercent", "vol", "next_earning", "time"];
		const table = $('[id^="tbody_overview_"]').first();
		const dataObjects = [];

		if (table.length) {
			const { getPricingClass, normalizePricingClass } = require('../services/pricing-utils');
			const rows = table.find('tr').toArray();
			for (const row of rows) {
				const rowData = {};
				$(row).find('td').each((j, col) => {
					const columnName = $(col).attr('data-column-name');
					if (requiredColumns.includes(columnName)) {
						rowData[columnName] = $(col).text().trim();
						if (columnName === 'time') rowData['time_value'] = $(col).attr('data-value');
					}
				});

				if (rowData["symbol"] || rowData["name"]) {
					// Fallback for Crypto tables where "symbol" column is empty but "name" has the pair (e.g. ETH/USD)
					const rawSymbol = rowData["symbol"] || rowData["name"];

					// Re-select proper anchor if original symbol column was empty
					let symbolAnchor = $(row).find('td[data-column-name="symbol"] a').first();
					if (!symbolAnchor.length || !symbolAnchor.attr('href')) {
						symbolAnchor = $(row).find('td[data-column-name="name"] a').first();
					}

					const href = symbolAnchor.attr('href') || '';
					const flagClass = $(row).find('td.flag span.ceFlags').attr('class') || '';
					const inferred = inferSecurityMetaFromRow({
						symbol: rawSymbol,
						href,
						flagClass,
						exchange: rowData["exchange"]
					});
					let securityType = inferred.security_type || 'NOT_SET';
					let pricingClass = inferred.pricing_class || 'US_EQUITY';
					let positionSource = inferred.position_source || null;

					// Optional MySQL-assisted fallback: if ticker is unique in positions, align keys to positions.
					// This helps when Investing.com structure changes or when tickers overlap across types.
					try {
						const meta = await lookupUniquePositionMeta(rawSymbol);
						if (meta && meta.security_type) {
							securityType = meta.security_type;
							positionSource = meta.source || positionSource;
							pricingClass = getPricingClass({
								source: meta.source,
								pricingProvider: meta.pricing_provider,
								securityType: meta.security_type
							});
						}
					} catch (e) {
						// ignore lookup errors; keep inferred values
					}

					pricingClass = normalizePricingClass(pricingClass);
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

					// Determine extended_hours_time based on current time
					let extendedHoursQuoteTime = null;
					const now = DateTime.now().setZone('America/New_York');
					const dayOfWeek = now.weekday; // 1 is Monday, 7 is Sunday
					const hour = now.hour;
					const minute = now.minute;

					// Check if it's Monday through Friday (1-5)
					if (dayOfWeek >= 1 && dayOfWeek <= 5) {
						// Pre-market: 4:00 AM to 9:30 AM
						const isPreMarket = (hour > 4 || (hour === 4 && minute >= 0)) && (hour < 9 || (hour === 9 && minute < 30));
						// After-hours: 4:00 PM to 8:00 PM
						const isAfterHours = (hour >= 16 && hour < 20);

						if (isPreMarket || isAfterHours) {
							extendedHoursQuoteTime = new Date().toISOString();
						} else {
							// From 8pm to 4am, extended_hours_time may not be populated.
						}
					}

					dataObjects.push({
						key: rawSymbol,
						normalized_key: normalizedKey(rawSymbol),
						// Persist with a deterministic composite key in latest_prices.
						// Use DOM-based inference (flag icon + href) and optionally align to positions when unambiguous.
						security_type: securityType,
						pricing_class: pricingClass,
						position_source: positionSource,
						regular_price: rowData["last"],
						regular_change_decimal: rowData["chg"],
						regular_change_percent: rowData["chgpercent"],
						regular_time: qTime,
						extended_hours_price: rowData["extended_hours"] || null,
						extended_hours_change: extendedHoursChange,
						extended_hours_change_percent: rowData["extended_hours_percent"] || null,
						extended_hours_time: extendedHoursQuoteTime,
						source: "investing",
						previous_close_price: rowData["prev"],
						capture_time: new Date().toISOString()
					});
				}
			}
			logDebug(`Total valid stock rows found: ${dataObjects.length}`);
		} else {
			logDebug("No table found in the HTML.");
		}

		const outPath = require('path').join(outputDir, `${dateTimeString}.investingcom_watchlist.${safeWatchlistKey}.json`);
		require('fs').writeFileSync(outPath, JSON.stringify(dataObjects, null, 2), 'utf-8');
		logDebug(`Parsed data written to ${outPath}`);

		const kafkaTopic = process.env.KAFKA_TOPIC || 'investingcom_watchlist';
		const kafkaBrokers = (process.env.KAFKA_BROKERS || 'localhost:9094').split(',');

		// Filter tickers based on DB-backed update windows (preferred) or legacy update_rules before publishing to Kafka
		let publishCount = 0;
		let skippedCount = 0;
		for (const sec of dataObjects) {
			let allowed = true;
			try {
				if (updateWindowService && typeof updateWindowService.isWithinUpdateWindow === 'function') {
					const decision = await updateWindowService.isWithinUpdateWindow(sec.key, 'investingcom', watchlist.key);
					allowed = decision && decision.allowed !== false;
				} else {
					allowed = isWithinUpdateWindow(sec.key, updateRules);
				}
			} catch (e) {
				// Fail open: publish if update window checks error
				allowed = true;
				logDebug(`Update window check failed for ${sec.key}: ${e && e.message ? e.message : e}`);
			}

			if (allowed) {
				publishToKafka(sec, kafkaTopic, kafkaBrokers).catch(e => logDebug('Kafka publish error: ' + e));
				publishCount++;
			} else {
				skippedCount++;
				logDebug(`Skipping ${sec.key} - outside update window`);
			}
		}
		logDebug(`Published ${publishCount} tickers, skipped ${skippedCount} (outside update window)`);
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

		// Re-throw protocol timeout errors so the main daemon can trigger browser restart
		if (isProtocolTimeoutError(err)) {
			throw err;
		}
	}
}

module.exports = { scrapeInvestingComWatchlists };
