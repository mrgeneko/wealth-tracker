#!/usr/bin/env python3
import logging

def get_cnbc_attributes():
    attributes = {
        "name" : "cnbc",
        "download" : "singlefile",
        "extract" : extract_cnbc,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_cnbc(ticker, html_content):
    logging.info(f"extract_cnbc for {ticker}")
    return None
