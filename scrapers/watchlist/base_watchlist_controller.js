const AssetType = {
	STOCK: 'stock',
	ETF: 'etf',
	BOND: 'bond',
	TREASURY: 'treasury',
	MUTUAL_FUND: 'mutual_fund',
	CRYPTO: 'crypto',
	INDEX: 'index',
	FOREX: 'forex',
	COMMODITY: 'commodity'
};

class BaseWatchlistController {
	constructor(browser, options = {}) {
		if (new.target === BaseWatchlistController) {
			throw new Error('BaseWatchlistController is abstract and cannot be instantiated directly');
		}

		this.browser = browser;
		this.options = options;
		this.page = null;
		this.isInitialized = false;
		this.currentWatchlist = null;

		this.operationQueue = [];
		this.isProcessing = false;
	}

	getCapabilities() {
		throw new Error('getCapabilities() must be implemented by subclass');
	}

	getSupportedAssetTypes() {
		return this.getCapabilities().supportedAssetTypes;
	}

	validateTicker(ticker, assetType) {
		if (!ticker || typeof ticker !== 'string') {
			return { valid: false, reason: 'Ticker is required' };
		}

		const supported = this.getSupportedAssetTypes();
		if (!supported.includes(assetType)) {
			return {
				valid: false,
				reason: `${this.getCapabilities().displayName} does not support ${assetType}. Supported: ${supported.join(', ')}`
			};
		}

		return { valid: true };
	}

	async initialize(url) {
		throw new Error('initialize() must be implemented by subclass');
	}

	async addTicker(ticker, options = {}) {
		throw new Error('addTicker() must be implemented by subclass');
	}

	async deleteTicker(ticker, options = {}) {
		throw new Error('deleteTicker() must be implemented by subclass');
	}

	async listTickers() {
		throw new Error('listTickers() must be implemented by subclass');
	}

	async syncWatchlist(options = {}) {
		throw new Error('syncWatchlist() must be implemented by subclass');
	}

	async getWatchlistTabs() {
		throw new Error('getWatchlistTabs() must be implemented by subclass');
	}

	async switchToTab(tabName) {
		throw new Error('switchToTab() must be implemented by subclass');
	}

	getStatus() {
		return {
			providerId: this.getCapabilities().providerId,
			isInitialized: this.isInitialized,
			currentWatchlist: this.currentWatchlist,
			queueLength: this.operationQueue.length,
			isProcessing: this.isProcessing
		};
	}

	async _queueOperation(operation) {
		return new Promise((resolve, reject) => {
			this.operationQueue.push({ operation, resolve, reject });
			this._processQueue();
		});
	}

	async _processQueue() {
		if (this.isProcessing || this.operationQueue.length === 0) {
			return;
		}

		this.isProcessing = true;
		const { rateLimitMs } = this.getCapabilities();

		while (this.operationQueue.length > 0) {
			const { operation, resolve, reject } = this.operationQueue.shift();
			try {
				const result = await operation();
				resolve(result);

				if (rateLimitMs > 0 && this.operationQueue.length > 0) {
					await new Promise(r => setTimeout(r, rateLimitMs));
				}
			} catch (e) {
				reject(e);
			}
		}

		this.isProcessing = false;
	}
}

module.exports = { BaseWatchlistController, AssetType };
