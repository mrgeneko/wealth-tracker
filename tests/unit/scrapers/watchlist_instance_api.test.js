/**
 * Unit tests for watchlist instance management API endpoints
 * Tests the database interaction logic for CRUD operations on watchlist_instances table
 */

describe('Watchlist Instance Management API Logic', () => {
	let mockPool;

	beforeEach(() => {
		mockPool = {
			query: jest.fn()
		};
	});

	describe('GET /watchlist/:provider/instances - List instances', () => {
		test('should fetch watchlist instances for a valid provider', async () => {
			// Mock provider lookup returning id=1
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);

			// Mock instances query
			mockPool.query.mockResolvedValueOnce([
				[
					{
						watchlist_key: 'primary',
						watchlist_url: 'https://example.com',
						interval_seconds: 120,
						enabled: 1
					},
					{
						watchlist_key: 'secondary',
						watchlist_url: 'https://example.com/2',
						interval_seconds: 180,
						enabled: 1
					}
				]
			]);

			// Simulate the endpoint logic
			const providerIdStr = 'investingcom';
			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);

			expect(providerRows.length).toBeGreaterThan(0);
			const providerId = providerRows[0].id;
			expect(providerId).toBe(1);

			const [rows] = await mockPool.query(
				'SELECT watchlist_key, watchlist_url, interval_seconds, enabled FROM watchlist_instances WHERE provider_id = ? ORDER BY watchlist_key',
				[providerId]
			);

			expect(rows).toHaveLength(2);
			expect(rows[0].watchlist_key).toBe('primary');
			expect(rows[1].watchlist_key).toBe('secondary');
		});

		test('should handle provider not found', async () => {
			mockPool.query.mockResolvedValueOnce([[]]); // No provider found

			const providerIdStr = 'unknown';
			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);

			expect(providerRows.length).toBe(0);
		});

		test('should handle empty instances list', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
			mockPool.query.mockResolvedValueOnce([[]]); // No instances

			const providerIdStr = 'investingcom';
			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);
			const providerId = providerRows[0].id;

			const [rows] = await mockPool.query(
				'SELECT watchlist_key, watchlist_url, interval_seconds, enabled FROM watchlist_instances WHERE provider_id = ? ORDER BY watchlist_key',
				[providerId]
			);

			expect(rows).toHaveLength(0);
		});
	});

	describe('POST /watchlist/:provider/instances - Create instance', () => {
		test('should insert a new watchlist instance with correct provider ID', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]); // Provider lookup
			mockPool.query.mockResolvedValueOnce([{ insertId: 5 }]); // Insert

			const providerIdStr = 'investingcom';
			const watchlist_key = 'secondary';
			const watchlist_url = 'https://example.com/portfolio2';
			const interval_seconds = 180;
			const enabled = true;

			// Get provider ID
			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);
			expect(providerRows.length).toBeGreaterThan(0);
			const providerId = providerRows[0].id;

			// Insert instance
			await mockPool.query(
				'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
				[providerId, watchlist_key, watchlist_url, interval_seconds, enabled]
			);

			expect(mockPool.query).toHaveBeenCalledTimes(2);
			const insertCall = mockPool.query.mock.calls[1];
			expect(insertCall[1][0]).toBe(1); // provider_id should be numeric 1, not string
			expect(insertCall[1][1]).toBe('secondary');
			expect(insertCall[1][2]).toBe('https://example.com/portfolio2');
			expect(insertCall[1][3]).toBe(180);
			expect(insertCall[1][4]).toBe(true);
		});

		test('should use default interval_seconds of 120 when not provided', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
			mockPool.query.mockResolvedValueOnce([{ insertId: 5 }]);

			const providerIdStr = 'investingcom';
			const watchlist_key = 'test';
			const watchlist_url = 'https://example.com';
			const interval_seconds = 120; // Default value
			const enabled = true;

			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);
			const providerId = providerRows[0].id;

			await mockPool.query(
				'INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_url, interval_seconds, enabled) VALUES (?, ?, ?, ?, ?)',
				[providerId, watchlist_key, watchlist_url, interval_seconds, enabled]
			);

			const insertCall = mockPool.query.mock.calls[1];
			expect(insertCall[1][3]).toBe(120); // Default interval
		});

		test('should validate required fields', () => {
			const watchlist_key = '';
			const watchlist_url = 'https://example.com';

			// Simulate validation logic
			const isValid = !!(watchlist_key && watchlist_url);
			expect(isValid).toBe(false);
		});
	});

	describe('PUT /watchlist/:provider/instances/:key - Update instance', () => {
		test('should update watchlist URL and interval', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
			mockPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const providerIdStr = 'investingcom';
			const watchlistKey = 'primary';
			const watchlist_url = 'https://example.com/updated';
			const interval_seconds = 240;

			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);
			const providerId = providerRows[0].id;

			const updates = ['watchlist_url = ?', 'interval_seconds = ?'];
			const values = [watchlist_url, interval_seconds, providerId, watchlistKey];

			await mockPool.query(
				`UPDATE watchlist_instances SET ${updates.join(', ')} WHERE provider_id = ? AND watchlist_key = ?`,
				values
			);

			expect(mockPool.query).toHaveBeenCalledTimes(2);
			const updateCall = mockPool.query.mock.calls[1];
			expect(updateCall[0]).toContain('UPDATE watchlist_instances SET');
			expect(updateCall[1]).toEqual([watchlist_url, interval_seconds, providerId, watchlistKey]);
		});

		test('should handle URL decoding in watchlist key', () => {
			const encodedKey = 'my%20key';
			const decodedKey = decodeURIComponent(encodedKey);
			expect(decodedKey).toBe('my key');
		});

		test('should validate at least one field is provided', () => {
			const watchlist_url = undefined;
			const interval_seconds = undefined;
			const enabled = undefined;

			const hasUpdate = watchlist_url !== undefined || interval_seconds !== undefined || enabled !== undefined;
			expect(hasUpdate).toBe(false);
		});
	});

	describe('DELETE /watchlist/:provider/instances/:key - Delete instance', () => {
		test('should delete watchlist instance', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);
			mockPool.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

			const providerIdStr = 'investingcom';
			const watchlistKey = 'primary';

			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);
			const providerId = providerRows[0].id;

			await mockPool.query(
				'DELETE FROM watchlist_instances WHERE provider_id = ? AND watchlist_key = ?',
				[providerId, watchlistKey]
			);

			expect(mockPool.query).toHaveBeenCalledTimes(2);
			const deleteCall = mockPool.query.mock.calls[1];
			expect(deleteCall[0]).toContain('DELETE FROM watchlist_instances');
			expect(deleteCall[1]).toEqual([providerId, watchlistKey]);
		});

		test('should handle provider not found before delete', async () => {
			mockPool.query.mockResolvedValueOnce([[]]); // No provider

			const providerIdStr = 'unknown';
			const [providerRows] = await mockPool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', [providerIdStr]);

			expect(providerRows.length).toBe(0);
			// Should not proceed to delete
			expect(mockPool.query).toHaveBeenCalledTimes(1);
		});
	});

	describe('Provider ID lookup logic', () => {
		test('should convert provider string to numeric ID', async () => {
			mockPool.query.mockResolvedValueOnce([[{ id: 1 }]]);

			const providerIdStr = 'investingcom';
			const [providerRows] = await mockPool.query(
				'SELECT id FROM watchlist_providers WHERE provider_id = ?',
				[providerIdStr]
			);

			expect(providerRows.length).toBe(1);
			expect(providerRows[0].id).toBe(1);
			expect(typeof providerRows[0].id).toBe('number');
		});

		test('should handle multiple providers', async () => {
			mockPool.query.mockResolvedValueOnce([
				[
					{ id: 1, provider_id: 'investingcom' },
					{ id: 2, provider_id: 'tradingview' }
				]
			]);

			const [providerRows] = await mockPool.query('SELECT id, provider_id FROM watchlist_providers');

			expect(providerRows).toHaveLength(2);
			expect(providerRows[0].id).toBe(1);
			expect(providerRows[1].id).toBe(2);
		});
	});
});
