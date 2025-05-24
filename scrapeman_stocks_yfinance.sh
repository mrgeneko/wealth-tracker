#!/bin/bash
open /Users/gene/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 5

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
/Users/gene/venv/bin/python3 scrapeman.py -s weyfinance > /Users/gene/logs/scrapeman_stocks_yfinance.${TIMESTAMP}.log 2>&1
