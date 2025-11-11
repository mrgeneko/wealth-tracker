#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
from .is_number import is_number

def get_google_attributes():
    attributes = {
        "name" : "google",
        "download" : "singlefile",
        "extract" : extract_google,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_google(ticker,html_content):
    logging.info(f"extract google")
    last_price = ""
    after_hours_price = ""
    pre_market_price = ""

    soup = BeautifulSoup(html_content, 'html.parser')
    main_element = soup.select_one('[class="Gfxi4"]')
    main_element.select_one('[class="YMlKec fxKbKc"]')
    element = main_element.select_one('[class="YMlKec fxKbKc"]')
    last_price = element.text
    if last_price.startswith("$"):
        last_price = last_price[1:]
    logging.info(f"last_price: {last_price}")

    element = soup.select_one('[class="P2Luy Ez2Ioe ZYVHBb"]')
    if element == None:
        logging.info(f"first change element not found")
        element = soup.select_one('[class="P2Luy Ebnabc ZYVHBb"]')
        if element == None:
            logging.info(f"second change element not found")
    if element != None:
        if element.text.startswith("+"):
            price_change_sign = "+"
        elif element.text.startswith("-"):
            price_change_sign = "-"
        else:
            price_change_sign = ""
        parts = element.text.split()
        price_change_decimal = parts[0]
        logging.debug(f"price_change_decimal: {price_change_decimal}")
    else:
        price_change_decimal = ""
        price_change_percent = ""
        price_change_sign = ""
    if price_change_sign != "":
        element = main_element.select_one('[class="JwB6zf"]')
        price_change_percent = price_change_sign + element.text
        logging.debug(f"price_change_percent: {price_change_percent}")

    element = main_element.select_one('[class="ygUjEc"]')
    last_price_datetime = element.text.split()[:5]
    logging.debug(f"last_price_datetime: {last_price_datetime}")

    after_hours_price = ""
    pre_market_price = ""
    ext_hours_section = soup.select_one('[jsname="QRHKC"]')
    if ext_hours_section != None:
        element = ext_hours_section.select_one('[class="YMlKec fxKbKc"]')
        if element != None:
            if ext_hours_section.text.startswith("After Hours"):
                after_hours_price = element.text[1:]
            elif ext_hours_section.text.startswith("Pre-market"):
                pre_market_price = element.text[1:]
    logging.info(f"premarket price: {pre_market_price}")    
    logging.info(f"after hours price: {after_hours_price}")
    current_time = datetime.now().time()
    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()

    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["price_change_decimal"] = price_change_decimal
    data["price_change_percent"] = price_change_percent
    data["after_hours_price"] = after_hours_price
    data["pre_market_price"] = pre_market_price
    data["source"] = "google_finance"
    logging.info(data)
    return data
