#!/bin/bash
open /Users/gene/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 5

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
/Users/gene/venv/bin/python3 scrapeman.py -s investing  -t stocks > /Users/gene/logs/scrapeman_investing_stocks.${TIMESTAMP}.log 2>&1