const { Settings } = require('luxon');
const { UpdateWindowService } = require('../../../services/update_window_service');

describe('UpdateWindowService', () => {
	afterEach(() => {
		Settings.now = () => Date.now();
	});

	test('allows when within window', async () => {
		// Fixed time: Monday 12:00 UTC
		const fixed = Date.UTC(2025, 0, 6, 12, 0, 0);
		Settings.now = () => fixed;

		const dbPool = {
			query: jest.fn().mockResolvedValue([
				[
					{
						provider_id: null,
						watchlist_key: null,
						ticker: 'default',
						days: '["mon"]',
						start_time: '00:00:00',
						end_time: '23:59:00',
						timezone: 'UTC',
						enabled: 1,
						priority: 0
					}
				]
			])
		};

		const svc = new UpdateWindowService(dbPool);
		const res = await svc.isWithinUpdateWindow('AAPL', 'investingcom', 'primary');
		expect(res.allowed).toBe(true);
		expect(res.reason).toMatch(/within_window/);
	});

	test('denies when outside window', async () => {
		// Fixed time: Monday 12:00 UTC
		const fixed = Date.UTC(2025, 0, 6, 12, 0, 0);
		Settings.now = () => fixed;

		const dbPool = {
			query: jest.fn().mockResolvedValue([
				[
					{
						provider_id: null,
						watchlist_key: null,
						ticker: 'default',
						days: '["mon"]',
						start_time: '00:00:00',
						end_time: '00:01:00',
						timezone: 'UTC',
						enabled: 1,
						priority: 0
					}
				]
			])
		};

		const svc = new UpdateWindowService(dbPool);
		const res = await svc.isWithinUpdateWindow('AAPL', 'investingcom', 'primary');
		expect(res.allowed).toBe(false);
		expect(res.reason).toMatch(/outside_all_windows/);
	});
});
