#!/usr/bin/env python3
import logging
from .scraper_config import get_attributes as _get_config_attrs

def get_cnbc_attributes():
    attributes = _get_config_attrs('cnbc') or {}
    # attach local function references
    attributes['extract'] = extract_cnbc
    return attributes

def extract_cnbc(ticker, html_content):
    logging.info(f"extract_cnbc for {ticker}")
    return None
