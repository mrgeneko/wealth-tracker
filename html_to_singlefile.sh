#!/bin/bash

# This scrip assumes that the codecapsule/singlefile image is already installed in docker

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

echo url: "$url" >&2
echo filename: "$filename" >&2

# Create target directory if it doesn't exist
mkdir -p ~/singlefile_html/



# Run docker command with timeout and capture container ID
container_id=$(docker-compose run -d --rm -T singlefile "$url" "$filename" --load-deferred-images false --browser-wait-until InteractiveTime --block-images true --block-fonts true)
#container_id=$(docker-compose run -d --rm -T singlefile "$url" "$filename" --load-deferred-images false --block-images true --block-fonts true)


# Wait for the container to finish with timeout
gtimeout -k 5s 20s docker wait "$container_id"
status=$?

# If timeout or error, kill the container
if [ $status -eq 0 ]; then
    echo "Successfully ran singlefile. HTML to ${filename}" >&2
    exit 0
else
    echo "Error or timeout occurred. Killing container $container_id..." >&2
    docker kill "$container_id"
    exit 1
fi
