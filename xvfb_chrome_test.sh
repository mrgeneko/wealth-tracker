#!/bin/bash
set -e
rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1280x720x24 &
XVFB_PID=$!
sleep 5
/opt/google/chrome/chrome --version --display=:99
echo "Xvfb+Chrome test: success"
kill $XVFB_PID
