const { BaseWatchlistController, AssetType } = require('./base_watchlist_controller');
const { logDebug, createPreparedPage } = require('../scraper_utils');

const DEFAULT_CONFIG = {
	selectorTimeout: 10000,
	navigationTimeout: 15000,
	actionDelay: 1000,
	selectors: {
		addSymbolButton: '[data-test="add-symbol-button"], .js-add-symbol, button:has-text("Add")',
		addSymbolInput: 'input[placeholder*="Symbol"], input[name="search"], .js-symbol-search',
		addSymbolSubmit: 'button[type="submit"], .js-add-symbol-submit',
		searchResultItem: '.js-search-result-item, [data-test="search-result"]',
		deleteButton: '[data-test="delete-symbol"], .js-delete-symbol, button.delete, .deleteBtn',
		deleteConfirm: '.js-confirm-delete, button:has-text("Confirm"), button:has-text("Yes")',
		watchlistTable: '[id^="tbody_overview_"]',
		tickerRow: 'tr[data-row-id], tr[id*="row_"]',
		tickerSymbol: 'td[data-column-name="symbol"]',
		modalClose: '.js-modal-close, [data-test="modal-close"], button.close'
	}
};

class InvestingComWatchlistController extends BaseWatchlistController {
	constructor(browser, options = {}) {
		super(browser, options);
		this.config = { ...DEFAULT_CONFIG, ...options };
	}

	getCapabilities() {
		return {
			providerId: 'investingcom',
			displayName: 'Investing.com',
			supportedAssetTypes: [AssetType.STOCK, AssetType.ETF],
			supportsMultipleWatchlists: true,
			requiresLogin: true,
			maxTickersPerWatchlist: 100,
			rateLimitMs: 1000
		};
	}

	async initialize(watchlistUrl) {
		logDebug('[InvestingCom] Initializing...');

		this.page = await createPreparedPage(this.browser, {
			reuseIfUrlMatches: /investing\.com/,
			url: watchlistUrl,
			waitUntil: 'domcontentloaded',
			timeout: this.config.navigationTimeout,
			reloadExisting: false
		});

		await this.page.waitForSelector(this.config.selectors.watchlistTable, {
			timeout: this.config.selectorTimeout
		});

		this.isInitialized = true;
		logDebug('[InvestingCom] Initialized successfully');
	}

	async getWatchlistTabs() {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		const tabs = await this.page.$$eval('li[title]', elements =>
			elements.map(el => el.getAttribute('title')).filter(Boolean)
		);

		return tabs;
	}

	async switchToTab(tabName) {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		const tabSelector = `li[title="${tabName}"]`;
		try {
			await this.page.waitForSelector(tabSelector, {
				visible: true,
				timeout: this.config.selectorTimeout
			});
			await this.page.click(tabSelector);
			await new Promise(r => setTimeout(r, this.config.actionDelay));
			await this.page.waitForSelector(this.config.selectors.watchlistTable, {
				timeout: this.config.selectorTimeout
			});
			this.currentWatchlist = tabName;
			logDebug(`[InvestingCom] Switched to tab: ${tabName}`);
			return true;
		} catch (e) {
			logDebug(`[InvestingCom] Failed to switch to tab ${tabName}: ${e.message}`);
			return false;
		}
	}

	async listTickers() {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		const tickers = [];
		const rows = await this.page.$$(this.config.selectors.tickerRow);

		for (const row of rows) {
			const symbolCell = await row.$(this.config.selectors.tickerSymbol);
			if (!symbolCell) continue;
			const text = await this.page.evaluate(el => el.textContent, symbolCell);
			if (text && text.trim()) tickers.push(text.trim().toUpperCase());
		}

		return tickers;
	}

