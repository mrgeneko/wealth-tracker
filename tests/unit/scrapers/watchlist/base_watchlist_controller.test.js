const { BaseWatchlistController, AssetType } = require('../../../../scrapers/watchlist/base_watchlist_controller');

describe('BaseWatchlistController', () => {
	test('should not allow direct instantiation', () => {
		expect(() => new BaseWatchlistController({})).toThrow(/abstract/i);
	});

	test('AssetType enum should have expected values', () => {
		expect(AssetType.STOCK).toBe('stock');
		expect(AssetType.ETF).toBe('etf');
		expect(AssetType.BOND).toBe('bond');
		expect(AssetType.TREASURY).toBe('treasury');
	});
});
