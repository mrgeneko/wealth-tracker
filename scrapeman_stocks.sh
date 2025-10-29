#!/bin/bash
open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
#open -a safari
sleep 10

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# Use package entrypoint
~/venv/bin/python3 -m scrapeman.scrapeman -t stocks > ~/logs/scrapeman_stocks.${TIMESTAMP}.log 2>&1