const { WatchlistManager, AssetType } = require('../../../../scrapers/watchlist/watchlist_manager');
const { InvestingComWatchlistController } = require('../../../../scrapers/watchlist/investingcom_watchlist_controller');

describe('WatchlistManager', () => {
	let manager;

	beforeEach(() => {
		manager = new WatchlistManager();
	});

	test('registerProvider() registers provider', () => {
		manager.registerProvider('investingcom', InvestingComWatchlistController, {});
		expect(manager.getRegisteredProviders()).toContain('investingcom');
	});

	test('getProvidersForAssetType() returns providers that support stocks', () => {
		manager.registerProvider('investingcom', InvestingComWatchlistController, {});
		const providers = manager.getProvidersForAssetType(AssetType.STOCK);
		expect(providers).toContain('investingcom');
	});

	test('getProvidersForAssetType() excludes unsupported types', () => {
		manager.registerProvider('investingcom', InvestingComWatchlistController, {});
		const providers = manager.getProvidersForAssetType(AssetType.TREASURY);
		expect(providers).not.toContain('investingcom');
	});

	test('getAllCapabilities() returns capabilities for registered providers', () => {
		manager.registerProvider('investingcom', InvestingComWatchlistController, {});
		const caps = manager.getAllCapabilities();
		expect(caps.investingcom).toBeDefined();
		expect(caps.investingcom.displayName).toBe('Investing.com');
	});
});
