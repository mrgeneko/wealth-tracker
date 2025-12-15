jest.mock('../../../../scrapers/scraper_utils', () => ({
	logDebug: jest.fn(),
	createPreparedPage: jest.fn()
}));

const { createPreparedPage } = require('../../../../scrapers/scraper_utils');
const { InvestingComWatchlistController } = require('../../../../scrapers/watchlist/investingcom_watchlist_controller');
const { AssetType } = require('../../../../scrapers/watchlist/base_watchlist_controller');

describe('InvestingComWatchlistController', () => {
	let mockBrowser;
	let mockPage;

	beforeEach(() => {
		mockPage = {
			waitForSelector: jest.fn().mockResolvedValue(true),
			click: jest.fn().mockResolvedValue(undefined),
			type: jest.fn().mockResolvedValue(undefined),
			$$: jest.fn().mockResolvedValue([]),
			$$eval: jest.fn().mockResolvedValue([]),
			evaluate: jest.fn().mockResolvedValue('AAPL')
		};

		mockBrowser = {
			pages: jest.fn().mockResolvedValue([mockPage]),
			newPage: jest.fn().mockResolvedValue(mockPage)
		};

		createPreparedPage.mockResolvedValue(mockPage);
	});

	test('initialize() uses createPreparedPage and sets isInitialized', async () => {
		const controller = new InvestingComWatchlistController(mockBrowser);
		expect(controller.isInitialized).toBe(false);

		await controller.initialize('https://www.investing.com/portfolio/?portfolioID=test');

		expect(createPreparedPage).toHaveBeenCalled();
		expect(mockPage.waitForSelector).toHaveBeenCalled();
		expect(controller.isInitialized).toBe(true);
	});

	test('validateTicker accepts stocks and ETFs', () => {
		const controller = new InvestingComWatchlistController(mockBrowser);
		expect(controller.validateTicker('AAPL', AssetType.STOCK).valid).toBe(true);
		expect(controller.validateTicker('SPY', AssetType.ETF).valid).toBe(true);
	});

	test('addTicker rejects unsupported asset type before queueing', async () => {
		const controller = new InvestingComWatchlistController(mockBrowser);
		controller.isInitialized = true;
		controller.page = mockPage;

		const result = await controller.addTicker('US912828ZT58', { assetType: AssetType.TREASURY });

		expect(result.success).toBe(false);
		expect(result.error).toBe('UNSUPPORTED_ASSET_TYPE');
		expect(mockPage.waitForSelector).not.toHaveBeenCalled();
	});

	test('operation queue processes sequentially', async () => {
		const controller = new InvestingComWatchlistController(mockBrowser);
		controller.getCapabilities = () => ({
			providerId: 'investingcom',
			displayName: 'Investing.com',
			supportedAssetTypes: [AssetType.STOCK, AssetType.ETF],
			supportsMultipleWatchlists: true,
			requiresLogin: true,
			maxTickersPerWatchlist: 100,
			rateLimitMs: 0
		});

		const order = [];
		const op1 = controller._queueOperation(async () => {
			order.push(1);
			await new Promise(r => setTimeout(r, 25));
			return 1;
		});
		const op2 = controller._queueOperation(async () => {
			order.push(2);
			return 2;
		});

		await Promise.all([op1, op2]);
		expect(order).toEqual([1, 2]);
	});
});
