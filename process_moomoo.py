#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup

#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def get_moomoo_attributes():
    attributes = {
        "name" : "moomoo",
        "download" : "selenium",
        "extract" : extract_moomoo,
        "has_realtime" : True, 
        "has_pre_market" : True,
        "has_after_hours" : True, # True only for stocks, not for ETFs
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes


def extract_moomoo(ticker,html_content):
    logging.info(f"extract moomoo")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')
    quote_element = soup.select_one('[class="flex-end stock-data"]')
    price_normal_element = quote_element.select_one('[class="price-normal"]')
    last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-up"]')
    if last_price_element == None:
        last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-down"]')
    if last_price_element != None:
        last_price = last_price_element.text.strip()
        logging.info(f'last price element: {last_price}')
    newline_index = last_price.find('\n')
    if newline_index != -1:
        last_price = last_price[:newline_index]


    logging.info(f"check for after_hours_price")   
    after_hours_price = ""
    pre_market_price = ""
    after_hours_section = quote_element.select_one('[class="disc-info"]')
    if after_hours_section == None:
        logging.info(f"could not find after hours section")
    
    after_hours_price_element = None
    if after_hours_section != None:
        logging.info(f"look for after hours up")
        after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-up"]')
        if after_hours_price_element == None:
            logging.info(f"look for after hours down")
            after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-down"]')

    after_hours_datetime = ""
    if after_hours_price_element != None:
        after_hours_price_string = after_hours_price_element.text.strip()
        #plus_index = after_hours_price_string.find('+')
        #plus_index = after_hours_price_string.find('+')
        max_pos = len(after_hours_price_string) 
        token_index = next((idx for char in ('+', '-') if (idx := after_hours_price_string.find(char, 0, max_pos)) != -1), -1)
        if token_index != -1:
            after_hours_price = after_hours_price_string[:token_index]
        else:
            after_hours_price = after_hours_price_string


        after_hours_datetime_element = after_hours_section.select_one('[class="status"]')
        logging.info(f"after_hours_datetime_element: {after_hours_datetime_element.text}")
        parts = after_hours_datetime_element.text.split()

        if parts[0] == "Post":
            logging.info(f"Found post session price")
        else:
            logging.info(f"Found pre market session price??")
            pre_market_price = after_hours_price
            after_hours_price = ""

    else:
        logging.info(f"could not find after hours price")
    logging.info(f"after_hours_price: {after_hours_price}")


    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["after_hours_price"] = after_hours_price
    data["pre_market_price"] = pre_market_price
    data["source"] = "moomoo"
    #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
    #    data["pre_market_price"] = pre_market_price
    #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
    #    data["after_hours_price"] = after_hours_price
    
    logging.info(data)
    return data
