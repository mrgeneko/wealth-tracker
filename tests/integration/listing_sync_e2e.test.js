const http = require('http');
const path = require('path');
const mysql = require('mysql2/promise');

// Force SymbolRegistrySyncService to use tiny fixture CSVs (avoid huge real files and any network).
process.env.NASDAQ_FILE = path.join(__dirname, '../fixtures/listings/nasdaq-listed.small.csv');
process.env.NYSE_FILE = path.join(__dirname, '../fixtures/listings/nyse-listed.small.csv');
process.env.OTHER_FILE = path.join(__dirname, '../fixtures/listings/other-listed.small.csv');

const { ListingSyncService } = require('../../services/listing-sync/listing_sync_service');

function requestJson({ port, method, pathname, body }) {
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				method,
				path: pathname,
				headers: {
					...(body ? { 'Content-Type': 'application/json' } : {})
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
		if (body != null) req.write(body);
		req.end();
	});
}

async function tableExists(pool, tableName) {
	const conn = await pool.getConnection();
	try {
		const [rows] = await conn.query(
			`SELECT COUNT(*) AS c
			 FROM information_schema.tables
			 WHERE table_schema = DATABASE() AND table_name = ?`,
			[tableName]
		);
		return (rows && rows[0] && rows[0].c) ? rows[0].c > 0 : false;
	} finally {
		conn.release();
	}
}

describe('Listing Sync E2E (Phase 9)', () => {
	let pool;
	let service;
	let port;
	let skipReason = '';
	let shouldSkip = false;

	beforeAll(async () => {
		const host = process.env.DB_HOST || 'localhost';
		const user = process.env.DB_USER || 'root';
		const password = process.env.DB_PASSWORD || process.env.MYSQL_ROOT_PASSWORD || '';
		const database = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'wealth_tracker';
		const dbPort = parseInt(process.env.DB_PORT || '3306', 10);

		try {
			pool = await mysql.createPool({
				host,
				user,
				password,
				database,
				port: dbPort,
				waitForConnections: true,
				connectionLimit: 2
			});

			const requiredTables = ['ticker_registry', 'file_refresh_status', 'securities_metadata'];
			for (const t of requiredTables) {
				// eslint-disable-next-line no-await-in-loop
				const ok = await tableExists(pool, t);
				if (!ok) {
					skipReason = `missing table: ${t}`;
					shouldSkip = true;
					return;
				}
			}
		} catch (e) {
			skipReason = 'no database connection';
			shouldSkip = true;
			return;
		}

		if (shouldSkip) return;

		// Prevent any network downloads in e2e test runs.
		const downloaderStub = {
			downloadAndUpdateAll: async () => ({ skipped: true, reason: 'e2e_stub' }),
			downloadAndUpdate: async () => ({ skipped: true, reason: 'e2e_stub' })
		};

		service = new ListingSyncService({
			dbPool: pool,
			httpPort: 0,
			enableHttpApi: true,
			enableAutoSync: false,
			downloader: downloaderStub
		});
		await service.initialize();
		port = service.httpServer.address().port;
	}, 120000);

	afterAll(async () => {
		if (service) {
			await service.shutdown();
			service = null;
		}
		if (pool) {
			await pool.end();
			pool = null;
		}
	}, 120000);

	describe('end-to-end flow', () => {

		test('GET /health returns ok', async () => {
			if (shouldSkip) return;
			const resp = await requestJson({ port, method: 'GET', pathname: '/health' });
			expect(resp.status).toBe(200);
			expect(resp.body.status).toBe('ok');
			expect(resp.body.uptime).toBeGreaterThanOrEqual(0);
		});

		test('POST /sync/file/NASDAQ syncs fixture rows and /lookup can retrieve', async () => {
			if (shouldSkip) return;
			const sync = await requestJson({
				port,
				method: 'POST',
				pathname: '/sync/file/NASDAQ'
			});
			expect(sync.status).toBe(200);
			expect(sync.body.success).toBe(true);

			const lookup = await requestJson({ port, method: 'GET', pathname: '/lookup/TESTA' });
			expect(lookup.status).toBe(200);
			expect(lookup.body.ticker).toBe('TESTA');
			expect(lookup.body.exchange).toBe('NASDAQ');
		});
	});

	test('skip reason (informational)', () => {
		// This test exists to make skips visible in output.
		if (shouldSkip) {
			// eslint-disable-next-line no-console
			console.warn(`⏭️  Listing Sync E2E skipped (${skipReason})`);
		}
		expect(typeof skipReason).toBe('string');
	});
});
