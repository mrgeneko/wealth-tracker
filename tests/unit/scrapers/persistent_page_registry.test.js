const PersistentPageRegistry = require('../../../scrapers/persistent_page_registry');

const createMockPage = (url = 'about:blank') => ({
	url: jest.fn().mockReturnValue(url),
	isClosed: jest.fn().mockReturnValue(false),
	setViewport: jest.fn().mockResolvedValue(undefined),
	setUserAgent: jest.fn().mockResolvedValue(undefined),
	goto: jest.fn().mockResolvedValue(undefined),
	close: jest.fn().mockResolvedValue(undefined)
});

const createMockBrowser = (initialPages = []) => {
	const pages = [...initialPages];
	return {
		pages: jest.fn().mockResolvedValue(pages),
		newPage: jest.fn().mockImplementation(async () => {
			const p = createMockPage();
			pages.push(p);
			return p;
		})
	};
};

describe('PersistentPageRegistry (Phase 7)', () => {
	test('getOrCreate reuses an existing matching browser page', async () => {
		const existing = createMockPage('https://www.investing.com/portfolio/');
		const browser = createMockBrowser([existing]);
		const reg = new PersistentPageRegistry(browser);

		const page = await reg.getOrCreate(/investing\.com/);
		expect(page).toBe(existing);
		expect(reg.has(/investing\.com/)).toBe(true);
	});

	test('getOrCreate creates new page when none match and can apply options', async () => {
		const browser = createMockBrowser([]);
		const reg = new PersistentPageRegistry(browser);

		const page = await reg.getOrCreate('example.com', {
			viewport: { width: 111, height: 222 },
			userAgent: 'UA',
			url: 'https://example.com',
			waitUntil: 'domcontentloaded',
			timeout: 123
		});

		expect(browser.newPage).toHaveBeenCalledTimes(1);
		expect(page.setViewport).toHaveBeenCalledWith({ width: 111, height: 222 });
		expect(page.setUserAgent).toHaveBeenCalledWith('UA');
		expect(page.goto).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ timeout: 123 }));
	});

	test('closeAll closes pages and clears registry', async () => {
		const browser = createMockBrowser([]);
		const reg = new PersistentPageRegistry(browser);

		const page = await reg.getOrCreate(/investing\.com/);
		await reg.closeAll();

		expect(page.close).toHaveBeenCalled();
		expect(reg.getStats().count).toBe(0);
	});
});
