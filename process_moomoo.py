#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
from is_number import is_number

#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def get_moomoo_attributes():
    attributes = {
        "name" : "moomoo",
        "process" : process_moomoo,
        "has_realtime" : True, 
        "has_pre_market" : False,
        "has_after_hours" : False, # True only for stocks, not for ETFs
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def process_moomoo(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"process moomoo")
    url_selection = 'moomoo'
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
        #url = "https://www.moomoo.com/stock/NVDA-US"
        key = ticker['key']
        logging.info("\n")
        logging.info(f'Begin processing: {ticker['key']} selected url: {url}')
        
        driver.get(url)
        #logging.info(f'sleep 3 seconds to allow website to load')
        time.sleep(3)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
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

        logging.info(f"check for after_hours_price")   
        after_hours_price = ""
        after_hours_section = quote_element.select_one('[class="disc-info"]')
        if after_hours_section == None:
            logging.info(f"could not find after hours section")
        
        after_hours_price_element = None
        if after_hours_section != None:
            logging.info(f"look for after hours up")
            after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-up"]')
            if after_hours_price_element == None:
                logging.info(f"look for after hours up")
                after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-down"]')

        after_hours_datetime = ""
        if after_hours_price_element != None:
            after_hours_price = after_hours_price_element.text.strip()
            after_hours_datetime_element = after_hours_section.select_one('[class="status"]')
            logging.info(f"after_hours_datetime_element: {after_hours_datetime_element.text}")
            parts = after_hours_datetime_element.text.split()

            if parts[0] == "Post":
                logging.info(f"Found post session price")
            else:
                logging.info(f"Found pre market session price??")

        else:
            logging.info(f"could not find after hours price")
        logging.info(f"after_hours_price: {after_hours_price}")




        data = {}
        data["key"] = key
        data["last_price"] = last_price
        data["after_hours_price"] = after_hours_price
        #data["pre_market_price"] = pre_market_price
        data["source"] = "moomoo"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)
        

    return 0
