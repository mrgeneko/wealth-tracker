#!/bin/bash

# Define the directory containing the files
log_dir="/Volumes/gene/investing_com_html"

# Find all matching files and sort them by modification time (newest last)
files=$(find "$log_dir" -type f -name "investing.202*.html" | xargs ls -t)

# Convert the list of files into an array
file_array=($files)

# Get the newest file
if [ ${#file_array[@]} -gt 0 ]; then
    newest_file="${file_array[0]}"
    echo "will process" "$newest_file"

    # Run the script with the newest file
    /Users/gene/venv/bin/python3 investing_com_pdf_parse.py --file_path "$newest_file" > output.txt
    #mv "${newest_file}" "${newest_file}.old"

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
    
    echo "Newest file: $newest_file has been processed and older files have been moved with .old suffix."
else
    echo "No matching files found in $log_dir"
fi
