#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
import pandas as pd
from session_times import *

def get_cnbc_attributes():
    attributes = {
        "name" : "cnbc",
        "download" : "selenium",
        "process" : process_cnbc,
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

def extract_cnbc(ticker,html_content):
    logging.info(f"extract cnbc")

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
                after_hours_price = after_hours_price_element.text.strip()
                logging.info(f'after hours price: {after_hours_price}')
    else:
        logging.info(f"no found regular_trading_price_element")
        regular_trading_price_element = soup.select_one('[class="QuoteStrip-lastPriceStripContainer"]')
        if regular_trading_price_element != None:
            last_price_element = regular_trading_price_element.select_one('[class="QuoteStrip-lastPrice"]')
            last_price = last_price_element.text
            logging.info(f'last price: {last_price}')

    
    #logging.info(f"after_hours_price: {after_hours_price}")

    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    if after_hours_price != "":
        if is_pre_market_session():
            logging.info(f"currently in pre market session")
            data["pre_market_price"] = after_hours_price
        elif is_after_hours_session() or not is_weekday():
            logging.info(f"currently in after hours session")
            data["after_hours_price"] = after_hours_price
    else:
        data["pre_market_price"] = ""
        data["after_hours_price"] = ""
    data["source"] = "cnbc"
    
    logging.info(data)
    return data

def process_cnbc(driver,tickers):
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
        time.sleep(2)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
        logging.info(f"html_content: {html_content[:20]}")

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
                    after_hours_price = after_hours_price_element.text.strip()
                    logging.info(f'after hours price: {after_hours_price}')
        else:
            logging.info(f"no found regular_trading_price_element")
            regular_trading_price_element = soup.select_one('[class="QuoteStrip-lastPriceStripContainer"]')
            if regular_trading_price_element != None:
                last_price_element = regular_trading_price_element.select_one('[class="QuoteStrip-lastPrice"]')
                last_price = last_price_element.text
                logging.info(f'last price: {last_price}')

        
        #logging.info(f"after_hours_price: {after_hours_price}")

        data = {}
        data["key"] = key
        data["last_price"] = last_price
        if after_hours_price != "":
            if is_pre_market_session():
                logging.info(f"currently in pre market session")
                data["pre_market_price"] = after_hours_price
            elif is_after_hours_session():
                logging.info(f"currently in after hours session")
                data["after_hours_price"] = after_hours_price
        else:
            data["pre_market_price"] = ""
            data["after_hours_price"] = ""
        data["source"] = "cnbc"
        
        logging.info(data)
        
    return data
