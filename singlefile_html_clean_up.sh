#!/bin/bash

# Define target directory (adjust permissions if needed)
target_dir="$HOME/singlefile_html"

# Find and delete files older than 2 days
find "$target_dir" -type f -mmin +1440 -delete

# Alternative version using explicit rm command:
# find "$target_dir" -type f -mtime +2 -exec rm -- {} +
