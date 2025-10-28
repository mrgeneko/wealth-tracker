#!/usr/bin/env python3
import logging

def get_fintel_attributes():
    attributes = {
        "name" : "fintel",
        "download" : "singlefile",
        "extract" : extract_fintel,
        "has_realtime" : False,
        "has_pre_market" : False,
        "has_after_hours" : False,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_fintel(ticker, html_content):
    logging.info(f"extract_fintel for {ticker}")
    return None
