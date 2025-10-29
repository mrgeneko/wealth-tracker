#!/usr/bin/env python3
import logging
from .is_number import is_number

def get_webull_attributes():
    attributes = {
        "name" : "webull",
        "download" : "singlefile",
        "extract" : extract_webull,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : True,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_webull(ticker, html_content):
    logging.info(f"extract_webull for {ticker}")
    return None
