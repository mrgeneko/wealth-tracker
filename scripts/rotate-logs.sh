#!/bin/sh
set -eu
# rotate-logs.sh <log_dir> [retention_days] [compression_level] [loop_seconds]
# Default: retention 7 days, compression level 1, loop every 300s

LOG_DIR=${1:-/usr/src/app/logs}
RETENTION_DAYS=${2:-7}
COMP_LEVEL=${3:-1}
LOOP_SECONDS=${4:-300}

LOCKDIR="$LOG_DIR/.rotate_lock"

cleanup_old() {
  # Clean up old archives
  find "$LOG_DIR" -maxdepth 1 -type f -name 'logs_archive_*.tar.gz' -mtime +$RETENTION_DAYS -exec rm -f {} \; || true
  # Also clean up any stray uncompressed files that might have been missed/leftover if they are very old
  find "$LOG_DIR" -maxdepth 1 -type f \( -name '*.log' -o -name '*.json' -o -name '*.html' \) -mtime +$RETENTION_DAYS -exec rm -f {} \; || true
}

while true; do
  # create lockdir (atomic); if exists, skip this iteration
  if mkdir "$LOCKDIR" 2>/dev/null; then
    trap 'rm -rf "$LOCKDIR"' EXIT INT TERM
    
    # Create a timestamp for the archive
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    ARCHIVE_NAME="logs_archive_${TIMESTAMP}.tar.gz"
    
    # We run inside a subshell to change directory safely
    (
      cd "$LOG_DIR"
      # Find files older than 60 minutes to avoid active writes
      # Output to a temporary file list
      find . -maxdepth 1 -type f \( -name '*.log' -o -name '*.json' -o -name '*.html' \) -mmin +60 > .files_to_compress
      
      if [ -s .files_to_compress ]; then
        echo "[rotate-logs] Compressing $(wc -l < .files_to_compress) files into $ARCHIVE_NAME"
        
        # Create tarball using the file list
        # We pipe tar to gzip to respect COMP_LEVEL
        if tar -cf - -T .files_to_compress | gzip -$COMP_LEVEL > "$ARCHIVE_NAME"; then
           # If successful, remove the original files
           xargs rm < .files_to_compress
        else
           echo "[rotate-logs] Compression failed" >&2
           # Try to remove the potentially corrupted archive
           rm -f "$ARCHIVE_NAME"
        fi
      fi
      # Remove the temp file list
      rm -f .files_to_compress
    )

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
