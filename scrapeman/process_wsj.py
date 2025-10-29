#!/usr/bin/env python3
import logging

def get_wsj_attributes():
    attributes = {
        "name" : "wsj",
        "download" : "singlefile",
        "extract" : extract_wsj,
        "has_realtime" : False,
        "has_pre_market" : False,
        "has_after_hours" : False,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_wsj(ticker, html_content):
    logging.info(f"extract_wsj for {ticker}")
    return None
