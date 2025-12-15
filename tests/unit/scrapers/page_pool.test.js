const PagePool = require('../../../scrapers/page_pool');

const createMockPage = () => ({
	setViewport: jest.fn().mockResolvedValue(undefined),
	setDefaultNavigationTimeout: jest.fn().mockResolvedValue(undefined),
	setRequestInterception: jest.fn().mockResolvedValue(undefined),
	on: jest.fn(),
	goto: jest.fn().mockResolvedValue(undefined),
	close: jest.fn().mockResolvedValue(undefined)
});

const createMockBrowser = () => {
	const pages = [];
	return {
		newPage: jest.fn().mockImplementation(async () => {
			const p = createMockPage();
			pages.push(p);
			return p;
		}),
		pages: jest.fn().mockResolvedValue(pages)
	};
};

describe('PagePool (Phase 7)', () => {
	let mockBrowser;
	let pool;

	beforeEach(() => {
		mockBrowser = createMockBrowser();
	});

	afterEach(async () => {
		jest.useRealTimers();
		if (pool) {
			try { await pool.shutdown(); } catch (e) {}
			pool = null;
		}
	});

	test('initialize creates configured number of pages', async () => {
		pool = new PagePool(mockBrowser, { poolSize: 3, idleCleanupInterval: 1000000 });
		await pool.initialize();

		expect(mockBrowser.newPage).toHaveBeenCalledTimes(3);
		expect(pool.getStats().currentSize).toBe(3);
	});

	test('acquire returns a page when available and release returns it to pool', async () => {
		pool = new PagePool(mockBrowser, { poolSize: 1, idleCleanupInterval: 1000000 });
		await pool.initialize();

		const acquired = await pool.acquire('AAPL');
		expect(acquired.page).toBeTruthy();
		expect(typeof acquired.release).toBe('function');

		await acquired.release();
		const stats = pool.getStats();
		expect(stats.availablePages).toBe(1);
		expect(stats.busyPages).toBe(0);
	});

	test('acquire queues when no pages available and is fulfilled after release', async () => {
		pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 1000, idleCleanupInterval: 1000000 });
		await pool.initialize();

		const a1 = await pool.acquire('ONE');
		const p2 = pool.acquire('TWO');

		expect(pool.getStats().waitQueueLength).toBe(1);

		await a1.release();
		const a2 = await p2;
		expect(a2.pageId).toBeTruthy();
		await a2.release();
	});

	test('acquire times out after acquireTimeout', async () => {
		jest.useFakeTimers();
		pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 50, idleCleanupInterval: 1000000 });
		await pool.initialize();

		const a1 = await pool.acquire('ONE');
		const p2 = pool.acquire('TWO');

		jest.advanceTimersByTime(60);
		await expect(p2).rejects.toThrow(/Timeout waiting for page/);
		await a1.release();
	});

	test('release recycles page after maxOperationsPerPage', async () => {
		pool = new PagePool(mockBrowser, { poolSize: 1, maxOperationsPerPage: 1, idleCleanupInterval: 1000000 });
		await pool.initialize();

		expect(mockBrowser.newPage).toHaveBeenCalledTimes(1);

		const a1 = await pool.acquire('ONE');
		await a1.release();

		// Recycle should create a replacement page
		expect(mockBrowser.newPage).toHaveBeenCalledTimes(2);
	});

	test('shutdown rejects waiters and closes pages', async () => {
		jest.useFakeTimers();
		pool = new PagePool(mockBrowser, { poolSize: 1, acquireTimeout: 1000, idleCleanupInterval: 1000000 });
		await pool.initialize();

		const a1 = await pool.acquire('ONE');
		const p2 = pool.acquire('TWO');

		await pool.shutdown();
		await expect(p2).rejects.toThrow(/PagePool shutting down/);

		// release after shutdown should be safe
		await expect(a1.release()).resolves.toBeUndefined();
	});
});
