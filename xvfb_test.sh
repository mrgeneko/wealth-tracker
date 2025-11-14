#!/bin/bash
set -e
Xvfb :99 -screen 0 1280x720x24 &
XVFB_PID=$!
sleep 5
kill $XVFB_PID
echo "Xvfb test: success"
