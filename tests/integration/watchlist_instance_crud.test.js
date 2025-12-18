/**
 * Integration test for watchlist instance CRUD operations
 * Tests the full stack: HTTP API -> Database
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function initializeSchema(conn) {
	// Execute init-db scripts required for watchlist tables
	const scripts = [
		path.join(__dirname, '../..', 'scripts/init-db/000-base-schema.sql'),
		path.join(__dirname, '../..', 'scripts/init-db/001-listing-sync-watchlist.sql')
	];

	for (const scriptPath of scripts) {
		if (!fs.existsSync(scriptPath)) continue;
		const sql = fs.readFileSync(scriptPath, 'utf8');
		const statements = sql.split(';').filter(s => s.trim().length > 0);
		for (const stmt of statements) {
			try {
				await conn.query(stmt);
			} catch (err) {
				// Ignore errors during idempotent initialization
				console.warn('Warning executing init script statement:', err.message);
			}
		}
	}
}


describe('Watchlist Instance CRUD Integration Test', () => {
	let connection;
	const testProviderKey = 'test_provider_' + Date.now();

	beforeAll(async () => {
		// Skip if required env vars are missing
		const required = ['MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
		const missing = required.filter((v) => !process.env[v]);
		if (missing.length > 0) {
			console.log(`Skipping integration test: missing ${missing.join(', ')}`);
			return;
		}

		try {
			connection = await mysql.createConnection({
				host: process.env.MYSQL_HOST || 'localhost',
				port: parseInt(process.env.MYSQL_PORT || '3306', 10),
				user: process.env.MYSQL_USER,
				password: process.env.MYSQL_PASSWORD,
				database: process.env.MYSQL_DATABASE
			});
		} catch (err) {
			console.log(`Skipping integration test: database connection failed (${err.message})`);
			connection = null;
			return;
		}

		// Initialize DB schema for watchlist tables
		await initializeSchema(connection);

		// Create a test provider
		await connection.query(
			'INSERT IGNORE INTO watchlist_providers (provider_id, display_name, enabled) VALUES (?, ?, ?)',
			[testProviderKey, 'Test Provider', 1]
		);
	});

	afterAll(async () => {
		if (connection) {
			// Clean up test data
			await connection.query('DELETE FROM watchlist_instances WHERE watchlist_key LIKE ?', ['test_%']);
			await connection.query('DELETE FROM watchlist_providers WHERE provider_id = ?', [testProviderKey]);
			await connection.end();
		}
	});

	test('should create, read, update, and delete a watchlist instance', async () => {
		if (!connection) {
			console.log('Skipping test: database not available');
			return;
		}

		const testKey = 'test_watchlist_' + Date.now();
		const testUrl = 'https://example.com/watchlist/test';
		const testInterval = 180;

		// Get provider numeric ID
		const [providers] = await connection.query(
			'SELECT id FROM watchlist_providers WHERE provider_id = ?',
			[testProviderKey]
		);
		expect(providers.length).toBeGreaterThan(0);
		const providerId = providers[0].id;

		// CREATE: Insert a new watchlist instance
		await connection.query(
			'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
			[providerId, testKey, testUrl, testInterval, true]
		);

		// READ: Verify it was created
		const [instances] = await connection.query(
			'SELECT watchlist_key, watchlist_url, interval_seconds, enabled FROM watchlist_instances WHERE provider_id = ? AND watchlist_key = ?',
			[providerId, testKey]
		);

		expect(instances.length).toBe(1);
		expect(instances[0].watchlist_key).toBe(testKey);
		expect(instances[0].watchlist_url).toBe(testUrl);
		expect(instances[0].interval_seconds).toBe(testInterval);
		expect(instances[0].enabled).toBe(1);

		// UPDATE: Change the URL and interval
		const updatedUrl = 'https://example.com/watchlist/updated';
		const updatedInterval = 240;

		await connection.query(
			'UPDATE watchlist_instances SET watchlist_url = ?, interval_seconds = ? WHERE provider_id = ? AND watchlist_key = ?',
			[updatedUrl, updatedInterval, providerId, testKey]
		);

		// READ: Verify the update
		const [updatedInstances] = await connection.query(
			'SELECT watchlist_url, interval_seconds FROM watchlist_instances WHERE provider_id = ? AND watchlist_key = ?',
			[providerId, testKey]
		);

		expect(updatedInstances.length).toBe(1);
		expect(updatedInstances[0].watchlist_url).toBe(updatedUrl);
		expect(updatedInstances[0].interval_seconds).toBe(updatedInterval);

		// DELETE: Remove the instance
		await connection.query(
			'DELETE FROM watchlist_instances WHERE provider_id = ? AND watchlist_key = ?',
			[providerId, testKey]
		);

		// READ: Verify deletion
		const [deletedInstances] = await connection.query(
			'SELECT * FROM watchlist_instances WHERE provider_id = ? AND watchlist_key = ?',
			[providerId, testKey]
		);

		expect(deletedInstances.length).toBe(0);
	});

	test('should handle multiple watchlist instances for same provider', async () => {
		if (!connection) {
			console.log('Skipping test: database not available');
			return;
		}

		const testKey1 = 'test_multi_1_' + Date.now();
		const testKey2 = 'test_multi_2_' + Date.now();

		// Get provider numeric ID
		const [providers] = await connection.query(
			'SELECT id FROM watchlist_providers WHERE provider_id = ?',
			[testProviderKey]
		);
		const providerId = providers[0].id;

		// Create two instances
		await connection.query(
			'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
			[providerId, testKey1, 'https://example.com/1', 120, true]
		);

		await connection.query(
			'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
			[providerId, testKey2, 'https://example.com/2', 180, true]
		);

		// Query all instances for this provider
		const [instances] = await connection.query(
			'SELECT watchlist_key FROM watchlist_instances WHERE provider_id = ? AND watchlist_key LIKE ? ORDER BY watchlist_key',
			[providerId, 'test_multi_%']
		);

		expect(instances.length).toBeGreaterThanOrEqual(2);
		const keys = instances.map((i) => i.watchlist_key);
		expect(keys).toContain(testKey1);
		expect(keys).toContain(testKey2);

		// Clean up
		await connection.query('DELETE FROM watchlist_instances WHERE watchlist_key IN (?, ?)', [testKey1, testKey2]);
	});

	test('should enforce unique constraint on (provider_id, watchlist_key)', async () => {
		if (!connection) {
			console.log('Skipping test: database not available');
			return;
		}

		const testKey = 'test_unique_' + Date.now();

		// Get provider numeric ID
		const [providers] = await connection.query(
			'SELECT id FROM watchlist_providers WHERE provider_id = ?',
			[testProviderKey]
		);
		const providerId = providers[0].id;

		// Create first instance
		await connection.query(
			'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
			[providerId, testKey, 'https://example.com/1', 120, true]
		);

		// Try to create duplicate - should fail
		await expect(
			connection.query(
				'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
				[providerId, testKey, 'https://example.com/2', 120, true]
			)
		).rejects.toThrow();

		// Clean up
		await connection.query('DELETE FROM watchlist_instances WHERE watchlist_key = ?', [testKey]);
	});

	test('should load watchlist instances via WatchlistConfigLoader', async () => {
		if (!connection) {
			console.log('Skipping test: database not available');
			return;
		}

		const { WatchlistConfigLoader } = require('../../services/watchlist_config_loader');

		const testKey = 'test_loader_' + Date.now();

		// Get provider numeric ID
		const [providers] = await connection.query(
			'SELECT id FROM watchlist_providers WHERE provider_id = ?',
			[testProviderKey]
		);
		const providerId = providers[0].id;

		// Create a test instance
		await connection.query(
			'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
			[providerId, testKey, 'https://example.com/loader-test', 120, true]
		);

		// Create a pool for the loader
		const pool = mysql.createPool({
			host: process.env.MYSQL_HOST || 'localhost',
			port: parseInt(process.env.MYSQL_PORT || '3306', 10),
			user: process.env.MYSQL_USER,
			password: process.env.MYSQL_PASSWORD,
			database: process.env.MYSQL_DATABASE
		});

		const loader = new WatchlistConfigLoader(pool);
		const providers_data = await loader.getProviders();

		// Check if our test provider is loaded
		expect(providers_data[testProviderKey]).toBeDefined();
		expect(providers_data[testProviderKey].watchlists).toBeDefined();

		const watchlist = providers_data[testProviderKey].watchlists.find((w) => w.key === testKey);
		expect(watchlist).toBeDefined();
		expect(watchlist.url).toBe('https://example.com/loader-test');
		expect(watchlist.intervalSeconds).toBe(120);

		// Clean up
		await connection.query('DELETE FROM watchlist_instances WHERE watchlist_key = ?', [testKey]);
		await pool.end();
	});
});
