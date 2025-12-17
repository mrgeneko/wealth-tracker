# wealth-tracker

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-%3E%3D20.10-blue)](https://www.docker.com/)

Lightweight scrapers and processors for personal portfolio tracking.

**A real-time portfolio tracking system** that scrapes stock, ETF, and bond prices from multiple sources (Yahoo Finance, Google Finance, Robinhood, and more), stores data in MySQL, publishes to Kafka, and provides a live web dashboard with WebSocket updates.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start-docker-compose)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Multi-Source Data Collection**: Scrapes from 15+ financial data providers
- **Real-time Updates**: WebSocket-based dashboard with sub-100ms latency
- **Comprehensive Coverage**: Stocks, ETFs, bonds, and US Treasury securities
- **Flexible Configuration**: Database-backed update windows and watchlists
- **Docker-First**: Fully containerized with Docker Compose
- **Production Ready**: 615+ unit tests, extensive error handling, logging
 - **Real-time Updates**: WebSocket-based dashboard with low-latency (sub-second) updates
 - **Production Ready**: extensive unit tests, robust error handling, and logging

## Prerequisites

Before running this project, ensure you have:

- **Node.js**: v18.0.0 or higher ([Download](https://nodejs.org/))
- **Docker**: v20.10 or higher ([Download](https://www.docker.com/get-started))
- **Docker Compose**: v2.0 or higher (included with Docker Desktop)
- **Git**: For cloning the repository
- **8GB RAM minimum**: Recommended for running all services
- **Ports Available**: 3001 (dashboard), 3306 (MySQL), 9092 (Kafka), 2181 (Zookeeper)

### Environment Setup

1. Create a `.env` file in the project root:
```bash
cp .env.example .env
```

2. Configure required credentials:
```env
# MySQL
MYSQL_ROOT_PASSWORD=your_secure_password
MYSQL_DATABASE=wealth_tracker
MYSQL_USER=wealth_user
MYSQL_PASSWORD=your_secure_password

# Investing.com (optional, for investing.com watchlists)
INVESTING_EMAIL=your_email@example.com
INVESTING_PASSWORD=your_password
```

3. Create your configuration:
```bash
cp config/config.example.json config/config.json
# Edit config/config.json with your portfolio settings
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Compose Stack                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────┐ │
│  │   Scrapers   │─────▶│    Kafka     │─────▶│  Consumer │ │
│  │  (Puppeteer) │      │  (Messages)  │      │  (Python) │ │
│  └──────────────┘      └──────────────┘      └─────┬─────┘ │
│         │                                            │       │
│         │                                            ▼       │
│         │              ┌──────────────┐      ┌───────────┐ │
│         └─────────────▶│    MySQL     │◀─────│ Dashboard │ │
│                        │  (Storage)   │      │ (Web UI)  │ │
│                        └──────────────┘      └───────────┘ │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

This repository contains Node.js scraper code that runs a persistent daemon to collect price and watchlist data from multiple sources (Yahoo Finance, Google Finance, Robinhood, StockEvents, and more) using Puppeteer/Chrome, publishes messages to Kafka, and provides a real-time web dashboard for portfolio tracking. The system supports comprehensive data management with import/export capabilities and persistent settings.
This README focuses on running the project in Docker, the long-running scraper daemon, and operational instructions (start/stop/logs/heartbeat). For additional operational notes see `DAEMON.md`.
---
## Fresh Container Setup

**⚠️ Important:** Before running a fresh container, validate your setup:

```bash
# Validate all dependencies and configurations
./scripts/validate-fresh-container.sh
```

This script checks for:
- ✅ `.env` file with required credentials
- ✅ Required data files (CSV symbol files)
- ✅ Port availability (3001, 3306, 9092, 2181)
- ✅ Docker and Docker Compose installation
- ✅ Existing containers/volumes

If validation fails, fix the errors before proceeding. See [FRESH_CONTAINER_ISSUES.md](FRESH_CONTAINER_ISSUES.md) for detailed troubleshooting.

## Quick Start (Docker Compose)
The easiest way to run the full stack locally (Kafka, Zookeeper, MySQL, scrapers, etc.) is with Docker Compose.

1. **Validate setup** (fresh install only):
```bash
./scripts/validate-fresh-container.sh
```

2. Build and start services:
```bash
# build the scrapers image and start the scrapers service only
docker compose build scrapers
docker compose up -d scrapers
# or start the entire stack
docker compose up -d
```
Note about memory limits: `deploy` settings in `docker-compose.yml` are only honored by Docker Swarm. To enforce runtime memory limits with plain Docker Compose, set a service-level memory limit appropriate for your environment (e.g., `mem_limit` or `resources` fields depending on your Compose version).

3. See running services:
```bash
docker compose ps
```
4. View logs for scrapers (follow):
```bash
docker compose logs -f scrapers
```

Optional: start the log rotator sidecar that compresses and prunes old logs (recommended when running long-lived scrapers):

```bash
# start only the rotator
docker compose up -d log-rotator

# the rotator is also started when you bring up the entire stack
docker compose up -d
```

Tuning retention and compression:

- The rotator script accepts arguments: `<log_dir> <retention_days> <compression_level> <loop_seconds>`.
- To change retention and compression, update the `entrypoint` args in the `docker-compose.yml` `log-rotator` service. Example: keep logs 14 days, use gzip level 1, and run every 10 minutes:

```yaml
log-rotator:
	entrypoint: ["sh","/usr/local/bin/rotate-logs.sh","/usr/src/app/logs","14","1","600"]
```

Notes:
- `retention_days` removes `.log` and `.gz` files older than the value.
- `compression_level` follows `gzip` levels (1 = fastest, 9 = best compression).
- `loop_seconds` controls how often the rotator checks and compresses old logs.
4. Stop just the scrapers gracefully:
```bash
docker compose stop scrapers
```
To stop and remove all compose services:
```bash
docker compose down
```

## How to Run Integration Tests (Docker MySQL)

Integration tests expect a MySQL database with the schema initialized.

1. Start MySQL via Docker Compose:

```bash
docker compose up -d mysql
docker compose ps
```

2. Export DB environment variables for tests (match your `.env` / compose config):

```bash
export DB_HOST=localhost
export DB_PORT=3306
export DB_NAME=${MYSQL_DATABASE:-wealth_tracker}
export DB_USER=${MYSQL_USER:-root}
export DB_PASSWORD=${MYSQL_PASSWORD:-$MYSQL_ROOT_PASSWORD}
```

3. Run integration tests:

```bash
npm run test:integration
```

Tip: to run a single integration test file, pass Jest args after `--`.

```bash
npm run test:integration -- --runTestsByPath tests/integration/listing_sync_e2e.test.js
```

---
## Managing Configuration

---
### Metadata refresh / trailing P/E updates

- Source: trailing P/E (stored in `securities_metadata.trailing_pe`) is populated by running `scripts/populate_securities_metadata.js` which calls the Yahoo Finance APIs (via `yahoo-finance2`) and upserts metadata including `trailing_pe`.

- Default automated schedule: the repository ships a cron configuration at `config/metadata_cron.conf` which — by default — runs the daily and weekly metadata jobs. Example entries:

  - `0 2 * * * cd /path/to/wealth-tracker && node scripts/populate_securities_metadata.js --all >> logs/metadata_daily.log 2>&1` (runs once daily)
  - `0 3 * * 0 cd /path/to/wealth-tracker && node scripts/populate_popular_securities.js --sp500 >> logs/metadata_sp500.log 2>&1` (weekly for S&P500 list)
  - `0 4 * * 0 cd /path/to/wealth-tracker && node scripts/populate_popular_securities.js --etfs >> logs/metadata_etfs.log 2>&1` (weekly for ETFs)
  - `0 1 1 * * cd /path/to/wealth-tracker && node scripts/populate_popular_securities.js --all --force >> logs/metadata_monthly.log 2>&1` (monthly full refresh)

- On-demand / manual refresh options:

Note on daemon vs host cron: the `scrapers` container runs as a long-lived daemon (continuous scraping) and does not require cron for normal operation. The `config/metadata_cron.conf` file is a host-side cron template intended for periodic metadata population or maintenance tasks (for example full DB refreshes). Use the daemon for continuous price collection and use the cron jobs for scheduled metadata refreshes or host-level maintenance.

  - API: POST /api/metadata/prefetch (prefetch metadata for a single ticker and update DB immediately)
  - CLI:
    - `node scripts/populate_securities_metadata.js --ticker TICKER` (single ticker)
    - `node scripts/populate_securities_metadata.js --all` (all positions)
    - `node scripts/populate_securities_metadata.js --all-tickers` (repopulate every ticker in `securities_metadata`)

- Notes & best practices:
  - Some instruments (e.g., futures, certain ETFs, or crypto pairs) may not expose a `trailingPE` value — those will be stored as `NULL` until Yahoo provides a value.
  - Increasing the metadata refresh frequency will give more up-to-date trailing P/E values but may increase rate-limiting risk when hitting Yahoo APIs. Use on-demand prefetch for a small set of tickers if you need near-real-time refreshes.
  - To change schedules, edit `config/metadata_cron.conf` and re-install the cron jobs (see `docs/CRON_REINSTALL.md` for details).

### 1. Environment Variables (`.env`)
The `.env` file in the project root contains secrets and environment settings (e.g., database passwords).
- **Update**: Edit `.env` in the project root.
- **Apply**: Run `docker compose up -d` to recreate containers with new values.

### 2. Scraper Configuration (`config.json`)
Defines the securities to track and their data sources.
- **Location**: Mapped from your host data directory (e.g., `~/wealth_tracker_data/config.json`) to `/usr/src/app/data/config.json` inside the container.
- **Update**: Edit the file on your host machine.
- **Apply**: The scraper daemon automatically reloads this file when it changes. No restart needed.

### 3. Dashboard Assets (Database Driven)
The dashboard now reads asset data (accounts, positions, real estate, vehicles) from the **MySQL database**. 

- **Primary Source**: MySQL database (service `mysql`).
- **Management**: 
    - **Add/Edit/Delete**: Use the dashboard web interface to manage accounts and positions in real-time.
    - **API**: Use the dashboard API endpoints (`/api/accounts`, `/api/positions`, etc.) for programmatic access.
      - New: `/api/account-types` exposes the seeded account type enumerations. Use this endpoint to populate dropdowns and manage custom types.


### 4. Dashboard HTTPS Configuration
The dashboard supports HTTPS. It looks for `server.key` and `server.crt` in `dashboard/certs/`. If found, it starts an HTTPS server; otherwise, it falls back to HTTP.

**Development (Self-Signed):**
Generate a self-signed certificate using OpenSSL:
```bash
mkdir -p dashboard/certs
openssl req -nodes -new -x509 -keyout dashboard/certs/server.key -out dashboard/certs/server.crt -days 365
```
When prompted, you can enter `US` for Country Name and any value for Organization Name.

**Production:**
Obtain a certificate from a trusted Certificate Authority (CA) like Let's Encrypt. Place the private key as `dashboard/certs/server.key` and the certificate chain as `dashboard/certs/server.crt`.

**Apply:**
Rebuild the dashboard container to copy the new certificates:
```bash
docker compose up -d --build dashboard
```

---
## Scraper Daemon (behavior)
- The scrapers container runs `node /usr/src/app/scrapers/scrape_daemon.js` as PID 1 (via `entrypoint_unified.sh`).
- The scraper maintains a single Puppeteer browser instance and runs scrape cycles in an internal loop (no cron required).
- Scraped records are published to Kafka using the configured brokers and topic.
- Logs are written to the mounted logs directory (host: `/Users/gene/wealth_tracker_logs` mapped to container `/usr/src/app/logs`) and also written to stdout so `docker logs` shows them.
---
## Scraper Daemon: Operational Notes

The scrapers run as a long-lived daemon inside the `scrapers` container. Key operational notes:

- The container runs `node /usr/src/app/scrapers/scrape_daemon.js` as PID 1 (via `entrypoint_unified.sh`), so Docker signals (SIGTERM/SIGINT) are delivered directly to the Node process.
- To stop the scraper gracefully run:

```bash
docker compose stop scrapers
```

This sends SIGTERM to the Node process; the daemon attempts to close the Puppeteer browser and flush shutdown messages to logs/stdout before exiting.

  - You can view logs with:

```bash
docker compose logs --tail 200 scrapers
```

### Heartbeat

The daemon emits a heartbeat message periodically so external monitors can detect liveness. By default the interval is 5 minutes. To change it, set the `HEARTBEAT_INTERVAL_MINUTES` environment variable for the `scrapers` service in `docker-compose.yml`.

Example (5-minute heartbeat):

```yaml
services:
	scrapers:
		environment:
			HEARTBEAT_INTERVAL_MINUTES: 5
```

Heartbeat messages appear in both the scraper log files under `/usr/src/app/logs` and in `docker logs` output as lines starting with `HEARTBEAT: daemon alive`.
### Graceful shutdown
- `docker compose stop scrapers` sends SIGTERM to the Node PID 1; the daemon traps SIGTERM/SIGINT, closes the Puppeteer browser, flushes shutdown messages to stdout and file logs, and exits.
- You should see shutdown messages in `docker logs` similar to:
```
[2025-11-17T23:18:47.802Z] Received SIGTERM, shutting down...
[2025-11-17T23:18:47.812Z] Browser closed.
```
If you do not see them, please ensure you are checking `docker compose logs --tail 200 scrapers` immediately after stopping.
### Heartbeat (liveness)
- The daemon emits a heartbeat to both the timestamped log file and stdout periodically so external monitors can detect liveness.
- Default heartbeat interval: 5 minutes.
- To change the interval, set the environment variable `HEARTBEAT_INTERVAL_MINUTES` for the `scrapers` service in `docker-compose.yml`.
Example:
```yaml
services:
	scrapers:
	environment:
	HEARTBEAT_INTERVAL_MINUTES: 5
```
Heartbeat messages look like:
```
[2025-11-17T23:18:45.194Z] HEARTBEAT: daemon alive
```

### Health endpoint

- The daemon exposes a small HTTP health endpoint on `HEALTH_PORT` (default `3000`). If you expose the port in `docker-compose.yml`, you can query it from the host.
- **Note**: The root path `/` returns 404 Not Found. You must use one of the specific paths below:
  - `/health`: Returns JSON status including uptime, last cycle status, and basic metrics.
  - `/metrics`: Returns Prometheus-formatted metrics (if `METRICS_ENABLED=true`).

```bash
# Check health status
curl http://localhost:3002/health

# Check metrics (if enabled)
curl http://localhost:3002/metrics
```

- Example `docker-compose.yml` snippet to expose the port and set the env var:

```yaml
services:
	scrapers:
		ports:
			- "5901:5901"
			- "3002:3002"
		environment:
			HEALTH_PORT: "3002"
```
---
## Important Environment Variables
- `KAFKA_BROKERS`: Kafka bootstrap servers (example: `kafka:9092`) — configured in `docker-compose.yml` for local compose.
- `KAFKA_TOPIC`: Topic to publish price data to (default set in code/config). Example: `price_data`.
- `HEARTBEAT_INTERVAL_MINUTES`: Heartbeat interval in minutes (default `5`).
Update these in the `docker-compose.yml` service block for `scrapers` as needed. Example service env block:
```yaml
services:
	scrapers:
	environment:
	KAFKA_BROKERS: "kafka:9092"
	KAFKA_TOPIC: "price_data"
	HEARTBEAT_INTERVAL_MINUTES: "5"
```
---
## Logs & Data
- Logs are saved in the container under `/usr/src/app/logs`. In this workspace they are typically mounted to your host at `/Users/gene/wealth_tracker_logs`.
- Each run creates timestamped log files like `scrape_daemon.20251117_231700.log` and sidecar JSON/HTML files for scraped content.
- Use `tail -f` on the most recent log file or `docker logs` for real-time output.
If you need to inspect the latest log file inside the running container you can run:
```bash
docker compose exec -it scrapers sh -c '\
  LATEST=$(ls -1t /usr/src/app/logs/scrape_daemon*.log | head -n1) && \
  echo "Latest: $LATEST" && tail -n 200 "$LATEST"'
```
---
## Database Schema
The system persists the latest price updates to a MySQL database in the `latest_prices` table. This allows the dashboard to load the most recent data immediately upon startup.

### Table: `latest_prices`
| Column | Type | Description |
| :--- | :--- | :--- |
| `ticker` | `VARCHAR(50)` | Primary Key. The stock symbol (e.g., "AAPL", "US500"). |
| `price` | `DECIMAL(18, 4)` | The current price. |
| `previous_close_price` | `DECIMAL(18, 4)` | The previous day's closing price. |
| `source` | `VARCHAR(50)` | The data source (e.g., "investing (regular)"). |
| `quote_time` | `DATETIME` | The timestamp of the quote from the source. |
| `capture_time` | `DATETIME` | The timestamp when the price was captured by the scraper. |
| `updated_at` | `TIMESTAMP` | Automatically updated timestamp of the record modification. |

**Note:** The dashboard calculates Change and Change % dynamically:
- **Change** = Price - Previous Close
- **Change %** = (Price - Previous Close) / Previous Close × 100

---
## Development notes
- The scraper code uses `puppeteer-extra` with stealth plugin to drive Chrome. The container image provides a Chrome installation and Xvfb/VNC for a display.
- The scrapers publish messages via `publish_to_kafka.js` using the `KAFKA_BROKERS` environment variable.
- To run locally (without Docker) you must have a compatible Chrome and Node.js environment; most development and testing occurs inside the container for environment parity.
If you run the scrapers outside Docker, set `KAFKA_BROKERS` to a reachable broker list (for example `localhost:9094` when running Kafka locally). Inside Docker Compose use the service DNS name (for example `kafka:9092`).

---
## Scrape Groups

The scraper daemon supports configurable scrape groups in `config.json`. Each group has an `interval` (minutes) and `enabled` flag:

```json
{
  "scrape_groups": {
    "investing_watchlists": { "interval": 1, "enabled": true },
    "yahoo_batch": { "interval": 30, "enabled": true },
    "stock_positions": { "interval": 30, "enabled": true },
    "bond_positions": { "interval": 30, "enabled": true },
    "bonds": { "interval": 240, "enabled": true },
    "us_listings": { "interval": 1440, "enabled": true }
  }
}
```

### Available Scrape Groups

| Group | Description |
| :--- | :--- |
| `investing_watchlists` | Scrapes Investing.com watchlist pages |
| `yahoo_batch` | Batch fetches prices from Yahoo Finance API |
| `stock_positions` | **Queries MySQL** for positions with type 'stock' or 'etf', then scrapes prices using round-robin source selection |
| `bond_positions` | **Queries MySQL** for positions with type 'bond', then scrapes prices (currently uses Webull bond quotes) |
| `bonds` | Scrapes bond prices from configured sources |
| `us_listings` | Updates NYSE/NASDAQ exchange listings for ticker lookup |

The `stock_positions` and `bond_positions` groups dynamically query the database for your actual holdings, ensuring prices are fetched for securities you own without manual configuration.

---
## US Treasury Securities Listings Scrape Group

### Overview
This group downloads the latest US Treasury Securities Auctions Data (bills, notes, bonds) from fiscaldata.treasury.gov. The data includes CUSIP, Security Type, Security Term, Auction Date, Issue Date, Maturity Date, and more.

- **Script:** `scripts/update_treasury_listings.js`
- **Output file:** `config/us-treasury-auctions.csv`
- **Scrape group config:**
  ```json
  "us_treasury_listings": { "interval": 1440, "enabled": true }
  ```
- **Integration:** The scraper daemon runs this group on schedule, similar to other scrape groups.

### How It Works
- Uses Puppeteer to automate browser download (required because the CSV is generated client-side via blob URL).
- The script checks if the new file is more than 5% smaller than the previous file. If so, it aborts the update and logs a warning to prevent accidental data loss.
- On successful download, the previous file is backed up with a timestamp.

### Safety Check Example
If the new CSV file is significantly smaller than the previous one (by more than 5%), the update is aborted and a warning is logged:
```
WARNING: New file is 12.3% smaller than existing file
  Old size: 123456 bytes, New size: 108234 bytes
Aborting update to prevent data loss. Delete the old file manually if this is intentional.
```

### Manual Run
To manually update the Treasury listings:
```bash
node scripts/update_treasury_listings.js
```

### Troubleshooting
- If the script aborts due to file size reduction, review the downloaded file and delete the old file manually if the update is valid.
- The script requires Puppeteer and Chrome; ensure dependencies are installed if running outside Docker.

---
## Data Source Capabilities

The system supports multiple data sources with varying capabilities for price data extraction:

| Source | Real-time | Pre-market | After-hours | Previous Close | Stock Prices | Bond Prices |
|--------|-----------|------------|-------------|----------------|---------------|-------------|
| **Yahoo Finance** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **YCharts** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| **Google Finance** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Robinhood** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Investing.com** | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Webull** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |

**Notes:**
- **Previous Close**: Some sources (like YCharts) do not expose previous close price data in their HTML/API, so the `previous_close_price` field remains null for these sources. The dashboard calculates change and change % using available data.
- **Real-time**: Indicates if the source provides live price updates during market hours
- **Pre-market/After-hours**: Extended trading hours support
- **Stock/Bond Prices**: Asset type support

---
## Dashboard Features



#### Settings Modal

The Settings modal provides the following configuration options:

**Dashboard Preferences:**
- **Auto refresh account and positions**: Toggle automatic data refreshing (default: enabled)
- **Refresh interval**: Set how often data refreshes (30 seconds, 1 minute, 5 minutes, 10 minutes)
- **Theme**: Choose between Dark and Light themes (default: Dark)

**System:**
- **Export Data**: Download all account and position data as a JSON file
- **Import Data**: Upload and restore data from an exported JSON file (replaces all existing data)
- **Clear Cache**: Clear browser cache and reload the dashboard

#### Settings Storage

All settings are stored locally in your browser's localStorage and persist between sessions. Settings are specific to each browser/device and are not synced across different browsers or devices.

#### Logs Access

The "Logs" option in the gear dropdown opens a large 98% window size modal providing access to system logs with enhanced functionality:
- File browser showing all log files with timestamps and sizes
- Click any log file to view its contents
- Resizable panes for file list and log viewer
- Real-time log updates
- **Modal Features**: Large screen coverage, Escape key to close, close button, and click-outside-to-close

#### Settings Persistence

Settings are automatically saved when you click "Save Settings" and applied immediately. The dashboard remembers your preferences including:
- Auto-refresh preferences and intervals
- Theme selection (Dark/Light)
- Any custom configurations you set

#### Data Import/Export

The dashboard provides full data portability through import and export functionality:

**Export Data:**
- Downloads all accounts, positions, and fixed assets as a JSON file
- Includes metadata like export date and version
- File format: `export-YYYY-MM-DD.json`

**Import Data:**
- Reads exported JSON files and replaces all existing data
- Validates file format before importing
- Uses database transactions for data integrity
- Automatically refreshes the dashboard after successful import
- **Warning**: Import completely replaces existing data - use with caution

This allows you to backup your portfolio data, migrate between environments, or restore from backups.

The "Clear Cache" option resets all settings to defaults and clears any cached data, which can be useful for troubleshooting.

**Note:**
- If you updated configuration files (e.g., `.env`, `config.json`), most changes are picked up automatically, but some may require a container restart.
- If you updated the database schema, run any required migration scripts before restarting services.
- For Docker Desktop, you can also use the GUI to rebuild and restart containers.

---

## Database Schema

The project uses a MySQL database to store asset and portfolio information.

### Tables

#### `accounts`
Stores information about bank and investment accounts.
- `id`: Primary Key
- `name`: Account name (e.g., "Chase Checking")
- `type`: Account type (e.g., "checking", "roth ira")
- `category`: 'bank' or 'investment'
- `display_order`: Integer for sorting in the UI
- `currency`: Default 'USD'

#### `positions`
Stores individual holdings within an account.
- `id`: Primary Key
- `account_id`: Foreign Key to `accounts`
- `symbol`: Ticker symbol (e.g., "AAPL", "CASH"). Now supports up to 50 characters for options and long tickers.
- `quantity`: Number of shares or amount
- `type`: 'stock', 'etf', 'bond', 'cash', 'crypto', 'other'
- `exchange`: Stock exchange (optional)
- `currency`: Trading currency
- `maturity_date`: For bonds
- `coupon`: For bonds

#### `fixed_assets`
Stores non-financial assets like real estate and vehicles.
- `id`: Primary Key
- `name`: Description of the asset
- `type`: 'real_estate', 'vehicle', 'other'
- `value`: Estimated value
- `currency`: Valuation currency
- `display_order`: Integer for sorting

#### `securities_metadata`
Stores rich metadata for securities (stocks, ETFs, etc.).
- `symbol`: Primary Key (e.g., "AAPL")
- `long_name`: Full company name
- `quote_type`: 'EQUITY', 'ETF', 'MUTUALFUND'
- `sector`: Industry sector
- `market_cap`: Market capitalization
- `dividend_yield`: Annual dividend yield
- `trailing_pe`: P/E Ratio
- `exchange`: Stock exchange (e.g., "Nms", "Nyi")

#### `securities_earnings`
Stores upcoming and past earnings events.
- `symbol`: Foreign Key to `securities_metadata`
- `earnings_date`: Date of earnings release
- `eps_estimate`: Consensus EPS estimate
- `revenue_estimate`: Consensus revenue estimate

#### `securities_dividends`
Stores dividend history and upcoming payments.
- `symbol`: Foreign Key to `securities_metadata`
- `ex_dividend_date`: Ex-dividend date
- `payment_date`: Payment date
- `dividend_amount`: Amount per share

---

## License

This project is licensed under the **GNU General Public License v3.0** - see the [LICENSE](LICENSE) file for details.

### What This Means

- ✅ You can freely use, modify, and distribute this software
- ✅ You can use it for commercial purposes
- ⚠️  Any modifications must also be open source under GPLv3
- ⚠️  You must include the original copyright and license notice

**Copyright © 2025 Gene Ko**

---

**Built with**: Node.js, Puppeteer, MySQL, Kafka, Docker, WebSockets

**Questions?** Open an issue or start a discussion on GitHub.
