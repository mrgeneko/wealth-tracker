#!/bin/sh
set -eu
# rotate-logs.sh <log_dir> [retention_days] [compression_level] [loop_seconds] [archive_age_min]
# Default: retention 7 days, compression level 1, loop every 300s, archive files > 60m old

LOG_DIR=${1:-/usr/src/app/logs}
RETENTION_DAYS=${2:-7}
COMP_LEVEL=${3:-1}
LOOP_SECONDS=${4:-300}
ARCHIVE_AGE_MIN=${5:-720}

LOCKDIR="$LOG_DIR/.rotate_lock"

cleanup_old() {
  # Remove old archives
  find "$LOG_DIR" -maxdepth 1 -type f -name '*.tar.gz' -mtime +$RETENTION_DAYS -exec rm -f {} \; || true
  # Also remove old individual .gz files if any remain from previous logic
  find "$LOG_DIR" -maxdepth 1 -type f -name '*.gz' -not -name '*.tar.gz' -mtime +$RETENTION_DAYS -exec rm -f {} \; || true
}

while true; do
  # create lockdir (atomic); if exists, skip this iteration
  if mkdir "$LOCKDIR" 2>/dev/null; then
    trap 'rm -rf "$LOCKDIR"' EXIT INT TERM
    
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    ARCHIVE_NAME="logs_archive_${TIMESTAMP}.tar.gz"
    LIST_FILE="/tmp/files_to_archive_${TIMESTAMP}.txt"
    
    # Find files to archive (relative paths)
    # We look for .log, .json, .html, .png older than ARCHIVE_AGE_MIN minutes
    if cd "$LOG_DIR"; then
        find . -maxdepth 1 -type f \( -name '*.log' -o -name '*.json' -o -name '*.html' -o -name '*.png' \) -mmin +$ARCHIVE_AGE_MIN | sed 's|^\./||' > "$LIST_FILE"
        
        if [ -s "$LIST_FILE" ]; then
            echo "[rotate-logs] Archiving $(wc -l < "$LIST_FILE") files into $ARCHIVE_NAME"
            
            # Create tar.gz archive
            # Use -T to read file list
            if tar -czf "$ARCHIVE_NAME" -T "$LIST_FILE"; then
                echo "[rotate-logs] Archive created successfully. Deleting original files."
                xargs rm < "$LIST_FILE"
            else
                echo "[rotate-logs] Failed to create archive $ARCHIVE_NAME" >&2
            fi
        else
            echo "[rotate-logs] No files older than $ARCHIVE_AGE_MIN minutes to archive."
        fi
    else
        echo "[rotate-logs] Failed to cd to $LOG_DIR" >&2
    fi
    
    rm -f "$LIST_FILE"

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
