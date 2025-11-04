#!/usr/bin/env python3
import logging

def get_nasdaq_attributes():
    attributes = {
        "name" : "nasdaq",
        "download" : "singlefile",
        "extract" : extract_nasdaq,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_nasdaq(ticker, html_content):
    logging.info(f"extract_nasdaq for {ticker}")
    return None
