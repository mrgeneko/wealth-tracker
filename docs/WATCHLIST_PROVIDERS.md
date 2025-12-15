# Watchlist Providers (Phase 11)

This document explains how the watchlist management system is configured and how to add a new provider.

## Architecture overview

There are two HTTP layers:

1) **Scrapers daemon** (browser process)
- Exposes provider-based endpoints on the health server (default `HEALTH_PORT=3000` inside the scrapers container).
- Routes are under `/watchlist/...`.

2) **Dashboard server**
- Proxies those endpoints under `/api/watchlist/...` so the UI can call a single backend.
- Configure via `SCRAPER_HOST` and `SCRAPER_PORT`.

Providers are implemented as controllers under `scrapers/watchlist/` and registered in the `watchlistManager` registry.

## Configuration sources (DB-first)

At runtime, watchlist configuration loads in this order:

1) **MySQL** (preferred)
- `watchlist_providers` (provider enable/disable, defaults)
- `watchlist_instances` (per-watchlist URL, interval override, optional asset-type constraints)

2) **config/config.json** (fallback)
- `watchlist_providers` object (same conceptual shape)

The loader is implemented in `services/watchlist_config_loader.js`.

### Schema initialization

Fresh containers apply schema in:
- `scripts/init-db/001-listing-sync-watchlist.sql`

Note: MySQL init scripts run only on a *fresh* database volume.

## Scheduling & update windows

The scrapers daemon schedules watchlist scrapes using:

- **Scrape group settings**: `scrape_groups.<groupName>` in `config/config.json` controls enable/disable and default intervals.
- **Per-watchlist marker files**: stored under `/usr/src/app/logs/` as:

  `last.watchlist.{provider}.{watchlistKey}.txt`

- **Update windows**: `update_windows` table gates whether a watchlist run (and per-ticker publishes) are allowed at the current time.

The decision logic lives in `services/update_window_service.js`.

## Provider controller contract

To add a provider, implement a controller that extends `BaseWatchlistController`:

Required methods:
- `getCapabilities()`
- `initialize(watchlistUrl)`
- `getWatchlistTabs()`
- `switchToTab(watchlistKey)`
- `listTickers(watchlistKey)`
- `addTicker(ticker, { watchlistKey, assetType })`
- `deleteTicker(ticker, { watchlistKey })`

Key behaviors:
- **Asset type validation** should occur before queueing navigation/DOM work.
- **Operation queue** should serialize add/delete operations to avoid races.

## Registering a provider

Add registration to the watchlist manager (currently registers `investingcom`):

- `scrapers/watchlist/watchlist_manager.js`

Then expose the provider via config (DB seed or config fallback) so it can be initialized.

## Endpoints

Scrapers daemon routes:
- `GET /watchlist/providers`
- `GET /watchlist/:provider/status`
- `GET /watchlist/:provider/tabs`
- `GET /watchlist/:provider/tickers`
- `POST /watchlist/:provider/add`
- `POST /watchlist/:provider/delete`

Dashboard proxy routes:
- `GET /api/watchlist/providers`
- `GET /api/watchlist/:provider/status`
- `GET /api/watchlist/:provider/tabs`
- `GET /api/watchlist/:provider/tickers`
- `POST /api/watchlist/:provider/add`
- `POST /api/watchlist/:provider/delete`
