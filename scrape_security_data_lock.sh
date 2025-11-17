#!/bin/sh
# Robust single-instance lock wrapper for scrape_security_data.js


NODE_SCRIPT="/usr/src/app/scrape_security_data.js"

echo "[LOCK SCRIPT] $(date) - scrape_security_data_lock.sh starting."

# Check if the script is already running
if ps aux | grep -v grep | grep -q "$NODE_SCRIPT"; then
  echo "[LOCK] Another instance is already running. Exiting."
  exit 1
else
  echo "[LOCK] No other instance found. Starting script."
  node "$NODE_SCRIPT" "$@"
fi
