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

- **Multi-Source Data Collection**: Scrapes from multiple financial data providers
- **Multi-Source Data Collection**: Scrapes from multiple financial data providers
- **Streaming Updates**: WebSocket-based dashboard for live price updates
- **Comprehensive Coverage**: Stocks, ETFs, and US Treasury securities
- **Docker-First**: Fully containerized with Docker Compose

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
The dashboard reads asset data (accounts, positions, real estate, vehicles) from the **MySQL database**. 

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
# wealth-tracker

Lightweight, containerized scrapers and processors for personal portfolio tracking.

Overview
- Scrapes prices and metadata, stores results in MySQL, publishes updates to Kafka, and serves a realtime dashboard.

Quick start
1. Copy example env and start services:
```bash
cp .env.example .env
docker compose up -d
```
2. Follow scrapers logs:
```bash
docker compose logs -f scrapers
```

Essential config
- `.env`: database and credentials (copy from `.env.example`).
- `config/config.json`: scraper/dashboard settings (mounted into containers from `./config`).
- Logs: the project mounts a host `./logs` directory to `/usr/src/app/logs`; create it if needed: `mkdir -p ./logs`.

Runtime notes
- The `scrapers` service runs as a long-lived daemon (no cron required for continuous scraping). Use `config/metadata_cron.conf` only for host-level, scheduled metadata maintenance jobs.
- Health: the scrapers health endpoint defaults to `3002` (example):
```bash
curl http://localhost:3002/health
```

Where to find more
- Operational details, troubleshooting, and archived phase docs live under `docs/`.

License
- GNU GPLv3 — see `LICENSE`.

Questions or changes: open an issue or a PR.
