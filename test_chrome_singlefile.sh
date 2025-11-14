#!/bin/bash
# test_chrome_singlefile.sh
# This script tests Google Chrome in headless mode with the SingleFile extension

URL="https://www.example.com"
OUTPUT_DIR="/usr/src/app/logs"
OUTPUT_FILE="test_singlefile.html"
EXTENSION_PATH="/opt/singlefile-extension"

# Ensure output directory exists
mkdir -p "$OUTPUT_DIR"

# Run Chrome headless with SingleFile extension to save the page
google-chrome \
  --headless \
  --disable-gpu \
  --no-sandbox \
  --load-extension="$EXTENSION_PATH" \
  --user-data-dir=/tmp/chrome-profile \
  --virtual-time-budget=10000 \
  --print-to-pdf="$OUTPUT_DIR/$OUTPUT_FILE" "$URL"

# Check if output file was created
if [ -f "$OUTPUT_DIR/$OUTPUT_FILE" ]; then
  echo "SingleFile test succeeded: $OUTPUT_DIR/$OUTPUT_FILE created."
else
  echo "SingleFile test failed: $OUTPUT_DIR/$OUTPUT_FILE not found."
  exit 1
fi
