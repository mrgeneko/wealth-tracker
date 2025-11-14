#!/usr/bin/env bash

export KAFKA_BOOTSTRAP_SERVERS='localhost:9092'
export KAFKA_TOPIC='price_data'
export KAFKA_CONSUMER_GROUP='price_data_consumer_group'
export KAFKA_ENABLE_AUTO_COMMIT='false'  # optional

#open ~/Library/Mobile\ Documents/com\~apple\~Numbers/Documents/Shared\ with\ Sharon/retirement\ plan.numbers
#open -a safari
#sleep 10

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
# Use package entrypoint
#$HOME/.pyenv/shims/python3 -m wealth_tracker.wealth_tracker -t stocks > ~/logs/wealth_tracker_stocks.${TIMESTAMP}.log 2>&1
#$HOME/.pyenv/shims/python3 -m wealth_tracker -t stocks > ~/logs/wealth_tracker_stocks.${TIMESTAMP}.log 2>&1
#$HOME/.pyenv/shims/python3 -m wealth_tracker.scripts.stocks > ~/logs/wealth_tracker_stocks.${TIMESTAMP}.log 2>&1
$HOME/.pyenv/shims/python3 wealth_tracker.py -t stocks > /usr/src/app/logs/wealth_tracker_stocks.${TIMESTAMP}.log 2>&1