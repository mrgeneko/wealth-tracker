#!/bin/bash
# Run the Investing.com monitor script in the background with proper redirection

docker compose exec -T scrapers nohup node scrape_security_data.js > nohup.out 2>&1 < /dev/null &
