const { WatchlistConfigLoader } = require('../../../services/watchlist_config_loader');

describe('WatchlistConfigLoader', () => {
	test('loads providers + instances from database (joined)', async () => {
		const dbPool = {
			query: jest
				.fn()
				.mockResolvedValueOnce([
					[
						{
							id: 1,
							provider_id: 'investingcom',
							display_name: 'Investing.com',
							enabled: 1,
							auth_method: 'credentials',
							default_interval_seconds: 300,
							supported_asset_types: '["stock","etf"]'
						}
					]
				])
				.mockResolvedValueOnce([
					[
						{
							provider_key: 'investingcom',
							watchlist_key: 'primary',
							watchlist_name: 'Primary',
							watchlist_url: 'https://www.investing.com/portfolio/?portfolioID=abc',
							interval_seconds: 120,
							enabled: 1,
							allowed_asset_types: '["stock","etf"]'
						}
					]
				])
		};

		const loader = new WatchlistConfigLoader(dbPool);
		const providers = await loader.getProviders();

		expect(providers.investingcom).toBeDefined();
		expect(providers.investingcom.displayName).toBe('Investing.com');
		expect(providers.investingcom.watchlists).toHaveLength(1);
		expect(providers.investingcom.watchlists[0].key).toBe('primary');
		expect(providers.investingcom.watchlists[0].intervalSeconds).toBe(120);
	});
});
