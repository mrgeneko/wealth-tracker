const { BaseWatchlistController, AssetType } = require('./base_watchlist_controller');
const { logDebug, createPreparedPage, savePageSnapshot, sanitizeForFilename, getDateTimeString } = require('../scraper_utils');

const DEFAULT_CONFIG = {
	selectorTimeout: 10000,
	navigationTimeout: 15000,
	actionDelay: 1000,
	selectors: {
		// Investing.com watchlists often expose an always-visible "Add symbol" search box
		// rather than a dedicated "Add" button.
		addSymbolInput:
			'div.js-watchlist-portfolio:not(.displayNone) input[id^="searchText_"], .watchlist-search input.searchText, input[id^="searchText_"]',
		searchPopupVisible:
			'div.js-watchlist-portfolio:not(.displayNone) .searchPopupResults:not(.displayNone), .searchPopupResults:not(.displayNone)',
		searchResultsContainer:
			'div.js-watchlist-portfolio:not(.displayNone) div[id^="searchTopResults_"], div[id^="searchTopResults_"]',
		searchResultItem:
			'div[id^="searchTopResults_"] tr.row, div[id^="searchTopResults_"] tr[data-pair-id]',
		deleteButton: 'a[rel^="removePairFromPortfolio_"], a.bugCloseIcon[data-tooltip="Delete"], a[rel*="removePairFromPortfolio"]',
		deleteConfirm: '.js-confirm-delete, button:has-text("Confirm"), button:has-text("Yes"), a:has-text("Delete")',
		watchlistTable: '[id^="tbody_overview_"]',
		tickerRow: 'tbody[id^="tbody_overview_"] > tr, [id^="tbody_overview_"] > tr',
		tickerSymbol: 'td[data-column-name="symbol"]',
		modalClose: '.js-modal-close, [data-test="modal-close"], button.close',
		// Create Portfolio Selectors
		createPortfolioBtn: '.js-add-portfolio, .plusIcon, .plusTab, span[data-tooltip="Create a New Portfolio"]',
		createPortfolioInput: '#portfolioName, #newPortfolioText, input[data-test="portfolio-name-input"]',
		createPortfolioSubmit: '#createPortfolioBtn, #createPortfolio, button[data-test="create-portfolio-submit"]'
	}
};

class InvestingComWatchlistController extends BaseWatchlistController {
	constructor(browser, options = {}) {
		super(browser, options);
		this.config = { ...DEFAULT_CONFIG, ...options };
	}

	async _ensureLoggedIn(watchlistUrl) {
		// Best-effort: if already logged in, the login form selector won't be present.
		let needsLogin = false;
		try {
			await this.page.waitForSelector('#loginFormUser_email', { timeout: 3000 });
			needsLogin = true;
			logDebug('[InvestingCom] Login form detected');
		} catch (e) {
			logDebug('[InvestingCom] No login form detected (likely already logged in)');
		}

		if (!needsLogin) return;

		const investingEmail = process.env.INVESTING_EMAIL;
		const investingPassword = process.env.INVESTING_PASSWORD;
		if (!investingEmail || !investingPassword) {
			throw new Error('Investing.com login required but INVESTING_EMAIL/INVESTING_PASSWORD are not set');
		}

		logDebug('[InvestingCom] Attempting login with provided credentials');
		await this.page.type('#loginFormUser_email', investingEmail, { delay: 50 });
		await this.page.type('#loginForm_password', investingPassword, { delay: 50 });
		let submitted = false;
		try {
			await this.page.keyboard.press('Enter');
			submitted = true;
		} catch (e) {
			// ignore
		}
		// Clicking submit is often more reliable than Enter (e.g., overlays/recaptcha).
		try {
			await this.page.click(
				'#login_page_container a[onclick*="submitLogin"], a[onclick*="submitLogin"], button[type="submit"], #loginFormUser_submit'
			);
			submitted = true;
		} catch (e) {
			// ignore
		}

		if (!submitted) {
			throw new Error('Investing.com login form detected but could not submit login');
		}

		// Give the page a moment to process the login request.
		await new Promise(r => setTimeout(r, 750));

		// Wait for the login form to disappear OR for a known post-login selector.
		try {
			await Promise.race([
				this.page.waitForFunction(() => !document.querySelector('#loginFormUser_email'), { timeout: this.config.selectorTimeout }),
				this.page.waitForSelector(this.config.selectors.watchlistTable, { timeout: this.config.selectorTimeout }),
				this.page.waitForSelector('a[name^="tab1_"][tab="overview"]', { timeout: this.config.selectorTimeout }),
				this.page.waitForSelector('h1::-p-text("My Watchlist")', { timeout: this.config.selectorTimeout })
			]);
		} catch (waitErr) {
			// If the login popup shows a server error, report it explicitly.
			try {
				const errText = await this.page.$eval('#serverErrors', el => (el && el.textContent ? el.textContent.trim() : ''));
				if (errText) {
					throw new Error(`Investing.com login failed: ${errText}`);
				}
			} catch (e) {
				if (e && e.message && e.message.startsWith('Investing.com login failed:')) {
					throw e;
				}
				// ignore (selector may not exist)
			}
			throw waitErr;
		}

		// Some flows redirect away from the portfolio; navigate back to the watchlist URL.
		if (watchlistUrl) {
			try {
				await this.page.goto(watchlistUrl, {
					waitUntil: 'domcontentloaded',
					timeout: this.config.navigationTimeout
				});
			} catch (e) {
				logDebug('[InvestingCom] Post-login navigation back to watchlist URL failed: ' + (e && e.message ? e.message : e));
			}
		}

		logDebug('[InvestingCom] Login flow completed');
	}

