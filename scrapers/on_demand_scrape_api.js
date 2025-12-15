const { EventEmitter } = require('events');

const DEFAULT_ON_DEMAND_LIMITS = {
	google: { maxTickersPerMinute: 60, maxConcurrent: 4 },
	marketwatch: { maxTickersPerMinute: 30, maxConcurrent: 2 }
};

function safeJsonParse(text) {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		return { ok: false, error: e };
	}
}

function normalizeTickers(tickers) {
	if (!Array.isArray(tickers)) return null;
	return tickers
		.filter(t => typeof t === 'string')
		.map(t => t.trim())
		.filter(Boolean)
		.map(t => t.toUpperCase());
}

class OnDemandScrapeApi {
	constructor(options = {}) {
		this.limits = options.limits || DEFAULT_ON_DEMAND_LIMITS;
		this.maxTickersPerRequest = Number.isFinite(options.maxTickersPerRequest)
			? options.maxTickersPerRequest
			: 25;
		this.nowFn = options.nowFn || (() => Date.now());

		// state[source] = { windowStartMs, usedInWindow, activeRequests }
		this.state = new Map();
	}

	_getState(source, now) {
		if (!this.state.has(source)) {
			this.state.set(source, { windowStartMs: now, usedInWindow: 0, activeRequests: 0 });
		}
		const st = this.state.get(source);
		if ((now - st.windowStartMs) >= 60000) {
			st.windowStartMs = now;
			st.usedInWindow = 0;
		}
		return st;
	}

	_rateLimitResponse(source, limits, retryAfterMs) {
		const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
		return {
			status: 429,
			headers: {
				'Content-Type': 'application/json',
				'Retry-After': String(retryAfterSeconds)
			},
			body: {
				error: 'rate_limited',
				source,
				retryAfterMs,
				limits: {
					maxTickersPerMinute: limits.maxTickersPerMinute,
					maxConcurrent: limits.maxConcurrent
				}
			}
		};
	}

	async handle(req, res, ctx) {
		if (!req || !res) return false;
		if (!(req instanceof EventEmitter)) {
			// Allow basic duck-typing in tests.
		}
		if (req.method !== 'POST' || !req.url || !req.url.startsWith('/scrape')) {
			return false;
		}

		let rawBody = '';
		req.on('data', chunk => { rawBody += chunk; });
		req.on('end', async () => {
			try {
				const parsed = safeJsonParse(rawBody || '{}');
				if (!parsed.ok) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'invalid_json' }));
					return;
				}

				const payload = parsed.value || {};
				const tickers = normalizeTickers(payload.tickers);
				if (!tickers) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'tickers array required' }));
					return;
				}
				if (tickers.length > this.maxTickersPerRequest) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'too_many_tickers' }));
					return;
				}

				const source = String(payload.source || 'google').toLowerCase();
				const limits = this.limits[source];
				if (!limits) {
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ error: 'unsupported_source', source }));
					return;
				}

				// Rate limiting (per source)
				const now = this.nowFn();
				const st = this._getState(source, now);

				if (st.activeRequests >= limits.maxConcurrent) {
					const retryAfterMs = 1000;
					const rl = this._rateLimitResponse(source, limits, retryAfterMs);
					res.writeHead(rl.status, rl.headers);
					res.end(JSON.stringify(rl.body));
					return;
				}

				const remainingWindowMs = 60000 - (now - st.windowStartMs);
				if ((st.usedInWindow + tickers.length) > limits.maxTickersPerMinute) {
					const rl = this._rateLimitResponse(source, limits, remainingWindowMs);
					res.writeHead(rl.status, rl.headers);
					res.end(JSON.stringify(rl.body));
					return;
				}

				// Accept request
				st.usedInWindow += tickers.length;
				st.activeRequests += 1;

				try {
					const results = await this._scrape(ctx, tickers, source);
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: true, results }));
				} finally {
					st.activeRequests = Math.max(0, st.activeRequests - 1);
				}
			} catch (error) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: error && error.message ? error.message : String(error) }));
			}
		});

		return true;
	}

	async _scrape(ctx, tickers, source) {
		const pagePool = ctx && ctx.pagePool ? ctx.pagePool : null;
		const outputDir = ctx && ctx.outputDir ? ctx.outputDir : '/usr/src/app/logs';
		const getConstructibleUrls = ctx && ctx.getConstructibleUrls ? ctx.getConstructibleUrls : null;
		const scrapeGoogleWithPage = ctx && ctx.scrapeGoogleWithPage ? ctx.scrapeGoogleWithPage : null;

		if (!pagePool) {
			throw new Error('PagePool not available');
		}
		if (source !== 'google') {
			throw new Error(`Unsupported source for on-demand browser scrape: ${source}`);
		}
		if (typeof getConstructibleUrls !== 'function') {
			throw new Error('getConstructibleUrls not available');
		}
		if (typeof scrapeGoogleWithPage !== 'function') {
			throw new Error('scrapeGoogleWithPage not available');
		}

		const concurrency = Math.max(1, Math.min(pagePool.config ? pagePool.config.poolSize : 1, this.limits.google.maxConcurrent));
		const results = {};

		for (let i = 0; i < tickers.length; i += concurrency) {
			const batch = tickers.slice(i, i + concurrency);
			const batchPromises = batch.map(async (ticker) => {
				let release = null;
				try {
					const urls = await getConstructibleUrls(ticker, 'stock');
					const entry = Array.isArray(urls) ? urls.find(u => u && u.source === 'google') : null;
					if (!entry || !entry.url) {
						results[ticker] = { success: false, error: 'not found', source: 'google' };
						return;
					}

					const acquired = await pagePool.acquire(ticker);
					release = acquired.release;
					const data = await scrapeGoogleWithPage(acquired.page, { key: ticker, google: entry.url }, outputDir);

					const price = (data && (data.regular_price || data.after_hours_price || data.pre_market_price))
						? String(data.regular_price || data.after_hours_price || data.pre_market_price)
						: null;

					if (price) {
						results[ticker] = { success: true, price, source: 'google' };
					} else {
						results[ticker] = { success: false, error: 'price_not_found', source: 'google' };
					}
				} catch (e) {
					results[ticker] = { success: false, error: e && e.message ? e.message : String(e), source: 'google' };
				} finally {
					if (release) {
						try { await release(); } catch (e) {}
					}
				}
			});

			await Promise.all(batchPromises);
		}

		return results;
	}
}

module.exports = { OnDemandScrapeApi, DEFAULT_ON_DEMAND_LIMITS };
