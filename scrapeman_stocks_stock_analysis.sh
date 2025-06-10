#!/bin/bash
open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
open -a safari
sleep 5

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
~/venv/bin/python3 scrapeman.py -s stock_analysis  > ~/logs/scrapeman_stock_analysis_stocks.${TIMESTAMP}.log 2>&1