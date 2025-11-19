#!/usr/bin/env python3
import logging
from .scraper_config import get_attributes as _get_config_attrs

def get_wsj_attributes():
    attributes = _get_config_attrs('wsj') or {}
    attributes['extract'] = extract_wsj
    return attributes

def extract_wsj(ticker, html_content):
    logging.info(f"extract_wsj for {ticker}")
    return None
