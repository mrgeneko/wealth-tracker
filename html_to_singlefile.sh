#!/bin/bash

# https://deepwiki.com/gildas-lormeau/single-file-cli/5.3-docker-deployment

# Check if exactly two arguments are provided
if [ $# -ne 2 ]; then
    echo "Usage: $0 <ticker> <source>"
    exit 1
fi

# Assign arguments to variables
url=$1
filename=$2

echo url: "$url"
echo filename: "$filename"

# Create target directory if it doesn't exist
mkdir -p ~/singlefile_html/

# Validate timestamp format (alphanumeric with dots, hyphens or underscores)
#if [[ ! $timestamp =~ ^[a-zA-Z0-9_.:-]+$ ]]; then
#    echo "Error: Timestamp contains invalid characters. Use alphanumeric and these symbols: . - _ :"
#    exit 1
#fi

# Run docker command and save output to file
#docker run --rm -v "/Users/gene/singlefile_html:/usr/src/app/out" singlefile "$url" > ~/singlefile_html/${ticker}.${source}.${timestamp}.html
docker run --rm -v "/Users/gene/singlefile_html:/usr/src/app/out" singlefile "$url" "$filename"


# Optional: Check if docker command succeeded
if [ $? -eq 0 ]; then
    echo "Successfully ran singlefile. HTML to ${filename}"
    exit 0
else
    echo "Error: Failed to execute docker command. Ensure 'singlefile' image is available."
    exit 1
fi
