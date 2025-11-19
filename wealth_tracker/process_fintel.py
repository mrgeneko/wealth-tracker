#!/usr/bin/env python3
import logging
from .scraper_config import get_attributes as _get_config_attrs

def get_fintel_attributes():
    attributes = _get_config_attrs('fintel') or {}
    attributes['extract'] = extract_fintel
    return attributes

def extract_fintel(ticker, html_content):
    logging.info(f"extract_fintel for {ticker}")
    return None
