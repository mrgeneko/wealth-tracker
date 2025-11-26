# wealth-tracker
Lightweight scrapers and processors for personal portfolio tracking.

This repository contains Node.js scraper code that runs a persistent daemon to collect price and watchlist data using Puppeteer/Chrome, publishes messages to Kafka, and writes logs to a mounted host directory.
This README focuses on running the project in Docker, the long-running scraper daemon, and operational instructions (start/stop/logs/heartbeat). For additional operational notes see `DAEMON.md`.
---
## Quick Start (Docker Compose)
The easiest way to run the full stack locally (Kafka, Zookeeper, MySQL, scrapers, etc.) is with Docker Compose.
1. Build and start services:
```bash
# build the scrapers image and start the scrapers service only
docker compose build scrapers
docker compose up -d scrapers
# or start the entire stack
docker compose up -d
```
2. See running services:
```bash
docker compose ps
```
3. View logs for scrapers (follow):
```bash
docker logs -f wealth-tracker-scrapers
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

## Docker Desktop Setup
If you are using Docker Desktop, you can manage the application through the GUI:

1. **Start the Stack**: Open a terminal in the project directory and run:
   ```bash
   docker compose up -d
   ```
2. **View in Dashboard**: Open the Docker Desktop Dashboard. You will see a `wealth-tracker` application group.
3. **Inspect Containers**: Click on the `wealth-tracker` group to expand it. You will see services like `scrapers`, `dashboard`, `kafka`, `mysql`, etc.
4. **View Logs**: Click on any container (e.g., `wealth-tracker-scrapers`) to view its live logs. This is equivalent to running `docker logs -f <container_name>`.
5. **Access Terminal**: To run commands inside a container, click the "Terminal" or "Exec" tab in the container view. This is useful for debugging or checking files inside the container.
6. **Control Stack**: Use the Play/Stop/Restart buttons in the dashboard to manage the entire application or individual services.

---
## Managing Configuration

### 1. Environment Variables (`.env`)
The `.env` file in the project root contains secrets and environment settings (e.g., database passwords).
- **Update**: Edit `.env` in the project root.
- **Apply**: Run `docker compose up -d` to recreate containers with new values.

### 2. Scraper Configuration (`config.json`)
Defines the securities to track and their data sources.
- **Location**: Mapped from your host data directory (e.g., `~/wealth_tracker_data/config.json`) to `/usr/src/app/data/config.json` inside the container.
- **Update**: Edit the file on your host machine.
- **Apply**: The scraper daemon automatically reloads this file when it changes. No restart needed.

**Note on Data vs. Config Directories:**
- `/usr/src/app/data` (Runtime/Persistent): This is the "live" folder where the application looks for configuration. It is mounted from your host (e.g., `~/wealth_tracker_data`), so changes persist across container restarts.
- `/usr/src/app/config` (Template/Default): This directory inside the container holds the default configuration files copied during the build. If `config.json` is missing from the `data` folder at startup, the entrypoint script copies the default one from `config` to `data` to ensure the app can start.

### 3. Dashboard Assets (`assets_liabilities.json`)
Defines the accounts and hierarchy displayed on the dashboard.
- **Location**: Project root (`./assets_liabilities.json`).
- **Update**: Edit the file to modify accounts or manual balances.
- **Apply**: Restart the dashboard container.
  ```bash
  docker compose restart dashboard
  ```

---
## Scraper Daemon (behavior)
- The scrapers container runs `node /usr/src/app/scrape_security_data.js` as PID 1 (via `entrypoint_unified.sh`).
- The scraper maintains a single Puppeteer browser instance and runs scrape cycles in an internal loop (no cron required).
- Scraped records are published to Kafka using the configured brokers and topic.
- Logs are written to the mounted logs directory (host: `/Users/gene/wealth_tracker_logs` mapped to container `/usr/src/app/logs`) and also written to stdout so `docker logs` shows them.
Note: Operational details (heartbeat interval, graceful shutdown behavior, and troubleshooting steps) are documented in `DAEMON.md`.
### Graceful shutdown
- `docker compose stop scrapers` sends SIGTERM to the Node PID 1; the daemon traps SIGTERM/SIGINT, closes the Puppeteer browser, flushes shutdown messages to stdout and file logs, and exits.
- You should see shutdown messages in `docker logs` similar to:
```
[2025-11-17T23:18:47.802Z] Received SIGTERM, shutting down...
[2025-11-17T23:18:47.812Z] Browser closed.
```
If you do not see them, please ensure you are checking `docker logs --tail 200 wealth-tracker-scrapers` immediately after stopping.
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

- The daemon exposes a small HTTP health endpoint on `HEALTH_PORT` (default `3000`). If you expose the port in `docker-compose.yml`, you can query it from the host:

```bash
curl http://localhost:3000/health
```

- Example `docker-compose.yml` snippet to expose the port and set the env var:

```yaml
services:
	scrapers:
		ports:
			- "5901:5901"
			- "3000:3000"
		environment:
			HEALTH_PORT: "3000"
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
- Each run creates timestamped log files like `scrape_security_data.20251117_231700.log` and sidecar JSON/HTML files for scraped content.
- Use `tail -f` on the most recent log file or `docker logs` for real-time output.
If you need to inspect the latest log file inside the running container you can run:
```bash
docker exec -it wealth-tracker-scrapers sh -c '\
	LATEST=$(ls -1t /usr/src/app/logs/scrape_security_data*.log | head -n1) && \
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
| `change_decimal` | `DECIMAL(18, 4)` | The price change value. |
| `change_percent` | `VARCHAR(20)` | The percentage change (e.g., "+0.56%"). |
| `source` | `VARCHAR(50)` | The data source (e.g., "investing"). |
| `capture_time` | `DATETIME` | The timestamp when the price was captured. |
| `updated_at` | `TIMESTAMP` | Automatically updated timestamp of the record modification. |

---
## Development notes
- The scraper code uses `puppeteer-extra` with stealth plugin to drive Chrome. The container image provides a Chrome installation and Xvfb/VNC for a display.
- The scrapers publish messages via `publish_to_kafka.js` using the `KAFKA_BROKERS` environment variable.
- To run locally (without Docker) you must have a compatible Chrome and Node.js environment; most development and testing occurs inside the container for environment parity.
If you run the scrapers outside Docker, set `KAFKA_BROKERS` to a reachable broker list (for example `localhost:9092` when running Kafka locally). Inside Docker Compose use the service DNS name (for example `kafka:9092`).
---
## Troubleshooting
- Chrome launch/connect failures:
	- Common errors include `ECONNREFUSED 127.0.0.1:9222` or Chromium startup errors. The daemon attempts to connect to an existing debugging port and will launch Chrome if necessary. See the container logs for Chrome startup stderr.
	- Ensure the container has enough memory and the Chrome binary exists at `/opt/google/chrome/chrome` in the image.
If you repeatedly see connection failures, rebuild the `scrapers` image and verify the container logs; the daemon includes retries with backoff when Chrome is not immediately available.
- Kafka connectivity:
	- If you see DNS or connection errors for Kafka, ensure `KAFKA_BROKERS` points to the correct host:port and that the Kafka container is reachable from the scrapers container (compose network). For local compose this is usually `kafka:9092`.
- Stale lock files / concurrency:
	- This project uses a long-running daemon pattern instead of cron + lock scripts. The legacy `scrape_security_data_lock.sh` and cron-related files have been removed from the image. If you previously used cron, remove any external cron entries that run the scraper.
If you need to revert to scheduled runs instead of the daemon, let me know and I can add a controlled external runner or health-check wrapper.
---
## Files of interest
- `scrape_security_data.js` — main daemon that orchestrates scrapes and publishes to Kafka.
- `entrypoint_unified.sh` — container entrypoint that launches Node as PID 1.
- `Dockerfile.scrapers` — build for the scrapers image.
- `docker-compose.yml` — compose configuration for local development.
- `DAEMON.md` — additional daemon operational notes (included in repo).
---
## Contributing
PRs are welcome. When working on scrapers locally prefer building the scrapers image and running via Docker Compose for a consistent environment.
---
If you want more operational features (health endpoint, metrics, or structured JSON logs), tell me which one and I can add it as a follow-up change.
