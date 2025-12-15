const fs = require('fs');
const path = require('path');

function resolveConfigPath() {
	if (process.env.CONFIG_PATH) return process.env.CONFIG_PATH;

	// Prefer the docker-mounted config directory when running in containers.
	const containerPath = path.join('/usr/src/app', 'config', 'config.json');
	if (fs.existsSync(containerPath)) return containerPath;

	// Fallback to repo-relative path for local runs.
	return path.join(__dirname, '..', 'config', 'config.json');
}

class WatchlistConfigLoader {
	constructor(dbPool = null) {
		this.dbPool = dbPool;
		this.cache = null;
		this.cacheExpiry = 0;
		this.cacheTtlMs = 5 * 60 * 1000;

		this._configPath = resolveConfigPath();
		this._cachedConfig = null;
		this._cachedConfigMtimeMs = 0;
	}

	async getProviders() {
		if (this.cache && Date.now() < this.cacheExpiry) {
			return this.cache;
		}

		let providers;

		if (this.dbPool) {
			try {
				providers = await this._loadFromDatabase();
			} catch (e) {
				console.warn('[WatchlistConfigLoader] Failed to load from database, falling back to config:', e.message);
			}
		}

		if (!providers) {
			providers = this._loadFromConfig();
		}

		this.cache = providers;
		this.cacheExpiry = Date.now() + this.cacheTtlMs;
		return providers;
	}

	async getProvider(providerId) {
		const providers = await this.getProviders();
		return providers[providerId] || null;
	}

	async getWatchlists(providerId) {
		const provider = await this.getProvider(providerId);
		return provider && provider.watchlists ? provider.watchlists : [];
	}

	async _loadFromDatabase() {
		const [providersRows] = await this.dbPool.query(
			'\n\t\tSELECT * FROM watchlist_providers WHERE enabled = 1\n\t\t'
		);

		const [instancesRows] = await this.dbPool.query(
			`\n\t\tSELECT wi.*, wp.provider_id AS provider_key\n\t\tFROM watchlist_instances wi\n\t\tJOIN watchlist_providers wp ON wi.provider_id = wp.id\n\t\tWHERE wi.enabled = 1 AND wp.enabled = 1\n\t\t`
		);

		const result = {};

		for (const p of providersRows) {
			const providerKey = p.provider_id;
			const supportedAssetTypes = this._parseJsonSafe(p.supported_asset_types);

			result[providerKey] = {
				providerId: providerKey,
				displayName: p.display_name,
				enabled: !!p.enabled,
				authMethod: p.auth_method,
				defaultIntervalSeconds: p.default_interval_seconds,
				supportedAssetTypes: Array.isArray(supportedAssetTypes) ? supportedAssetTypes : null,
				watchlists: instancesRows
					.filter(i => i.provider_key === providerKey)
					.map(i => {
						const allowedAssetTypes = this._parseJsonSafe(i.allowed_asset_types);
						return {
							key: i.watchlist_key,
							name: i.watchlist_name,
							url: i.watchlist_url,
							intervalSeconds: i.interval_seconds || p.default_interval_seconds,
							enabled: !!i.enabled,
							allowedAssetTypes: Array.isArray(allowedAssetTypes) ? allowedAssetTypes : null
						};
					})
			};
		}

		return result;
	}

	_loadFromConfig() {
		const attrs = this._loadConfigFile();
		const config = attrs && attrs.watchlist_providers ? attrs.watchlist_providers : null;

		if (!config) {
			throw new Error('watchlist_providers config not found. Ensure config.json is configured or database is seeded.');
		}

		const result = {};
		for (const [providerId, providerConfig] of Object.entries(config)) {
			const watchlists = Array.isArray(providerConfig.watchlists) ? providerConfig.watchlists : [];

			result[providerId] = {
				providerId: providerConfig.provider_id || providerId,
				displayName: providerConfig.display_name,
				enabled: providerConfig.enabled !== false,
				supportedAssetTypes: providerConfig.supported_asset_types || null,
				authMethod: providerConfig.auth_method,
				defaultIntervalSeconds: providerConfig.default_interval_seconds,
				watchlists: watchlists.map(w => ({
					key: w.key,
					name: w.name,
					url: w.url_env_var ? process.env[w.url_env_var] : w.url,
					intervalSeconds: w.interval_seconds,
					enabled: w.enabled !== false,
					allowedAssetTypes: w.allowed_asset_types || null
				}))
			};
		}

		return result;
	}

	_loadConfigFile() {
		try {
			const st = fs.statSync(this._configPath);
			const mtimeMs = st && st.mtimeMs ? st.mtimeMs : 0;
			if (this._cachedConfig && this._cachedConfigMtimeMs === mtimeMs) {
				return this._cachedConfig;
			}

			const txt = fs.readFileSync(this._configPath, 'utf8');
			this._cachedConfig = JSON.parse(txt);
			this._cachedConfigMtimeMs = mtimeMs;
			return this._cachedConfig;
		} catch (e) {
			console.warn('[WatchlistConfigLoader] Failed to read config.json:', e.message);
			return this._cachedConfig || {};
		}
	}

	_parseJsonSafe(value) {
		if (value == null) return null;
		if (Array.isArray(value) || typeof value === 'object') return value;
		if (typeof value !== 'string') return null;
		try {
			return JSON.parse(value);
		} catch (e) {
			return null;
		}
	}
}

module.exports = { WatchlistConfigLoader };
