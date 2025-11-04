#!/bin/bash
open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
#open -a safari
sleep 10

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# Use package entrypoint
~/venv/bin/python3 -m wealth_tracker.wealth_tracker -t bonds > ~/logs/wealth_tracker_bonds.${TIMESTAMP}.log 2>&1

