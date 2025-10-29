#!/usr/bin/env bash
set -euo pipefail


# ---- kafka env (project-local) ----
# Option A: export directly
#export KAFKA_BOOTSTRAP_SERVERS='kafka1:9092,kafka2:9092'
#export KAFKA_TOPIC='price_data'
export KAFKA_BOOTSTRAP_SERVERS='localhost:9092'
export KAFKA_TOPIC='price_data'
export KAFKA_CONSUMER_GROUP='price_data_consumer_group'
export KAFKA_ENABLE_AUTO_COMMIT='false'  # optional

# Option B (preferred if you don't want to store in repo): source a .env file
# Create a .env in the repo (add it to .gitignore), then uncomment the line below
# [ -f "$(pwd)/.env" ] && source "$(pwd)/.env"
# -----------------------------------


# instal Google Chrome browser
# install 'SingleFile chrome extension'
# set File name template to: portfoliowatchlist{year-locale}{month-locale}{day-locale}{hours-locale}{minutes-locale}{seconds-locale}.{filename-extension}
# deselect Images -> save deferred images
# set destination to file system
# set HTML content -> compress HTML content to off. Setting to true removes </tr> tags which makes parsing difficult
# set Autosave -> 'auto=save after page load' to on
# set auto-save waiting delay after page load(s) to 2
# set auto-save periodically to on with period(s) to 120


mkdir -p "$HOME/logs"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
log="$HOME/logs/parse_investing_com_html.${TIMESTAMP}.log"
date >> "$log"
# Define the directory containing the files
#html_dir="${HOME}/Downloads"
html_dir="${HOME}/singlefile_html"


# Find all matching files and sort them by modification time (newest last), robust to spaces/newlines
file_array=()
while IFS= read -r file; do
    file_array+=("$file")
done < <(find "$html_dir" -type f -name "portfoliowatchlist202*.html" -print0 | xargs -0 stat -f "%m %N" | sort -rn | cut -d' ' -f2-)

# Get the newest file
if [ ${#file_array[@]} -gt 0 ]; then
    newest_file="${file_array[0]}"
    echo "will process" "$newest_file" >> "$log"

    OUTPUT_FILE="$HOME/logs/price_data.${TIMESTAMP}.log"

    # Run the script with the newest file
    # Use the pyenv python that has project dependencies installed
    PYTHON_EXEC="/Users/gene/.pyenv/versions/3.13.3/bin/python"
    echo "Using python: $($PYTHON_EXEC -c 'import sys; print(sys.executable)')" >> "$log"
    # Quick health check for Kafka (the parser will try to publish messages). If Kafka is unavailable
    # we still allow parsing to continue but we warn early (exit code 2 indicates unreachable broker).
    "$PYTHON_EXEC" - <<'PY' || echo "Kafka health check failed (parser will continue but publishes may fail)" >> "$log"
import os, socket, sys
bs = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
hostport = bs.split(',')[0]
if ':' in hostport:
    host, port = hostport.split(':', 1)
else:
    host, port = hostport, '9092'
try:
    s = socket.socket()
    s.settimeout(2)
    s.connect((host, int(port)))
    s.close()
    print('KAFKA_OK')
except Exception as e:
    print('KAFKA_UNREACHABLE', e)
    sys.exit(2)
PY

    # Run the package entrypoint
    "$PYTHON_EXEC" -m scrapeman.parse_investing_com_html --file_path "$newest_file" --output_file_path "$OUTPUT_FILE" >> "$log" 2>&1
    mv -- "$newest_file" "$newest_file.old"

    # Move all other files except the newest one to the same filename with .old appended
    for ((i=1; i<${#file_array[@]}; i++)); do
        old_file="${file_array[i]}"
        new_filename="${old_file}.old"
        # Check if a file with the .old extension already exists and increment the suffix
        while [ -f "$new_filename" ]; do
            new_filename="${new_filename%.old}_1.old"
        done
        mv -- "$old_file" "$new_filename"
    done

    echo "Newest file: $newest_file has been processed and older files have been moved with .old suffix." >> "$log"
else
    echo "No matching files found in $html_dir" >> "$log"
fi
