#!/bin/bash
open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 10

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
~/venv/bin/python3 scrapeman.py -r T -t stocks -s 2 > ~/logs/scrapeman_round_robin_stocks.${TIMESTAMP}.log 2>&1