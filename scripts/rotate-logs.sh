w#!/bin/sh
set -eu
# rotate-logs.sh <log_dir> [retention_days] [compression_level] [loop_seconds]
# Default: retention 7 days, compression level 1, loop every 300s

LOG_DIR=${1:-/usr/src/app/logs}
RETENTION_DAYS=${2:-7}
COMP_LEVEL=${3:-1}
LOOP_SECONDS=${4:-300}

LOCKDIR="$LOG_DIR/.rotate_lock"

compress_file() {
  src="$1"
  if [ ! -f "$src" ]; then
    return
  fi
  # skip if already compressed
  if [ "${src%.gz}" != "$src" ]; then
    return
  fi
  # gzip to same dir
  echo "[rotate-logs] Compressing $src"
  gzip -c -$COMP_LEVEL "$src" > "$src.gz" && rm -f "$src" || echo "[rotate-logs] Compression failed for $src" >&2
}

cleanup_old() {
  find "$LOG_DIR" -maxdepth 1 -type f \( -name '*.log' -o -name '*.gz' \) -mtime +$RETENTION_DAYS -print -exec rm -f {} \; || true
}

while true; do
  # create lockdir (atomic); if exists, skip this iteration
  if mkdir "$LOCKDIR" 2>/dev/null; then
    trap 'rm -rf "$LOCKDIR"' EXIT INT TERM
    # compress any .log files older than 60s (to avoid current active file)
    find "$LOG_DIR" -maxdepth 1 -type f -name '*.log' -mmin +1 -print | while read -r f; do
      compress_file "$f"
    done

    # remove old files beyond retention
    cleanup_old

    # release lock
    rm -rf "$LOCKDIR"
    trap - EXIT INT TERM
  else
    echo "[rotate-logs] lock present, skipping"
  fi
  sleep "$LOOP_SECONDS"
done
