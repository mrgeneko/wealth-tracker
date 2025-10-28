#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
from datetime import datetime
from .is_number import is_number

def get_investing_attributes():
    attributes = {
        "name" : "investing",
        "download" : "singlefile",
        "extract" : extract_investing,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_investing(ticker, html_content):
    logging.info(f"extract_investing for {ticker}")
    soup = BeautifulSoup(html_content, 'html.parser')
    # placeholder - investing extraction logic lives in parse_investing_com_html
    return None
