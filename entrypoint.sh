#!/bin/bash
set -e

# Ensure dbus run directory exists
mkdir -p /var/run/dbus
# Start dbus if not already running
if ! pgrep -x dbus-daemon > /dev/null; then
  dbus-daemon --system --fork
fi

# Start Xvfb if not already running
if [ ! -e /tmp/.X99-lock ]; then
  Xvfb :99 -screen 0 1280x720x24 &
fi

# Clean up Chrome update state and notification files to suppress update popup
rm -f /tmp/chrome-profile2/SingletonLock /tmp/chrome-profile2/SingletonCookie /tmp/chrome-profile2/SingletonSocket
rm -f /tmp/chrome-profile2/Default/SingletonLock /tmp/chrome-profile2/Default/SingletonCookie /tmp/chrome-profile2/Default/SingletonSocket
rm -f /tmp/chrome-profile2/First\ Run /tmp/chrome-profile2/Default/First\ Run


# Start Chrome if not already running
# NOTE: Only one Chrome instance should run with --remote-debugging-port=9222.
# If running automation, prefer puppeteer.connect() to attach to this instance.
if ! pgrep -f 'chrome.*--remote-debugging-port=9222' > /dev/null; then
  /opt/google/chrome/chrome \
    --no-sandbox \
    --disable-gpu \
    --remote-debugging-port=9222 \
    --user-data-dir=/tmp/chrome-profile2 \
    --display=:99 \
    --disable-dev-shm-usage \
    --disable-software-rasterizer \
    --disable-setuid-sandbox \
    --no-first-run \
    --no-default-browser-check \
    --disable-features=AudioServiceOutOfProcess \
    --load-extension=/opt/singlefile-extension \
    --disable-extensions-except=/opt/singlefile-extension &
fi


# Start VNC server if not already running
if ! pgrep -x x11vnc > /dev/null; then
  x11vnc -forever -display :99 -shared -rfbport 5900 -nopw &
fi

# Wait forever to keep the container running
exec tail -f /dev/null
