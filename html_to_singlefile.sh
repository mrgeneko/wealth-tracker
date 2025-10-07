#!/bin/bash

# https://deepwiki.com/gildas-lormeau/single-file-cli/5.3-docker-deployment

# https://peter.sh/experiments/chromium-command-line-switches/
# "~/Library/Application Support/Google/Chrome/Default"

# Check if exactly two arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <url> <filename>"
    exit 1
fi

# Assign arguments to variables
url=$1
filename=$2

echo url: "$url"
echo filename: "$filename"

# Create target directory if it doesn't exist
mkdir -p ~/singlefile_html/

# Run docker command and save output to file
docker run --rm -v "$HOME/singlefile_html:/usr/src/app/out" singlefile "$url" "$filename" --load-deferred-images false --browser-wait-until InteractiveTime --block-images true --block-fonts true


# Optional: Check if docker command succeeded
if [ $? -eq 0 ]; then
    echo "Successfully ran singlefile. HTML to ${filename}"
    exit 0
else
    echo "Error: Failed to execute docker command. Ensure 'singlefile' image is available."
    exit 1
fi
