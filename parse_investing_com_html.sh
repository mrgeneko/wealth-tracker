#!/bin/bash

# instal Google Chrome browser
# install 'SingleFile chrome extension'
# set File name template to: portfoliowatchlist{year-locale}{month-locale}{day-locale}{hours-locale}{minutes-locale}{seconds-locale}.{filename-extension}
# deselect Images -> save deferred images
# set destination to file system
# set HTML content -> compress HTML content to off. Setting to true removes </tr> tags which makes parsing difficult
# set Autosave -> 'auto=save after page load' to on
# set auto-save waiting delay after page load(s) to 2
# set auto-save periodically to on with period(s) to 120

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
log="$HOME/logs/parse_investing_com_html.${TIMESTAMP}.log"
date >> "$log"
# Define the directory containing the files
html_dir="$HOME/Downloads"

# Find all matching files and sort them by modification time (newest last)
files=$(find "$html_dir" -type f -name "portfoliowatchlist202*.html" | xargs ls -t)

# Convert the list of files into an array
file_array=($files)

# Get the newest file
if [ ${#file_array[@]} -gt 0 ]; then
    newest_file="${file_array[0]}"
    echo "will process" "$newest_file" >> "$log"

    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    OUTPUT_FILE="$HOME/logs/price_data.${TIMESTAMP}.log"

    # Run the script with the newest file
    ~/venv/bin/python3 parse_investing_com_html.py --file_path "$newest_file" --output_file_path "$OUTPUT_FILE" >> "$log"
    mv "${newest_file}" "${newest_file}.old"

    # Move all other files except the newest one to the same filename with .old appended
    for ((i=1; i<${#file_array[@]}; i++)); do
        old_file="${file_array[i]}"
        new_filename="${old_file}.old"
        
        # Check if a file with the .old extension already exists and increment the suffix
        while [ -f "$new_filename" ]; do
            new_filename="${new_filename%.old}_1.old"
        done
        
        mv "${old_file}" "${new_filename}"
    done
    
    echo "Newest file: $newest_file has been processed and older files have been moved with .old suffix." >> "$log"
else
    echo "No matching files found in $html_dir" >> "$log"
fi
