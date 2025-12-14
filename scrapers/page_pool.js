const EventEmitter = require('events');

const DEFAULT_CONFIG = {
	poolSize: 4,
	acquireTimeout: 30000,
	maxOperationsPerPage: 100,
	navigationTimeout: 30000,
	idleCleanupInterval: 60000,
	maxIdleTime: 300000
};

class PagePool extends EventEmitter {
	constructor(browser, options = {}) {
		super();
		this.browser = browser;
		this.config = { ...DEFAULT_CONFIG, ...options };
		this.pages = [];
		this.waitQueue = [];
		this.nextPageId = 1;
		this.isInitialized = false;
		this.isShuttingDown = false;
		this.cleanupTimer = null;
		this.stats = {
			totalAcquires: 0,
			totalReleases: 0,
			totalRecycles: 0,
			totalWaits: 0,
			maxWaitTime: 0,
			errors: 0
		};
	}

	async initialize() {
		if (this.isInitialized) {
			throw new Error('PagePool already initialized');
		}
		if (!this.browser || typeof this.browser.newPage !== 'function') {
			throw new Error('PagePool requires a Puppeteer browser instance');
		}

		const createPromises = [];
		for (let i = 0; i < this.config.poolSize; i++) {
			createPromises.push(this._createPage());
		}

		await Promise.all(createPromises);
		this.isInitialized = true;
		this._startCleanupTimer();
		this.emit('initialized', { poolSize: this.pages.length });
	}

	async _createPage() {
		const page = await this.browser.newPage();
		try {
			await page.setViewport({ width: 1280, height: 800 });
			await page.setDefaultNavigationTimeout(this.config.navigationTimeout);
			if (page.setRequestInterception) {
				await page.setRequestInterception(true);
				page.on('request', (req) => {
					try {
						const resourceType = req.resourceType();
						if (['image', 'font', 'stylesheet', 'media'].includes(resourceType)) {
							req.abort();
						} else {
							req.continue();
						}
					} catch (e) {
						try { req.continue(); } catch (e2) {}
					}
				});
			}
		} catch (e) {
			// If page setup fails, close it and surface error.
			try { await page.close(); } catch (e2) {}
			throw e;
		}

		const pooledPage = {
			page,
			id: this.nextPageId++,
			inUse: false,
			operationCount: 0,
			lastUsedAt: Date.now(),
			createdAt: Date.now(),
			currentTicker: null
		};

		this.pages.push(pooledPage);
		return pooledPage;
	}

	async acquire(ticker = null) {
		if (!this.isInitialized) {
			throw new Error('PagePool not initialized');
		}
		if (this.isShuttingDown) {
			throw new Error('PagePool is shutting down');
		}

		const pooledPage = this.pages.find(p => !p.inUse);
		if (pooledPage) {
			return this._markAcquired(pooledPage, ticker);
		}

		this.stats.totalWaits++;
		const startTime = Date.now();

		return new Promise((resolve, reject) => {
			const waiter = {
				ticker,
				startTime,
				resolve,
				reject,
				timer: setTimeout(() => {
					const index = this.waitQueue.indexOf(waiter);
					if (index !== -1) {
						this.waitQueue.splice(index, 1);
					}
					reject(new Error(`Timeout waiting for page (${this.config.acquireTimeout}ms)`));
				}, this.config.acquireTimeout)
			};
			this.waitQueue.push(waiter);
		});
	}

	_markAcquired(pooledPage, ticker) {
		pooledPage.inUse = true;
		pooledPage.currentTicker = ticker;
		pooledPage.operationCount++;
		this.stats.totalAcquires++;

		const release = async () => this.release(pooledPage.id);
		return { page: pooledPage.page, release, pageId: pooledPage.id };
	}

	async release(pageId) {
		const pooledPage = this.pages.find(p => p.id === pageId);
		if (!pooledPage) {
			return;
		}
		if (!pooledPage.inUse) {
			return;
		}

		try {
			if (pooledPage.operationCount >= this.config.maxOperationsPerPage) {
				await this._recyclePage(pooledPage);
			} else {
				try {
					await pooledPage.page.goto('about:blank', { waitUntil: 'domcontentloaded' });
				} catch (e) {
					await this._recyclePage(pooledPage);
					return;
				}
			}

			pooledPage.inUse = false;
			pooledPage.currentTicker = null;
			pooledPage.lastUsedAt = Date.now();
			this.stats.totalReleases++;

			this._processWaitQueue();
			this.emit('released', { pageId: pooledPage.id });
		} catch (e) {
			this.stats.errors++;
			throw e;
		}
	}

	_processWaitQueue() {
		if (this.waitQueue.length === 0) return;
		const availablePage = this.pages.find(p => !p.inUse);
		if (!availablePage) return;

		const waiter = this.waitQueue.shift();
		clearTimeout(waiter.timer);

		const waitTime = Date.now() - waiter.startTime;
		this.stats.maxWaitTime = Math.max(this.stats.maxWaitTime, waitTime);

		waiter.resolve(this._markAcquired(availablePage, waiter.ticker));
	}

	async _recyclePage(pooledPage) {
		const index = this.pages.indexOf(pooledPage);
		try {
			await pooledPage.page.close();
		} catch (e) {
			// ignore
		}

		if (index !== -1) {
			this.pages.splice(index, 1);
		}
		this.stats.totalRecycles++;

		if (!this.isShuttingDown) {
			await this._createPage();
		}
	}

	_startCleanupTimer() {
		this.cleanupTimer = setInterval(() => {
			this._cleanupIdlePages();
		}, this.config.idleCleanupInterval);
	}

	async _cleanupIdlePages() {
		const now = Date.now();
		for (const pooledPage of this.pages) {
			if (!pooledPage.inUse &&
				(now - pooledPage.lastUsedAt) > this.config.maxIdleTime &&
				pooledPage.operationCount > 0) {
				await this._recyclePage(pooledPage);
			}
		}
	}

	getStats() {
		const availablePages = this.pages.filter(p => !p.inUse).length;
		const busyPages = this.pages.filter(p => p.inUse);

		return {
			...this.stats,
			poolSize: this.config.poolSize,
			currentSize: this.pages.length,
			availablePages,
			busyPages: busyPages.length,
			currentTickers: busyPages.map(p => p.currentTicker).filter(Boolean),
			waitQueueLength: this.waitQueue.length,
			pagesOperations: this.pages.map(p => ({
				id: p.id,
				operations: p.operationCount,
				inUse: p.inUse
			}))
		};
	}

	async shutdown() {
		this.isShuttingDown = true;
		if (this.cleanupTimer) {
			clearInterval(this.cleanupTimer);
			this.cleanupTimer = null;
		}

		for (const waiter of this.waitQueue) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error('PagePool shutting down'));
		}
		this.waitQueue = [];

		const closePromises = this.pages.map(async (pooledPage) => {
			try {
				await pooledPage.page.close();
			} catch (e) {
				// ignore
			}
		});
		await Promise.all(closePromises);
		this.pages = [];
		this.isInitialized = false;

		this.emit('shutdown');
	}
}

module.exports = PagePool;
