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

	test('ticker-specific window excludes default windows', async () => {
		// Fixed time: Tuesday 8:25 AM ET = 13:25 UTC (December 17, 2025)
		const fixed = Date.UTC(2025, 11, 17, 13, 25, 0);
		Settings.now = () => fixed;

		const dbPool = {
			query: jest.fn().mockResolvedValue([
				[
					// BKLC-specific window: 9:31 AM - 4:00 PM ET
					{
						provider_id: 'investingcom',
						watchlist_key: null,
						ticker: 'BKLC',
						days: '["mon", "tue", "wed", "thu", "fri"]',
						start_time: '09:31:00',
						end_time: '16:00:00',
						timezone: 'America/New_York',
						enabled: 1,
						priority: 10
					},
					// Default window: 4:00 AM - 9:30 AM ET (would match 8:25 AM)
					{
						provider_id: null,
						watchlist_key: null,
						ticker: 'default',
						days: '["mon", "tue", "wed", "thu", "fri"]',
						start_time: '04:00:00',
						end_time: '09:30:00',
						timezone: 'America/New_York',
						enabled: 1,
						priority: 0
					},
					// Another default window: 9:30 AM - 4:00 PM ET
					{
						provider_id: null,
						watchlist_key: null,
						ticker: 'default',
						days: '["mon", "tue", "wed", "thu", "fri"]',
						start_time: '09:30:00',
						end_time: '16:00:00',
						timezone: 'America/New_York',
						enabled: 1,
						priority: 0
					}
				]
			])
		};

		const svc = new UpdateWindowService(dbPool);
		const res = await svc.isWithinUpdateWindow('BKLC', 'investingcom', 'primary');

		// Should be OUTSIDE because:
		// 1. BKLC has a specific window (9:31-16:00)
		// 2. Default windows should be excluded when ticker-specific window exists
		// 3. At 8:25 AM ET, BKLC is outside its 9:31-16:00 window
		expect(res.allowed).toBe(false);
		expect(res.reason).toMatch(/outside_all_windows/);
	});

	test('default windows apply when no ticker-specific window exists', async () => {
		// Fixed time: Tuesday 8:25 AM ET = 13:25 UTC (December 17, 2025)
		const fixed = Date.UTC(2025, 11, 17, 13, 25, 0);
		Settings.now = () => fixed;

		const dbPool = {
			query: jest.fn().mockResolvedValue([
				[
					// Default window: 4:00 AM - 9:30 AM ET (matches 8:25 AM)
					{
						provider_id: null,
						watchlist_key: null,
						ticker: 'default',
						days: '["mon", "tue", "wed", "thu", "fri"]',
						start_time: '04:00:00',
						end_time: '09:30:00',
						timezone: 'America/New_York',
						enabled: 1,
						priority: 0
					}
				]
			])
		};

		const svc = new UpdateWindowService(dbPool);
		const res = await svc.isWithinUpdateWindow('AAPL', 'investingcom', 'primary');

		// Should be WITHIN because AAPL has no specific window, so default applies
		expect(res.allowed).toBe(true);
		expect(res.reason).toMatch(/within_window:04:00:00-09:30:00/);
	});
});
