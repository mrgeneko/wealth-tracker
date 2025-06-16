#!/usr/bin/env python3
import logging
import time
from session_times import *
from bs4 import BeautifulSoup
from datetime import datetime
from update_cell_in_numbers import update_numbers
import pandas as pd
from save_html_to_file import save_html_to_file
from is_number import is_number

def get_wsj_attributes():
    attributes = {
        "name" : "wsj",
        "download" : "singlefile",
        "extract" : extract_wsj,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes


def extract_wsj(ticker,html_content):
    logging.info(f"extract wsj")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')
    last_price = ""
    after_hours_price = ""
    pre_market_price = ""

    last_price_element = soup.select_one('[id="quote_val"]')
    #price_normal_element = quote_element.select_one('[class="price-normal"]')
    #last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-up"]')
    if last_price_element != None:
        last_price = last_price_element.text
        logging.info(f'last price element: {last_price}')
    else:
        logging.info(f'last price element not found')
            
        


    last_price_datetime_element = soup.select_one('[class="quote_dateTime"]')
    logging.info(f"last_price_datetime: {last_price_datetime_element.text}")
    


    extended_hours_element = soup.select_one('[class="index-rank-value index-rank-value-small"]')
    if extended_hours_element != None:
        extended_hours_price = extended_hours_element.text
    else:
        extended_hours_price = ""
    logging.info(f"extended hours price: {extended_hours_price}")

    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["source"] = "wsj"
    #if not is_weekday():
    #    data["after_hours_price"] = extended_hours_price
    #if current_time < market_open_time and current_time > pre_market_open_time and is_number(extended_hours_price):
    ##    data["pre_market_price"] = extended_hours_price
    #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(extended_hours_price):
    #    data["after_hours_price"] = extended_hours_price

    
    logging.info(data)
    return data
