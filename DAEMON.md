Daemon mode (scrapers)

The scrapers run as a long-lived daemon inside the `scrapers` container. Key operational notes:

- The container runs `node /usr/src/app/scrape_security_data.js` as PID 1 (via `entrypoint_unified.sh`), so Docker signals (SIGTERM/SIGINT) are delivered directly to the Node process.
- To stop the scraper gracefully run:

```bash
docker compose stop scrapers
```

This sends SIGTERM to the Node process; the daemon attempts to close the Puppeteer browser and flush shutdown messages to logs/stdout before exiting.

- You can view logs with:

```bash
docker logs --tail 200 wealth-tracker-scrapers
```

Heartbeat

The daemon emits a heartbeat message periodically so external monitors can detect liveness. By default the interval is 5 minutes. To change it, set the `HEARTBEAT_INTERVAL_MINUTES` environment variable for the `scrapers` service in `docker-compose.yml`.

Example (5-minute heartbeat):

```yaml
services:
  scrapers:
    environment:
      HEARTBEAT_INTERVAL_MINUTES: 5
```

Heartbeat messages appear in both the scraper log files under `/usr/src/app/logs` and in `docker logs` output as lines starting with `HEARTBEAT: daemon alive`.
