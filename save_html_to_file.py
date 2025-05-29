#!/usr/bin/env python3
import os
import datetime
import logging
import re
from datetime import datetime

# Function to create log file path
def save_html_to_file(url, html_content):
    # Extract relevant parts from the URL
    parsed_url = re.sub(r'https?://', '', url)  # Remove http/https and slashes
    cleaned_url = re.sub(r'[:/]+', '_', parsed_url)  # Replace colons and slashes with underscores

    # Generate timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # Base path for logs
    base_path = '/Users/gene/logs'
    
    # Construct log file path
    html_file_path = os.path.join(base_path, f'{cleaned_url}_{timestamp}.html')
    
    # Create log file path
    logging.info(f"save html to: {html_file_path}")
    with open(html_file_path, "w") as f:
        f.write(html_content)

    return 0