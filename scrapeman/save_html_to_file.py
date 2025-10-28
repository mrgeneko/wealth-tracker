#!/usr/bin/env python3
import os
import logging
import re
from datetime import datetime

def save_html_to_file(url, html_content):
    parsed_url = re.sub(r'https?://', '', url)
    cleaned_url = re.sub(r'[:/]+', '_', parsed_url)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    base_path = os.path.expanduser('~/logs')
    os.makedirs(base_path, exist_ok=True)
    html_file_path = os.path.join(base_path, f'{cleaned_url}_{timestamp}.html')
    logging.info(f"save html to: {html_file_path}")
    with open(html_file_path, "w", encoding='utf-8') as f:
        f.write(html_content)
    return 0
