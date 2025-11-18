#!/bin/bash
# Log current cron processes for diagnostics
echo "[DEBUG] Current cron processes before check:" 
ps aux | grep cron | grep -v grep || echo "[DEBUG] No cron process found."
set -ex

# Log file for debug output
LOGFILE="/tmp/entrypoint_debug.log"
exec > >(tee -a "$LOGFILE") 2>&1

# Trap errors and print a message
trap 'echo "[ERROR] Command failed at line $LINENO: $BASH_COMMAND"' ERR

# Ensure dbus run directory exists
echo "[DEBUG] Ensuring /var/run/dbus exists..."
mkdir -p /var/run/dbus
if [ -f /run/dbus/pid ]; then
  echo "[DEBUG] Removing stale /run/dbus/pid file..."
  rm -f /run/dbus/pid
fi
if ! pgrep -x dbus-daemon > /dev/null; then
  echo "[DEBUG] Starting dbus-daemon..."
  dbus-daemon --system --fork
else
  echo "[DEBUG] dbus-daemon already running."
fi

# Start Xvfb if not already running
if [ ! -e /tmp/.X99-lock ]; then
  echo "[DEBUG] Starting Xvfb on :99..."
  Xvfb :99 -screen 0 1920x1080x24 &
else
  echo "[DEBUG] Xvfb already running."
fi

# Wait for Xvfb to be ready before starting clients (x11vnc / Chrome)
wait_for_xvfb() {
  local display=":99"
  local retries=20
  local sleep_sec=0.5
  echo "[DEBUG] Waiting for Xvfb to be ready on ${display} (retries=${retries}, interval=${sleep_sec}s)..."
  for i in $(seq 1 "$retries"); do
    if command -v xdpyinfo >/dev/null 2>&1; then
      xdpyinfo -display "${display}" >/dev/null 2>&1 && { echo "[DEBUG] Xvfb ready (xdpyinfo)"; return 0; }
    elif command -v xset >/dev/null 2>&1; then
      xset -display "${display}" q >/dev/null 2>&1 && { echo "[DEBUG] Xvfb ready (xset)"; return 0; }
    else
      if [ -S "/tmp/.X11-unix/X99" ]; then
        echo "[DEBUG] Xvfb socket exists (/tmp/.X11-unix/X99)";
        return 0
      fi
    fi
    sleep "$sleep_sec"
  done
  echo "[ERROR] Xvfb did not become ready after $((retries*sleep_sec)) seconds"
  return 1
}

if ! wait_for_xvfb; then
  echo "[ERROR] Xvfb readiness check failed — exiting to allow container restart."
  exit 1
fi

# Make the system DBus socket visible to Chrome and avoid a possibly-bad
# session address that Chrome may attempt to parse (causes non-fatal logs).
if [ -S /run/dbus/system_bus_socket ]; then
  export DBUS_SYSTEM_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"
  echo "[DEBUG] Exported DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket"
fi
# Also point session bus to the system socket to avoid malformed session addresses
# Some builds of Chrome probe both system and session addresses and may log parse
# errors if session contains an unexpected value; using the system socket as a
# fallback keeps behavior predictable in the container.
export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/dbus/system_bus_socket"
echo "[DEBUG] Set DBUS_SESSION_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket"

# Clean up Chrome update state and notification files to suppress update popup
echo "[DEBUG] Cleaning up Chrome profile lock and notification files..."
rm -f /tmp/chrome-profile2/SingletonLock /tmp/chrome-profile2/SingletonCookie /tmp/chrome-profile2/SingletonSocket
rm -f /tmp/chrome-profile2/Default/SingletonLock /tmp/chrome-profile2/Default/SingletonCookie /tmp/chrome-profile2/Default/SingletonSocket
rm -f /tmp/chrome-profile2/First\ Run /tmp/chrome-profile2/Default/First\ Run

# Start Chrome if not already running
if ! pgrep -f 'chrome.*--remote-debugging-port=9222' > /dev/null; then
  echo "[DEBUG] Starting Chrome..."
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
else
  echo "[DEBUG] Chrome already running."
fi

# Start VNC server if not already running
if ! pgrep -x x11vnc > /dev/null; then
  echo "[DEBUG] Starting x11vnc on port 5901..."
  x11vnc -forever -display :99 -shared -rfbport 5901 -nopw &
else
  echo "[DEBUG] x11vnc already running."
fi


# Disable cron for daemon mode; run Node as PID 1 so Docker signals reach it directly
echo "[DEBUG] Skipping cron startup (daemon mode)."
echo "[DEBUG] Executing scrape_security_data as PID 1 (exec)..."
# Exec will replace this shell with the Node process, ensuring Docker SIGTERM/SIGINT
# are delivered directly to Node and its handlers (graceful shutdown will run).
exec node /usr/src/app/scrape_security_data.js
