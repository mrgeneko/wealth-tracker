const { AssetType } = require('./base_watchlist_controller');
const { InvestingComWatchlistController } = require('./investingcom_watchlist_controller');
const { logDebug } = require('../scraper_utils');

class WatchlistManager {
	constructor() {
		this.providers = new Map();
		this.providerConfigs = new Map();
	}

	registerProvider(providerId, ControllerClass, options = {}) {
		this.providerConfigs.set(providerId, { ControllerClass, options });
		logDebug(`[WatchlistManager] Registered provider: ${providerId}`);
	}

	async initializeProvider(providerId, browser, url) {
		const config = this.providerConfigs.get(providerId);
		if (!config) {
			throw new Error(`Unknown provider: ${providerId}`);
		}

		const { ControllerClass, options } = config;
		const controller = new ControllerClass(browser, options);
		await controller.initialize(url);
		this.providers.set(providerId, controller);
		logDebug(`[WatchlistManager] Initialized provider: ${providerId}`);
		return controller;
	}

	getProvider(providerId) {
		return this.providers.get(providerId) || null;
	}

	getRegisteredProviders() {
		return Array.from(this.providerConfigs.keys());
	}

	getInitializedProviders() {
		return Array.from(this.providers.keys());
	}

	getAllCapabilities() {
		const capabilities = {};
		for (const [providerId, { ControllerClass }] of this.providerConfigs) {
			const temp = Object.create(ControllerClass.prototype);
			if (typeof temp.getCapabilities === 'function') {
				capabilities[providerId] = temp.getCapabilities();
			}
		}
		return capabilities;
	}

	getProvidersForAssetType(assetType) {
		const matching = [];
		const capabilities = this.getAllCapabilities();
		for (const [providerId, caps] of Object.entries(capabilities)) {
			if (caps.supportedAssetTypes.includes(assetType)) {
				matching.push(providerId);
			}
		}
		return matching;
	}

	getAllStatus() {
		const status = {};
		for (const [providerId, controller] of this.providers) {
			status[providerId] = controller.getStatus();
		}
		return status;
	}

	async shutdown() {
		for (const [providerId] of this.providers) {
			logDebug(`[WatchlistManager] Shutting down: ${providerId}`);
		}
		this.providers.clear();
	}
}

const watchlistManager = new WatchlistManager();
watchlistManager.registerProvider('investingcom', InvestingComWatchlistController, {});

module.exports = { WatchlistManager, watchlistManager, AssetType };
