#!/bin/bash
open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
#open -a safari
sleep 10

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
~/venv/bin/python3 scrapeman.py -t bonds > ~/logs/scrapeman_webull_bonds.${TIMESTAMP}.log 2>&1

