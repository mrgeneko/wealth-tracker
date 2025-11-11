#!/usr/bin/env bash

open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
#open -a safari
sleep 10

export KAFKA_BOOTSTRAP_SERVERS='localhost:9092'
export KAFKA_TOPIC='price_data'
export KAFKA_CONSUMER_GROUP='price_data_consumer_group'
export KAFKA_ENABLE_AUTO_COMMIT='false'  # optional

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# Use package entrypoint
~/venv/bin/python3 -m wealth_tracker.wealth_tracker -t bonds > ~/logs/wealth_tracker_bonds.${TIMESTAMP}.log 2>&1

