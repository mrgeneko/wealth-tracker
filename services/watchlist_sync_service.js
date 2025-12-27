const { getPricingClassFromSource, getPricingClass } = require('./pricing-utils');
const mysql = require('mysql2/promise');

class WatchlistSyncService {
    constructor(dbPool) {
        this.pool = dbPool;
    }

    /**
     * Syncs dashboard positions to Investing.com watchlists.
     * @param {InvestingComWatchlistController} controller
     */
    async sync(controller) {
        console.log('[WatchlistSync] Starting sync...');

        // 1. Fetch all positions
        console.log('[WatchlistSync] Fetching positions from DB...');
        const [rows] = await this.pool.query('SELECT ticker, type, source, exchange FROM positions');
        console.log(`[WatchlistSync] Fetched ${rows ? rows.length : 0} positions.`);
        if (!rows || rows.length === 0) {
            console.log('[WatchlistSync] No positions found in DB.');
            return;
        }

        // 2. Group tickers by pricing class
        const map = {}; // pricingClass -> Set(tickers)

        for (const row of rows) {
            let pClass = 'US_EQUITY'; // Default
            if (row.source) {
                pClass = getPricingClassFromSource(row.source);
            } else if (row.type) {
                pClass = getPricingClass({ securityType: row.type });
            }

            // Filter for Investing.com relevant classes (heuristic)
            // Or just sync everything and let Investing.com reject invalid ones?
            // Better to only sync known "investing" classes if possible, but for now we'll sync all
            // non-crypto/non-custom ones if they map to something consistent.
            // Actually, verify if pClass is useful.

            // Normalize pClass for tab name (e.g. remove underscores if needed, or keep as is)
            const tabName = pClass;

            if (!map[tabName]) {
                map[tabName] = new Set();
            }
            if (row.ticker) {
                map[tabName].add(row.ticker.toUpperCase());
            }
        }

        // 3. Get existing tabs
        try {
            console.log('[WatchlistSync] Fetching existing tabs from controller...');
            const existingTabs = await controller.getWatchlistTabs();
            console.log('[WatchlistSync] Existing tabs:', existingTabs);

            // 4. Iterate through pClasses and sync (Sorted by size ASC to unblock small updates)
            const sortedEntries = Object.entries(map).sort((a, b) => a[1].size - b[1].size);

            for (const [pClass, tickerSet] of sortedEntries) {
                if (tickerSet.size === 0) continue;

                // Sync individual tab with error isolation
                try {
                    console.log(`[WatchlistSync] Processing tab '${pClass}' (${tickerSet.size} tickers)...`);

                    // Create tab if missing
                    if (!existingTabs.includes(pClass)) {
                        console.log(`[WatchlistSync] Tab '${pClass}' missing. Creating...`);
                        const created = await controller.createWatchlistTab(pClass);
                        if (!created) {
                            console.error(`[WatchlistSync] Failed to create tab '${pClass}'. Skipping.`);
                            continue;
                        }
                    } else {
                        console.log(`[WatchlistSync] Tab '${pClass}' exists.`);
                    }

                    // Sync tickers
                    await controller.switchToTab(pClass);
                    const currentTickers = await controller.listTickers(pClass);
                    const targetTickers = Array.from(tickerSet);

                    // Add missing
                    for (const t of targetTickers) {
                        if (!currentTickers.includes(t)) {
                            console.log(`[WatchlistSync] Adding ${t} to ${pClass}...`);
                            await controller.addTicker(t, { watchlist: pClass });
                        }
                    }

                    // Remove extras
                    for (const t of currentTickers) {
                        if (!tickerSet.has(t)) {
                            console.log(`[WatchlistSync] Removing ${t} from ${pClass} (not in DB for this class)...`);
                            await controller.deleteTicker(t, { watchlist: pClass });
                        }
                    }
                } catch (tabErr) {
                    console.error(`[WatchlistSync] Error syncing tab '${pClass}':`, tabErr);
                    // Continue to next tab
                }
            }
            // 5. Persist new tabs to database
            console.log('[WatchlistSync] Persisting tab URLs to database...');
            const tabMap = await controller.getWatchlistMap();

            // Get provider DB ID
            const [pRows] = await this.pool.query('SELECT id FROM watchlist_providers WHERE provider_id = ?', ['investingcom']);
            if (pRows.length > 0) {
                const providerDbId = pRows[0].id;

                for (const pClass of Object.keys(map)) {
                    const portId = tabMap[pClass];
                    if (portId) {
                        const url = `https://www.investing.com/portfolio/?portfolioID=${portId}`;
                        // UPSERT
                        await this.pool.query(
                            `INSERT INTO watchlist_instances (provider_id, watchlist_key, watchlist_name, watchlist_url, enabled)
                             VALUES (?, ?, ?, ?, 1)
                             ON DUPLICATE KEY UPDATE watchlist_url = VALUES(watchlist_url)`,
                            [providerDbId, pClass, pClass, url]
                        );
                        console.log(`[WatchlistSync] Saved ${pClass} -> ${url}`);
                    }
                }
            } else {
                console.error('[WatchlistSync] Provider "investingcom" not found in DB. Skipping persistence.');
            }

            console.log('[WatchlistSync] Sync completed.');

        } catch (e) {
            console.error('[WatchlistSync] Error during sync:', e);
        }
    }
}

module.exports = WatchlistSyncService;
