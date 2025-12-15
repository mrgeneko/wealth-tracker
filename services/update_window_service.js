const { DateTime } = require('luxon');

class UpdateWindowService {
	constructor(dbPool = null) {
		this.dbPool = dbPool;
		this.cache = null;
		this.cacheExpiry = 0;
		this.cacheTtlMs = 60 * 1000;
	}

	async isWithinUpdateWindow(ticker, providerId = null, watchlistKey = null) {
		const windows = await this._getWindows();
		if (!windows || windows.length === 0) {
			return { allowed: true, reason: 'no_windows_defined' };
		}

		const now = DateTime.now();
		const candidates = this._findApplicableWindows(windows, ticker, providerId, watchlistKey);
		if (candidates.length === 0) {
			return { allowed: true, reason: 'no_applicable_windows' };
		}

		for (const window of candidates) {
			const zone = window.timezone || 'America/New_York';
			const localNow = now.setZone(zone);
			const dayNames = ['', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
			const currentDay = dayNames[localNow.weekday];

			if (!Array.isArray(window.days) || !window.days.includes(currentDay)) {
				continue;
			}

			const currentMinutes = localNow.hour * 60 + localNow.minute;
			const [startH, startM] = String(window.startTime).split(':').map(Number);
			const [endH, endM] = String(window.endTime).split(':').map(Number);
			const startMinutes = startH * 60 + startM;
			const endMinutes = endH * 60 + endM;

			if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
				return {
					allowed: true,
					reason: `within_window:${window.startTime}-${window.endTime}`,
					window
				};
			}
		}

		return { allowed: false, reason: `outside_all_windows:${now.toFormat('EEE HH:mm')}` };
	}

	_findApplicableWindows(windows, ticker, providerId, watchlistKey) {
		return windows
			.filter(w => w && w.enabled)
			.filter(w => {
				if (w.ticker && w.ticker !== ticker && w.ticker !== 'default') return false;
				if (w.providerId && providerId && w.providerId !== providerId) return false;
				if (w.providerId && !providerId) return false;
				if (w.watchlistKey && watchlistKey && w.watchlistKey !== watchlistKey) return false;
				if (w.watchlistKey && !watchlistKey) return false;
				return true;
			})
			.sort((a, b) => {
				const score = (w) => {
					let s = w.priority || 0;
					if (w.ticker && w.ticker !== 'default') s += 1000;
					if (w.watchlistKey) s += 100;
					if (w.providerId) s += 10;
					return s;
				};
				return score(b) - score(a);
			});
	}

	async _getWindows() {
		if (this.cache && Date.now() < this.cacheExpiry) {
			return this.cache;
		}

		if (!this.dbPool) {
			throw new Error('Database pool not initialized.');
		}

		const [rows] = await this.dbPool.query('SELECT * FROM update_windows WHERE enabled = 1');
		const windows = (rows || []).map(row => ({
			providerId: row.provider_id || null,
			watchlistKey: row.watchlist_key || null,
			ticker: row.ticker || null,
			days: typeof row.days === 'string' ? this._parseJsonSafe(row.days) : row.days,
			startTime: row.start_time,
			endTime: row.end_time,
			timezone: row.timezone,
			enabled: !!row.enabled,
			priority: row.priority || 0
		})).map(w => ({
			...w,
			days: Array.isArray(w.days) ? w.days : []
		}));

		this.cache = windows;
		this.cacheExpiry = Date.now() + this.cacheTtlMs;
		return windows;
	}

	_parseJsonSafe(txt) {
		try {
			return JSON.parse(txt);
		} catch (e) {
			return null;
		}
	}
}

module.exports = { UpdateWindowService };
