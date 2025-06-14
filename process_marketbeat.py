#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
from is_number import is_number
from session_times import *

#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def get_marketbeat_attributes():
    attributes = {
        "name" : "marketbeat",
        "download" : "chrome_dom_dump",
        "process" : process_marketbeat,
        "extract" : extract_marketbeat,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_marketbeat(ticker,html_content):
    logging.info(f"extract marketbeat")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')
   
    last_price_element = soup.select_one('[class="d-inline-block mb-2 mr-4"]')
    logging.info(f'last price element: {last_price_element.text}')
    parts = last_price_element.text.split()
    last_price = parts[0]
    if last_price.startswith("$"):
        last_price = last_price[1:]
    logging.info(f"last_price: {last_price}")

    price_change_decimal = parts[1]
    logging.info(f"price_change_decimal: {price_change_decimal}")
    price_change_percent = parts[2]
    logging.info(f"price_change_percent: {price_change_percent}")
    last_price_datetime = parts[5] + ' ' + parts[6] + ' ' + parts[7]
    logging.info(f"last_price_datetime: {last_price_datetime}")   

    extended_trading_price = ""
    try:
        extended_trading_element = soup.select_one('[class="d-inline-block extended-hours mb-2"]')
        logging.info(f"ext hours price {extended_trading_element.text}")
        extended_trading_price = extended_trading_element.text.split('$')[1].split()[0]
        logging.info(f"ext price: {extended_trading_price}")
    except:
        logging.info(f"unable to find extended hours price")

    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["price_change_decimal"] = price_change_decimal
    data["price_change_percent"] = price_change_percent
    if not is_weekday():
        data["after_hours_price"] = extended_trading_price
    elif is_pre_market_session():
        data["pre_market_price"] = extended_trading_price
    elif is_after_hours_session():
        data["after_hours_price"] = extended_trading_price
    data["source"] = "marketbeat"
    
    logging.info(data)
    return data

def process_marketbeat(driver,tickers,function_handlers,sleep_interval):

    url_selection = 'marketbeat'
    for i, ticker in enumerate(tickers):

        if url_selection in ticker:
            logging.debug(f"Key {ticker['key']} has url: {ticker[url_selection]}")
        else:
            logging.debug(f"Key {url_selection} does not exist in this object.")

        if not pd.isna(ticker[url_selection]):
            logging.debug(f"Key {ticker['key']} has value: {ticker[url_selection]}")
        else:
            logging.debug(f"Key {url_selection} does not have a value or has NaN.")
            continue

        url = ticker[url_selection]
        key = ticker['key']
        logging.info("\n")
        logging.info(f'Begin processing: {ticker['key']} selected url: {url}')
        driver.get(url)
        #logging.info(f'sleep 3 seconds to allow website to load')
        time.sleep(2)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
        #logging.info(f"html_content: {html_content}")

        soup = BeautifulSoup(html_content, 'html.parser')
        last_price_element = soup.select_one('[class="d-inline-block mb-2 mr-4"]')
        logging.info(f'last price element: {last_price_element.text}')
        parts = last_price_element.text.split()
        last_price = parts[0]
        if last_price.startswith("$"):
            last_price = last_price[1:]
        logging.info(f"last_price: {last_price}")

        price_change_decimal = parts[1]
        logging.info(f"price_change_decimal: {price_change_decimal}")
        price_change_percent = parts[2]
        logging.info(f"price_change_percent: {price_change_percent}")
        last_price_datetime = parts[5] + ' ' + parts[6] + ' ' + parts[7]
        logging.info(f"last_price_datetime: {last_price_datetime}")   

        data = {}
        data["key"] = key
        data["last_price"] = last_price
        data["price_change_decimal"] = price_change_decimal
        data["price_change_percent"] = price_change_percent
        #data["after_hours_price"] = after_hours_price
        #data["pre_market_price"] = pre_market_price
        data["source"] = "marketbeat"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)

        return 0
        main_element.select_one('[class="YMlKec fxKbKc"]')
        element = main_element.select_one('[class="YMlKec fxKbKc"]')
        #logging.info(f'last price element: {element}')
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
        
        #logging.info(f'price change element: {element}')
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
            #logging.info(f"price_change element: {element.text}")
            price_change_percent = price_change_sign + element.text
            logging.debug(f"price_change_percent: {price_change_percent}")


        element = main_element.select_one('[class="ygUjEc"]')
        last_price_datetime = element.text.split()[:5]
        logging.debug(f"last_price_datetime: {last_price_datetime}")

        after_hours_price = ""
        pre_market_price = ""
        
        #ext_hours_section = soup.select_one('[class="ivZBbf ygUjEc"]')
        ext_hours_section = soup.select_one('[jsname="QRHKC"]')
        if ext_hours_section != None:
            #logging.info(f"ext_hours_section: {ext_hours_section.text}")
            element = ext_hours_section.select_one('[class="YMlKec fxKbKc"]')
            if element != None:
                #logging.info(f"after hours segment:{element.text}")
                if ext_hours_section.text.startswith("After Hours"):
                    after_hours_price = element.text[1:]
                elif ext_hours_section.text.startswith("Pre-market"):
                    pre_market_price = element.text[1:]
        logging.info(f"premarket price: {pre_market_price}")    
        logging.info(f"after hours price: {after_hours_price}")
        


        data = {}
        data["key"] = key
        data["last_price"] = last_price
        data["price_change_decimal"] = price_change_decimal
        data["price_change_percent"] = price_change_percent
        data["after_hours_price"] = after_hours_price
        data["pre_market_price"] = pre_market_price
        data["source"] = "wsj"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)
    return 0