	async addTicker(ticker, options = {}) {
		const { assetType = AssetType.STOCK, watchlist } = options;

		const validation = this.validateTicker(ticker, assetType);
		if (!validation.valid) {
			return {
				success: false,
				message: validation.reason,
				error: 'UNSUPPORTED_ASSET_TYPE',
				ticker
			};
		}

		return this._queueOperation(async () => {
			if (!this.isInitialized) {
				return { success: false, message: 'Controller not initialized', ticker };
			}

			if (watchlist && watchlist !== this.currentWatchlist) {
				const switched = await this.switchToTab(watchlist);
				if (!switched) {
					return { success: false, message: `Failed to switch to watchlist: ${watchlist}`, ticker };
				}
			}

			logDebug(`[InvestingCom] Adding ${assetType}: ${ticker}`);

			try {
				await this.page.waitForSelector(this.config.selectors.addSymbolButton, {
					visible: true,
					timeout: this.config.selectorTimeout
				});
				await this.page.click(this.config.selectors.addSymbolButton);
				await new Promise(r => setTimeout(r, 500));

				await this.page.waitForSelector(this.config.selectors.addSymbolInput, {
					visible: true,
					timeout: this.config.selectorTimeout
				});
				await this.page.type(this.config.selectors.addSymbolInput, ticker, { delay: 50 });
				await new Promise(r => setTimeout(r, 1000));

				try {
					await this.page.waitForSelector(this.config.selectors.searchResultItem, {
						visible: true,
						timeout: 5000
					});
					await this.page.click(this.config.selectors.searchResultItem);
				} catch (e) {
					await this.page.click(this.config.selectors.addSymbolSubmit);
				}

				await new Promise(r => setTimeout(r, this.config.actionDelay));

				try {
					await this.page.click(this.config.selectors.modalClose);
				} catch (e) {
					// ignore
				}

				const tickers = await this.listTickers();
				const added = tickers.includes(String(ticker).toUpperCase());
				if (added) {
					logDebug(`[InvestingCom] Successfully added ${ticker}`);
					return { success: true, message: `Added ${ticker} to watchlist`, ticker };
				}

				return { success: false, message: `${ticker} may not have been added (not found in list)`, ticker };
			} catch (e) {
				logDebug(`[InvestingCom] Error adding ${ticker}: ${e.message}`);
				return { success: false, message: e.message, ticker };
			}
		});
	}

	async deleteTicker(ticker, options = {}) {
		const { watchlist } = options;

		return this._queueOperation(async () => {
			if (!this.isInitialized) {
				return { success: false, message: 'Controller not initialized', ticker };
			}

			if (watchlist && watchlist !== this.currentWatchlist) {
				const switched = await this.switchToTab(watchlist);
				if (!switched) {
					return { success: false, message: `Failed to switch to watchlist: ${watchlist}`, ticker };
				}
			}

			logDebug(`[InvestingCom] Deleting ticker: ${ticker}`);

			try {
				const rows = await this.page.$$(this.config.selectors.tickerRow);
				let targetRow = null;

				for (const row of rows) {
					const symbolCell = await row.$(this.config.selectors.tickerSymbol);
					if (!symbolCell) continue;
					const text = await this.page.evaluate(el => el.textContent, symbolCell);
					if (text && text.trim().toUpperCase() === String(ticker).toUpperCase()) {
						targetRow = row;
						break;
					}
				}

				if (!targetRow) {
					return { success: false, message: `Ticker ${ticker} not found in watchlist`, ticker };
				}

				let deleteBtn = await targetRow.$(this.config.selectors.deleteButton);
				if (!deleteBtn) {
					try { await targetRow.hover(); } catch (e) {}
					await new Promise(r => setTimeout(r, 500));
					deleteBtn = await targetRow.$(this.config.selectors.deleteButton);
				}

				if (!deleteBtn) {
					return { success: false, message: 'Delete button not found', ticker };
				}

				await deleteBtn.click();
				await new Promise(r => setTimeout(r, 500));

				try {
					await this.page.waitForSelector(this.config.selectors.deleteConfirm, {
						visible: true,
						timeout: 3000
					});
					await this.page.click(this.config.selectors.deleteConfirm);
				} catch (e) {
					// ignore
				}

				await new Promise(r => setTimeout(r, this.config.actionDelay));

				const tickers = await this.listTickers();
				const removed = !tickers.includes(String(ticker).toUpperCase());
				if (removed) {
					return { success: true, message: `Deleted ${ticker} from watchlist`, ticker };
				}

				return { success: false, message: `${ticker} may not have been deleted (still in list)`, ticker };
			} catch (e) {
				logDebug(`[InvestingCom] Error deleting ${ticker}: ${e.message}`);
				return { success: false, message: e.message, ticker };
			}
		});
	}
}

module.exports = { InvestingComWatchlistController };
