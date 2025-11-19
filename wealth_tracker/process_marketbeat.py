#!/usr/bin/env python3
import logging
from .scraper_config import get_attributes as _get_config_attrs

def get_marketbeat_attributes():
    attributes = _get_config_attrs('marketbeat') or {}
    attributes['extract'] = extract_marketbeat
    return attributes

def extract_marketbeat(ticker, html_content):
    logging.info(f"extract_marketbeat for {ticker}")
    return None
