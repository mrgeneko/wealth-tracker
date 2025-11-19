#!/usr/bin/env python3
import logging
from .is_number import is_number
from .scraper_config import get_attributes as _get_config_attrs

def get_ycharts_attributes():
    attributes = _get_config_attrs('ycharts') or {}
    attributes['extract'] = extract_ycharts
    return attributes

def extract_ycharts(ticker, html_content):
    logging.info(f"extract_ycharts for {ticker}")
    return None
