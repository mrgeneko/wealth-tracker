class PersistentPageRegistry {
	constructor(browser) {
		this.browser = browser;
		this.pages = new Map();
	}

	async getOrCreate(urlPattern, options = {}) {
		if (!this.browser) {
			throw new Error('PersistentPageRegistry requires a browser instance');
		}

		const patternKey = urlPattern.toString();

		if (this.pages.has(patternKey)) {
			const entry = this.pages.get(patternKey);
			try {
				const isClosed = (entry.page && typeof entry.page.isClosed === 'function')
					? entry.page.isClosed()
					: false;
				if (!isClosed) {
					entry.lastUsedAt = Date.now();
					return entry.page;
				}
			} catch (e) {
				// treat as dead
			}
			this.pages.delete(patternKey);
		}

		// Search existing browser pages for a match
		if (typeof this.browser.pages === 'function') {
			const existingPages = await this.browser.pages();
			for (const p of existingPages) {
				try {
					const url = typeof p.url === 'function' ? p.url() : '';
					const matches = urlPattern instanceof RegExp
						? urlPattern.test(url)
						: url.includes(urlPattern);

					const isClosed = (p && typeof p.isClosed === 'function') ? p.isClosed() : false;
					if (matches && !isClosed) {
						this.pages.set(patternKey, {
							page: p,
							createdAt: Date.now(),
							lastUsedAt: Date.now(),
							urlPattern
						});
						return p;
					}
				} catch (e) {
					// ignore
				}
			}
		}

		// Create new page
		const page = await this.browser.newPage();

		if (options.viewport) {
			await page.setViewport(options.viewport);
		}
		if (options.userAgent) {
			await page.setUserAgent(options.userAgent);
		}
		if (options.url) {
			await page.goto(options.url, {
				waitUntil: options.waitUntil || 'domcontentloaded',
				timeout: options.timeout || 30000
			});
		}

		this.pages.set(patternKey, {
			page,
			createdAt: Date.now(),
			lastUsedAt: Date.now(),
			urlPattern
		});

		return page;
	}

	has(urlPattern) {
		return this.pages.has(urlPattern.toString());
	}

	getStats() {
		const stats = {
			count: this.pages.size,
			pages: []
		};

		for (const [key, entry] of this.pages) {
			stats.pages.push({
				pattern: key,
				createdAt: entry.createdAt,
				lastUsedAt: entry.lastUsedAt,
				ageMs: Date.now() - entry.createdAt,
				idleMs: Date.now() - entry.lastUsedAt
			});
		}

		return stats;
	}

	async closeAll() {
		for (const [, entry] of this.pages) {
			try {
				await entry.page.close();
			} catch (e) {
				// ignore
			}
		}
		this.pages.clear();
	}
}

module.exports = PersistentPageRegistry;
