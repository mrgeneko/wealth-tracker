#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
from datetime import datetime
from .is_number import is_number

def get_trading_view_attributes():
    attributes = {
        "name" : "trading_view",
        "download" : "singlefile",
        "extract" : extract_trading_view,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_trading_view(ticker, html_content):
    logging.info(f"extract_trading_view for {ticker}")
    # placeholder extraction
    return None
#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
from datetime import datetime
from .is_number import is_number

def get_trading_view_attributes():
    attributes = {
        "name" : "trading_view",
        "download" : "singlefile",
        "extract" : extract_trading_view,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_trading_view(ticker, html_content):
    logging.info(f"extract_trading_view for {ticker}")
    # placeholder extraction
    return None
