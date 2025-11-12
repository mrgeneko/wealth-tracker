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
    soup = BeautifulSoup(html_content, 'html.parser')
    data = {}
    # Extract last price (try multiple selectors)
    last_price = ""
    selectors = [
        ('span', 'last-zoF9r75I js-symbol-last'),
        ('span', 'last-zoF9r75I'),
        ('span', 'js-symbol-last'),
        ('span', 'last-NYvR1HH2 js-symbol-ext-hrs-close'),
        ('span', 'last-NYvR1HH2'),
    ]
    for tag, cls in selectors:
        el = soup.find(tag, class_=cls)
        if el and el.span:
            last_price = el.span.get_text(strip=True)
            break
        elif el and el.get_text(strip=True):
            last_price = el.get_text(strip=True)
            break
    # Extract price change decimal and percent (try multiple selectors)
    price_change_decimal = ""
    price_change_percent = ""
    change_selectors = [
        ('div', 'change-zoF9r75I js-symbol-change-direction up-raL_9_5p'),
        ('div', 'change-zoF9r75I js-symbol-change-direction'),
        ('div', 'change-zoF9r75I'),
    ]
    for tag, cls in change_selectors:
        change_block = soup.find(tag, class_=cls)
        if change_block:
            change_spans = change_block.find_all('span')
            if len(change_spans) >= 2:
                price_change_decimal = change_spans[0].get_text(strip=True)
                price_change_percent = change_spans[1].get_text(strip=True)
                break
            elif len(change_spans) == 1:
                price_change_decimal = change_spans[0].get_text(strip=True)
                break
    # Extract currency (try multiple selectors)
    currency = ""
    currency_selectors = [
        ('span', 'js-symbol-currency currency-zoF9r75I'),
        ('span', 'currency-zoF9r75I'),
    ]
    for tag, cls in currency_selectors:
        currency_tag = soup.find(tag, class_=cls)
        if currency_tag:
            currency = currency_tag.get_text(strip=True)
            break
    # Previous close, after hours, pre-market not available
    # Calculate previous_close_price if possible
    previous_close_price = ""
    try:
        if last_price and price_change_decimal:
            # Remove any non-numeric characters (e.g., commas, unicode minus)
            lp = str(last_price).replace(",", "").replace("−", "-")
            pcd = str(price_change_decimal).replace(",", "").replace("−", "-")
            previous_close_price = str(round(float(lp) - float(pcd), 6))
    except Exception as e:
        logging.warning(f"Could not calculate previous_close_price: {e}")
    after_hours_price = ""
    pre_market_price = ""
    data["key"] = ticker
    data["last_price"] = last_price
    data["price_change_decimal"] = price_change_decimal
    data["price_change_percent"] = price_change_percent
    data["previous_close_price"] = previous_close_price
    data["after_hours_price"] = after_hours_price
    data["pre_market_price"] = pre_market_price
    data["currency"] = currency
    data["source"] = "trading_view"
    # If no key fields found, log raw HTML for debugging
    if not last_price and not price_change_decimal:
        logging.error(f"TradingView extraction failed for {ticker}. Raw HTML:\n{html_content[:2000]}")
        return None
    logging.info(data)
    return data
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