const http = require('http');

const { OnDemandScrapeApi } = require('../../../scrapers/on_demand_scrape_api');

function requestJson({ port, method, path, body }) {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				method,
				path,
				headers: {
					'Content-Type': 'application/json'
				}
			},
			(res) => {
				let data = '';
				res.setEncoding('utf8');
				res.on('data', (c) => { data += c; });
				res.on('end', () => {
					let parsed = null;
					try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
					resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw: data });
				});
			}
		);

		req.on('error', reject);
		if (body != null) {
			req.write(body);
		}
		req.end();
	});
}

describe('On-demand scrape HTTP integration (Phase 9)', () => {
	let server;
	let port;

	beforeEach(async () => {
		const api = new OnDemandScrapeApi({
			limits: {
				google: { maxTickersPerMinute: 2, maxConcurrent: 1 },
				marketwatch: { maxTickersPerMinute: 2, maxConcurrent: 1 }
			}
		});

		const ctx = {
			pagePool: {
				config: { poolSize: 2 },
				acquire: async () => ({ page: {}, release: async () => {} })
			},
			outputDir: '/tmp',
			getConstructibleUrls: async (ticker) => ([{ source: 'google', url: `https://example.com/${ticker}` }]),
			scrapeGoogleWithPage: async () => ({ regular_price: '123.45' })
		};

		server = http.createServer(async (req, res) => {
			const handled = await api.handle(req, res, ctx);
			if (!handled) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'not found' }));
			}
		});

		await new Promise((resolve) => server.listen(0, resolve));
		port = server.address().port;
	});

	afterEach(async () => {
		if (!server) return;
		await new Promise((resolve) => server.close(resolve));
		server = undefined;
		port = undefined;
	});

	test('POST /scrape returns 200 with results', async () => {
		const resp = await requestJson({
			port,
			method: 'POST',
			path: '/scrape',
			body: JSON.stringify({ tickers: ['AAPL'], source: 'google' })
		});

		expect(resp.status).toBe(200);
		expect(resp.body.success).toBe(true);
		expect(resp.body.results.AAPL.success).toBe(true);
		expect(resp.body.results.AAPL.price).toBe('123.45');
	});

	test('POST /scrape returns 400 on invalid JSON', async () => {
		const resp = await requestJson({
			port,
			method: 'POST',
			path: '/scrape',
			body: '{'
		});

		expect(resp.status).toBe(400);
		expect(resp.body).toEqual({ error: 'invalid_json' });
	});

	test('POST /scrape rate limits and sets Retry-After', async () => {
		// Limit is 2 tickers per minute; first request consumes both.
		const ok = await requestJson({
			port,
			method: 'POST',
			path: '/scrape',
			body: JSON.stringify({ tickers: ['AAPL', 'MSFT'], source: 'google' })
		});
		expect(ok.status).toBe(200);

		const limited = await requestJson({
			port,
			method: 'POST',
			path: '/scrape',
			body: JSON.stringify({ tickers: ['GOOG'], source: 'google' })
		});

		expect(limited.status).toBe(429);
		expect(limited.body.error).toBe('rate_limited');
		expect(limited.headers['retry-after']).toBeTruthy();
	});
});
