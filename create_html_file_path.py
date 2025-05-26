import os
import datetime
import re
from datetime import datetime

# Function to create log file path
def create_html_file_path(base_path, url):
    # Extract relevant parts from the URL
    parsed_url = re.sub(r'https?://', '', url)  # Remove http/https and slashes
    cleaned_url = re.sub(r'[:/]+', '_', parsed_url)  # Replace colons and slashes with underscores

    # Generate timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # Construct log file path
    log_file_path = os.path.join(base_path, f'{cleaned_url}_{timestamp}.html')
    
    return log_file_path