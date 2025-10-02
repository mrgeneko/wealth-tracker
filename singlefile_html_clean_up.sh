#!/usr/bin/env bash

# ------------------------------------------------------------------
#  Delete old portfoliowatchlist*.html files
#
#  - Only deletes files that are older than 12 hours.
#  - Works recursively inside the target directory.
# ------------------------------------------------------------------

# --- Configuration -------------------------------------------------
TARGET_DIR="${HOME}/singlefile_html"   # <-- change this if you want a different folder
PATTERN="portfoliowatchlist*.html"
AGE_MINUTES=720                 # 12 hours = 12*60 minutes

# --- Safety --------------------------------------------------------
# If you want a dry‑run first, set DRY_RUN=true
DRY_RUN=false

# ------------------------------------------------------------------
#  Main logic --------------------------------------------------------
# ------------------------------------------------------------------

# Use find to locate the files, then delete them
find "$TARGET_DIR" \
     -type f \
     -name "$PATTERN" \
     -mmin +"$AGE_MINUTES" \
  -print0 | while IFS= read -r -d '' file; do
    if [ "$DRY_RUN" = true ]; then
      echo "Would delete: $file"
    else
      rm -- "$file" && echo "Deleted:  $file"
    fi
done

echo "Done."
