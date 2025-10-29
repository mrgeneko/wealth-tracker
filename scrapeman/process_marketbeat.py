#!/usr/bin/env python3
import logging

def get_marketbeat_attributes():
    attributes = {
        "name" : "marketbeat",
        "download" : "singlefile",
        "extract" : extract_marketbeat,
        "has_realtime" : False,
        "has_pre_market" : False,
        "has_after_hours" : False,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_marketbeat(ticker, html_content):
    logging.info(f"extract_marketbeat for {ticker}")
    return None
