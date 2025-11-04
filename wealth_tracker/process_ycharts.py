#!/usr/bin/env python3
import logging
from .is_number import is_number

def get_ycharts_attributes():
    attributes = {
        "name" : "ycharts",
        "download" : "singlefile",
        "extract" : extract_ycharts,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_ycharts(ticker, html_content):
    logging.info(f"extract_ycharts for {ticker}")
    return None
