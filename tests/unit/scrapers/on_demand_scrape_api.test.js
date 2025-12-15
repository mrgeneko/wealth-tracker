const { EventEmitter } = require('events');
const { OnDemandScrapeApi } = require('../../../scrapers/on_demand_scrape_api');

function makeReq({ method = 'POST', url = '/scrape', body = '{}' }) {
	const req = new EventEmitter();
	req.method = method;
	req.url = url;
	process.nextTick(() => {
		if (body !== null && body !== undefined) {
			req.emit('data', Buffer.from(String(body)));
		}
		req.emit('end');
	});
	return req;
}

function makeRes() {
	const res = new EventEmitter();
	res.statusCode = null;
	res.headers = {};
	res.body = '';
	res.writeHead = (code, headers = {}) => {
		res.statusCode = code;
		res.headers = { ...res.headers, ...headers };
	};
	res.end = (chunk = '') => {
		res.body += String(chunk);
		res.emit('finish');
	};
	return res;
}

function awaitFinish(res) {
	return new Promise(resolve => res.on('finish', resolve));
}

describe('OnDemandScrapeApi (Phase 8)', () => {
	test('returns 200 with results for valid request', async () => {
		const api = new OnDemandScrapeApi({
			limits: { google: { maxTickersPerMinute: 10, maxConcurrent: 2 } },
			maxTickersPerRequest: 25,
			nowFn: () => 1000
		});

		const pagePool = {
			config: { poolSize: 2 },
			acquire: jest.fn().mockResolvedValue({ page: {}, release: jest.fn().mockResolvedValue(undefined) })
		};

		const getConstructibleUrls = jest.fn().mockResolvedValue([{ source: 'google', url: 'https://example.com' }]);
		const scrapeGoogleWithPage = jest.fn().mockResolvedValue({ regular_price: '123.45' });

		const req = makeReq({ body: JSON.stringify({ tickers: ['aapl', ' msft '], source: 'google' }) });
		const res = makeRes();

		await api.handle(req, res, { pagePool, getConstructibleUrls, scrapeGoogleWithPage, outputDir: '/tmp' });
		await awaitFinish(res);

		expect(res.statusCode).toBe(200);
		const payload = JSON.parse(res.body);
		expect(payload.success).toBe(true);
		expect(payload.results.AAPL.success).toBe(true);
		expect(payload.results.MSFT.price).toBe('123.45');
		expect(pagePool.acquire).toHaveBeenCalledTimes(2);
	});

	test('returns 400 for invalid JSON body', async () => {
		const api = new OnDemandScrapeApi({ limits: { google: { maxTickersPerMinute: 10, maxConcurrent: 1 } }, nowFn: () => 1000 });
		const req = makeReq({ body: '{not-json' });
		const res = makeRes();

		await api.handle(req, res, { pagePool: {}, getConstructibleUrls: jest.fn(), scrapeGoogleWithPage: jest.fn() });
		await awaitFinish(res);

		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('invalid_json');
	});

	test('returns 429 when per-source minute limit exceeded and includes Retry-After', async () => {
		let now = 0;
		const api = new OnDemandScrapeApi({
			limits: {
				google: { maxTickersPerMinute: 2, maxConcurrent: 2 },
				marketwatch: { maxTickersPerMinute: 2, maxConcurrent: 2 }
			},
			nowFn: () => now,
			maxTickersPerRequest: 25
		});

		const ctx = {
			pagePool: { config: { poolSize: 2 }, acquire: jest.fn().mockResolvedValue({ page: {}, release: jest.fn().mockResolvedValue(undefined) }) },
			getConstructibleUrls: jest.fn().mockResolvedValue([{ source: 'google', url: 'https://example.com' }]),
			scrapeGoogleWithPage: jest.fn().mockResolvedValue({ regular_price: '1.00' }),
			outputDir: '/tmp'
		};

		// First request consumes 2 units
		const req1 = makeReq({ body: JSON.stringify({ tickers: ['A', 'B'], source: 'google' }) });
		const res1 = makeRes();
		await api.handle(req1, res1, ctx);
		await awaitFinish(res1);
		expect(res1.statusCode).toBe(200);

		// Second request within same window should 429
		now = 1000;
		const req2 = makeReq({ body: JSON.stringify({ tickers: ['C'], source: 'google' }) });
		const res2 = makeRes();
		await api.handle(req2, res2, ctx);
		await awaitFinish(res2);

		expect(res2.statusCode).toBe(429);
		const body = JSON.parse(res2.body);
		expect(body.error).toBe('rate_limited');
		expect(body.source).toBe('google');
		expect(res2.headers['Retry-After']).toBeTruthy();

		// Separate source should not be affected
		const req3 = makeReq({ body: JSON.stringify({ tickers: ['X'], source: 'marketwatch' }) });
		const res3 = makeRes();
		await api.handle(req3, res3, ctx);
		await awaitFinish(res3);
		expect([200, 500]).toContain(res3.statusCode); // marketwatch unsupported in scraper implementation
	});

	test('returns 429 when maxConcurrent exceeded (fail fast)', async () => {
		let now = 0;
		const api = new OnDemandScrapeApi({ limits: { google: { maxTickersPerMinute: 10, maxConcurrent: 1 } }, nowFn: () => now });

		let release1;
		const deferred = {};
		deferred.promise = new Promise(resolve => { deferred.resolve = resolve; });

		const ctx = {
			pagePool: { config: { poolSize: 1 }, acquire: jest.fn().mockResolvedValue({ page: {}, release: jest.fn().mockImplementation(async () => { if (release1) await release1(); }) }) },
			getConstructibleUrls: jest.fn().mockResolvedValue([{ source: 'google', url: 'https://example.com' }]),
			scrapeGoogleWithPage: jest.fn().mockImplementation(async () => deferred.promise),
			outputDir: '/tmp'
		};

		const req1 = makeReq({ body: JSON.stringify({ tickers: ['A'], source: 'google' }) });
		const res1 = makeRes();
		await api.handle(req1, res1, ctx);

		// Immediately issue another request before resolving first
		const req2 = makeReq({ body: JSON.stringify({ tickers: ['B'], source: 'google' }) });
		const res2 = makeRes();
		await api.handle(req2, res2, ctx);
		await awaitFinish(res2);

		expect(res2.statusCode).toBe(429);

		// complete first
		deferred.resolve({ regular_price: '1.00' });
		await awaitFinish(res1);
		expect(res1.statusCode).toBe(200);
	});

	test('returns 400 too_many_tickers when request exceeds cap', async () => {
		const api = new OnDemandScrapeApi({ limits: { google: { maxTickersPerMinute: 999, maxConcurrent: 1 } }, maxTickersPerRequest: 2, nowFn: () => 0 });
		const req = makeReq({ body: JSON.stringify({ tickers: ['A', 'B', 'C'], source: 'google' }) });
		const res = makeRes();

		await api.handle(req, res, { pagePool: {}, getConstructibleUrls: jest.fn(), scrapeGoogleWithPage: jest.fn() });
		await awaitFinish(res);

		expect(res.statusCode).toBe(400);
		expect(JSON.parse(res.body).error).toBe('too_many_tickers');
	});
});
