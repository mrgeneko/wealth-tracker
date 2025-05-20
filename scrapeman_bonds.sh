#!/bin/bash
open /Users/gene/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 5

python3 scrapeman.py --include-type bonds -s 30 -l INFO
#python3 scrapeman.py --include-type bonds -s 30 > scrapeman_bonds.log 2>&1
