#!/usr/bin/env python3
import logging
from .scraper_config import get_attributes as _get_config_attrs

def get_nasdaq_attributes():
    attributes = _get_config_attrs('nasdaq') or {}
    attributes['extract'] = extract_nasdaq
    return attributes

def extract_nasdaq(ticker, html_content):
    logging.info(f"extract_nasdaq for {ticker}")
    return None
