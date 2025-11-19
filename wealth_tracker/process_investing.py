#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
from datetime import datetime
from .is_number import is_number
from .scraper_config import get_attributes as _get_config_attrs

def get_investing_attributes():
    attributes = _get_config_attrs('investing') or {}
    attributes['extract'] = extract_investing
    return attributes

def extract_investing(ticker, html_content):
    logging.info(f"extract_investing for {ticker}")
    soup = BeautifulSoup(html_content, 'html.parser')
    # placeholder - investing extraction logic lives in parse_investing_com_html
    return None
