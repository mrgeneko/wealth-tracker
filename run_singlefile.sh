#!/bin/bash
xvfb-run node /usr/src/app/scrape_investing_watchlist.js "$1" "/usr/src/app/logs"