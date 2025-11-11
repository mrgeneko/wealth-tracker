#!/usr/bin/env python3
import logging
from datetime import datetime
from bs4 import BeautifulSoup
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
    #logging.info(html_content)
    soup = BeautifulSoup(html_content, 'html.parser')

    # Extract last price: try csr121 csr117, then csr120 csr117
    last_price_tag = soup.find('div', class_='csr121 csr117')
    last_price = last_price_tag.get_text(strip=True) if last_price_tag else ""
    if last_price == "":
        last_price_tag = soup.find('div', class_='csr120 csr117')
        last_price = last_price_tag.get_text(strip=True) if last_price_tag else ""
    if last_price == "":
        logging.info("Webull: last_price not found in HTML.")
        logging.info(html_content)

    # Extract price change decimal and percent (class csr136 contains two csr121 or csr120 divs)
    price_change_decimal = ""
    price_change_percent = ""
    price_change_container = soup.find('div', class_='csr136')
    if price_change_container:
        change_tags = price_change_container.find_all('div', class_='csr121')
        if len(change_tags) < 2:
            change_tags = price_change_container.find_all('div', class_='csr120')
        if len(change_tags) >= 2:
            price_change_decimal = change_tags[0].get_text(strip=True)
            price_change_percent = change_tags[1].get_text(strip=True)

    previous_close_price = ""
    try:
        if last_price and price_change_decimal:
            previous_close_price = str(round(float(last_price) - float(price_change_decimal), 6))
    except Exception as e:
        logging.warning(f"Could not calculate previous_close_price: {e}")

    data = {
        "key": ticker,
        "last_price": last_price,
        "price_change_decimal": price_change_decimal,
        "price_change_percent": price_change_percent,
        "after_hours_price": "",
        "pre_market_price": "",
        "previous_close_price": previous_close_price,
        "source": "webull"
    }
    logging.info(data)
    return data
