#!/bin/bash
open /Users/gene/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 5

python3 scrapeman.py --include-type stocks -l INFO 
#python3 scrapeman.py --include-type stocks -s 30 -l DEBUG > scrapeman_stocks.log 2>&1
