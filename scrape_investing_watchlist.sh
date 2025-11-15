#!/bin/bash
# Run the Investing.com monitor script in the background with proper redirection

docker compose exec -T chrome-singlefile nohup node scrape_investing_watchlist.js > nohup.out 2>&1 < /dev/null &