	getCapabilities() {
		return {
			providerId: 'investingcom',
			displayName: 'Investing.com',
			supportedAssetTypes: [AssetType.STOCK, AssetType.ETF],
			supportedAssetTypes: [AssetType.STOCK, AssetType.ETF],
			supportsMultipleWatchlists: true,
			requiresLogin: true,
			maxTickersPerWatchlist: 100,
			rateLimitMs: 1000
		};
	}

	async initialize(watchlistUrl) {
		logDebug('[InvestingCom] Initializing...');

		try {
			this.page = await createPreparedPage(this.browser, {
				reuseIfUrlMatches: /investing\.com/,
				url: watchlistUrl,
				waitUntil: 'domcontentloaded',
				timeout: this.config.navigationTimeout,
				reloadExisting: true
			});

			try {
				await this.page.bringToFront();
			} catch (e) {
				// ignore
			}

			await this._ensureLoggedIn(watchlistUrl);

			await this.page.waitForSelector(this.config.selectors.watchlistTable, {
				timeout: this.config.selectorTimeout
			});

			this.isInitialized = true;
			logDebug('[InvestingCom] Initialized successfully');
		} catch (e) {
			try {
				const base = require('path').join(
					process.env.LOG_DIR || '/usr/src/app/logs',
					`${getDateTimeString()}.investingcom_watchlist_init_failure.${sanitizeForFilename('investingcom')}`
				);
				await savePageSnapshot(this.page, base);
				logDebug('[InvestingCom] Wrote diagnostic snapshot to ' + base + '.*');
			} catch (snapErr) {
				logDebug('[InvestingCom] Failed to write diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
			}
			throw e;
		}
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

	async getWatchlistMap() {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		// Returns { "TabName": "portfolioID" }
		const map = await this.page.$$eval('li.portfolioTab[title][data-portfolio-id]', elements => {
			const m = {};
			for (const el of elements) {
				const title = el.getAttribute('title');
				const id = el.getAttribute('data-portfolio-id');
				if (title && id) {
					m[title] = id;
				}
			}
			return m;
		});
		return map;
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

	async createWatchlistTab(tabName) {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		logDebug(`[InvestingCom] Creating new watchlist tab: ${tabName}`);

		// Check if it already exists
		const existingTabs = await this.getWatchlistTabs();
		if (existingTabs.includes(tabName)) {
			logDebug(`[InvestingCom] Tab ${tabName} already exists.`);
			return true;
		}

		try {
			// Click the + button
			await this.page.waitForSelector(this.config.selectors.createPortfolioBtn, {
				visible: true,
				timeout: this.config.selectorTimeout
			});
			await this.page.click(this.config.selectors.createPortfolioBtn);

			// Wait for input
			await this.page.waitForSelector(this.config.selectors.createPortfolioInput, {
				visible: true,
				timeout: this.config.selectorTimeout
			});

			// Type name
			await this.page.type(this.config.selectors.createPortfolioInput, tabName, { delay: 50 });

			// Submit
			await this.page.click(this.config.selectors.createPortfolioSubmit);

			// Wait for it to be created and appear in the list
			await new Promise(r => setTimeout(r, 1000));
			await this.page.waitForFunction(
				(name) => {
					const tabs = Array.from(document.querySelectorAll('li[title]')).map(el => el.getAttribute('title'));
					return tabs.includes(name);
				},
				{ timeout: this.config.selectorTimeout },
				tabName
			);

			logDebug(`[InvestingCom] Created tab: ${tabName}`);
			return true;
		} catch (e) {
			try {
				const base = require('path').join(
					process.env.LOG_DIR || '/usr/src/app/logs',
					`${getDateTimeString()}.investingcom_watchlist_create_tab_failure.${sanitizeForFilename(tabName)}`
				);
				await savePageSnapshot(this.page, base);
				logDebug('[InvestingCom] Wrote create-tab failure snapshot to ' + base + '.*');
			} catch (snapErr) {
				logDebug('[InvestingCom] Failed to write create-tab failure snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
			}
			logDebug(`[InvestingCom] Failed to create tab ${tabName}: ${e.message}`);
			// Try to close modal if it's stuck open
			try { await this.page.click(this.config.selectors.modalClose); } catch (ignore) { }
			return false;
		}
	}

	async listTickers(watchlist = null) {
		if (!this.isInitialized) {
			throw new Error('Controller not initialized');
		}

		// Switch to the specified watchlist tab if provided
		if (watchlist) {
			logDebug(`[InvestingCom] listTickers called with watchlist: ${watchlist}, current: ${this.currentWatchlist}`);
			if (watchlist !== this.currentWatchlist) {
				const switched = await this.switchToTab(watchlist);
				if (!switched) {
					throw new Error(`Failed to switch to watchlist: ${watchlist}`);
				}
			}
		}

		const tickerData = await this.page.$$eval(
			this.config.selectors.tickerRow,
			(rows) => {
				return rows.map(row => {
					const symbolCell = row.querySelector('td[data-column-name="symbol"]');
					const nameCell = row.querySelector('td[data-column-name="name"]');
					return {
						symbolText: symbolCell ? symbolCell.textContent.trim() : null,
						nameText: nameCell ? nameCell.textContent.trim() : null
					};
				});
			}
		);

		const tickers = [];
		for (const d of tickerData) {
			let raw = d.symbolText || d.nameText;
			if (raw) {
				// Strip extra text (like "Create Alert") if it exists
				const clean = raw.split('\n')[0].trim().toUpperCase();
				if (clean) tickers.push(clean);
			}
		}

		logDebug(`[InvestingCom] Found ${tickers.length} tickers on ${watchlist || this.currentWatchlist || 'current tab'}`);
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
				const existing = await this.listTickers();
				if (existing.includes(String(ticker).toUpperCase())) {
					return { success: true, message: `${ticker} already in watchlist`, ticker };
				}

				await this.page.waitForSelector(this.config.selectors.addSymbolInput, {
					visible: true,
					timeout: this.config.selectorTimeout
				});
				await this.page.click(this.config.selectors.addSymbolInput, { clickCount: 3 });
				try {
					await this.page.keyboard.press('Backspace');
				} catch (e) {
					// ignore
				}
				await this.page.type(this.config.selectors.addSymbolInput, ticker, { delay: 50 });
				await new Promise(r => setTimeout(r, 750));

				let didSelectResult = false;
				try {
					await this.page.waitForSelector(this.config.selectors.searchPopupVisible, { timeout: 5000 });
					await this.page.waitForSelector(this.config.selectors.searchResultsContainer, { timeout: 5000 });
					await this.page.waitForSelector(this.config.selectors.searchResultItem, { timeout: 5000 });

					const resultHandles = await this.page.$$(this.config.selectors.searchResultItem);
					let targetHandle = null;
					for (const handle of resultHandles) {
						const text = await this.page.evaluate(el => (el.textContent || '').trim(), handle);
						if (text && text.toUpperCase().includes(String(ticker).toUpperCase())) {
							targetHandle = handle;
							break;
						}
					}
					if (!targetHandle && resultHandles.length > 0) targetHandle = resultHandles[0];
					if (targetHandle) {
						await targetHandle.click();
						didSelectResult = true;
					}
				} catch (e) {
					// ignore and fall back to Enter
				}

				if (!didSelectResult) {
					try {
						await this.page.keyboard.press('Enter');
					} catch (e) {
						// ignore
					}
				}

				await new Promise(r => setTimeout(r, this.config.actionDelay));

				try {
					await this.page.click(this.config.selectors.modalClose);
				} catch (e) {
					// ignore
				}

				try {
					await this.page.waitForFunction(
						symbol => {
							const cells = Array.from(
								document.querySelectorAll('tbody[id^="tbody_overview_"] td[data-column-name="symbol"]')
							);
							return cells.some(c => (c.textContent || '').trim().toUpperCase() === String(symbol).toUpperCase());
						},
						{ timeout: this.config.selectorTimeout },
						ticker
					);
				} catch (e) {
					// fall back to listTickers validation
				}

				const tickers = await this.listTickers();
				if (tickers.includes(String(ticker).toUpperCase())) {
					logDebug(`[InvestingCom] Successfully added ${ticker}`);
					return { success: true, message: `Added ${ticker} to watchlist`, ticker };
				}
				try {
					const base = require('path').join(
						process.env.LOG_DIR || '/usr/src/app/logs',
						`${getDateTimeString()}.investingcom_watchlist_add_not_added.${sanitizeForFilename(String(ticker || 'unknown'))}`
					);
					await savePageSnapshot(this.page, base);
					logDebug('[InvestingCom] Wrote add-ticker not-added snapshot to ' + base + '.*');
				} catch (snapErr) {
					logDebug('[InvestingCom] Failed to write add-ticker not-added snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
				}
				return { success: false, message: `${ticker} may not have been added (not found in list)`, ticker };
			} catch (e) {
				try {
					const base = require('path').join(
						process.env.LOG_DIR || '/usr/src/app/logs',
						`${getDateTimeString()}.investingcom_watchlist_add_failure.${sanitizeForFilename(String(ticker || 'unknown'))}`
					);
					await savePageSnapshot(this.page, base);
					logDebug('[InvestingCom] Wrote add-ticker diagnostic snapshot to ' + base + '.*');
				} catch (snapErr) {
					logDebug('[InvestingCom] Failed to write add-ticker diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
				}
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
					// Use updated logic for deletion matching as well
					const foundMatch = await this.page.evaluate((r, t) => {
						const symbolCell = r.querySelector('td[data-column-name="symbol"]');
						const nameCell = r.querySelector('td[data-column-name="name"]');
						let raw = (symbolCell && symbolCell.textContent && symbolCell.textContent.trim()) || (nameCell && nameCell.textContent && nameCell.textContent.trim()) || '';
						const clean = raw.split('\n')[0].trim().toUpperCase();
						return clean === String(t).toUpperCase();
					}, row, ticker);

					if (foundMatch) {
						targetRow = row;
						break;
					}
				}

				if (!targetRow) {
					return { success: false, message: `Ticker ${ticker} not found in watchlist`, ticker };
				}

				let deleteBtn = await targetRow.$(this.config.selectors.deleteButton);
				if (!deleteBtn) {
					try { await targetRow.hover(); } catch (e) { }
					await new Promise(r => setTimeout(r, 500));
					deleteBtn = await targetRow.$(this.config.selectors.deleteButton);
				}

				if (!deleteBtn) {
					return { success: false, message: 'Delete button not found', ticker };
				}

				// Some remove icons are not "clickable" due to overlays; fall back to DOM click.
				try {
					await deleteBtn.click();
				} catch (clickErr) {
					try {
						await this.page.evaluate(el => el && el.click && el.click(), deleteBtn);
					} catch (evalErr) {
						throw clickErr;
					}
				}
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
				try {
					const base = require('path').join(
						process.env.LOG_DIR || '/usr/src/app/logs',
						`${getDateTimeString()}.investingcom_watchlist_delete_failure.${sanitizeForFilename(String(ticker || 'unknown'))}`
					);
					await savePageSnapshot(this.page, base);
					logDebug('[InvestingCom] Wrote delete-ticker diagnostic snapshot to ' + base + '.*');
				} catch (snapErr) {
					logDebug('[InvestingCom] Failed to write delete-ticker diagnostic snapshot: ' + (snapErr && snapErr.message ? snapErr.message : snapErr));
				}
				logDebug(`[InvestingCom] Error deleting ${ticker}: ${e.message}`);
				return { success: false, message: e.message, ticker };
			}
		});
	}
}

module.exports = { InvestingComWatchlistController };
