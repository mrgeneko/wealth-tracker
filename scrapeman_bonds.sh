#!/bin/bash
open /Users/gene/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
sleep 5

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
python3 scrapeman.py -t bonds > /Users/gene/logs/scrapeman_bonds.${TIMESTAMP}.log 2>&1

#/Library/Frameworks/Python.framework/Versions/3.13/bin/python3/python3 scrapeman.py -t bonds > /Users/gene/logs/scrapeman_bonds.${TIMESTAMP}.log 2>&1

