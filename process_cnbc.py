#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
from is_number import is_number

#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def get_cnbc_attributes():
    attributes = {
        "name" : "cnbc",
        "process" : process_cnbc,
        "has_realtime" : True, 
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def process_cnbc(driver,tickers,function_handlers,sleep_interval):
    logging.debug(f"process cnbc")
    url_selection = 'cnbc'
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
        time.sleep(3)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
        #logging.info(f"html_content: {html_content}")

        soup = BeautifulSoup(html_content, 'html.parser')
        # class name is misleading?
        last_price = ""
        after_hours_price = ""
        regular_trading_price_element = soup.select_one('[class="QuoteStrip-dataContainer QuoteStrip-extendedHours"]') 
        if regular_trading_price_element != None:
            logging.info(f"found regular_trading_price_element")
            #price_normal_element = regular_trading_price_element.select_one('[class="price-normal"]')
            last_price_element = regular_trading_price_element.select_one('[class="QuoteStrip-lastPrice"]')
            if last_price_element != None:
                last_price = last_price_element.text.strip()
                logging.info(f'last price: {last_price}')

                after_hours_price_section = soup.select_one('[class="QuoteStrip-extendedDataContainer QuoteStrip-dataContainer"]') 
                #price_normal_element = regular_trading_price_element.select_one('[class="price-normal"]')
                after_hours_price_element = after_hours_price_section.select_one('[class="QuoteStrip-lastPrice"]')
                after_hours_label = after_hours_price_section.select_one('[class="QuoteStrip-extendedLabel"]')
                if after_hours_label != None:
                    if after_hours_label.text.startswith("After Hours"):
                        logging.info(f"we found after hours label")
                if after_hours_price_element != None:
                    after_hours_price_price = after_hours_price_element.text.strip()
                    logging.info(f'after hours price: {after_hours_price_price}')

        else:
            logging.info(f"no found regular_trading_price_element")
            regular_trading_price_element = soup.select_one('[class="QuoteStrip-lastPriceStripContainer"]')
            if regular_trading_price_element != None:
                last_price_element = regular_trading_price_element.select_one('[class="QuoteStrip-lastPrice"]')
                last_price = last_price_element.text
                logging.info(f'last price: {last_price}')



        data = {}
        data["key"] = key
        data["last_price"] = last_price
        data["after_hours_price"] = after_hours_price
        #data["pre_market_price"] = pre_market_price
        data["source"] = "cnbc"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)
        

    return 0
