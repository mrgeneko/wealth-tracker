#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
from is_number import is_number

def get_nasdaq_attributes():
    attributes = {
        "name" : "nasdaq",
        "process" : process_nasdaq,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def process_nasdaq(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"process_nasdaq")
    selected_source = 'nasdaq'
    for i, ticker in enumerate(tickers):

        if selected_source in ticker:
            logging.debug(f"Key {ticker['key']} has url: {ticker[selected_source]}")
        else:
            logging.debug(f"Key {selected_source} does not exist in this object.")

        if not pd.isna(ticker[selected_source]):
            logging.debug(f"Key {ticker['key']} has value: {ticker[selected_source]}")
        else:
            logging.debug(f"Key {selected_source} does not have a value or has NaN.")
            continue

        url = ticker[selected_source]
        url = "https://seekingalpha.com/symbol/NVDA"
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
        last_price_element = soup.select_one('[class="text-6x-large-b md:leading-none"]')
       
        #element = main_element.select_one('[class="YMlKec fxKbKc"]')
        logging.info(f'last price element: {last_price_element}')
        last_price = last_price_element.text
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
#

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
        

        # transfer data to object that udpate_cell_in_numbers.py expects
        # Get the current time   ---- THESE SHOULD BE WRAPPED UP IN FUNCTIONS!!!
        current_time = datetime.now().time()
        pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
        market_open_time = datetime.strptime("09:30", "%H:%M").time()
        market_close_time = datetime.strptime("16:00", "%H:%M").time()

        data = {}
        data["key"] = key
        data["last_price"] = last_price
        data["price_change_decimal"] = price_change_decimal
        data["price_change_percent"] = price_change_percent
        data["after_hours_price"] = after_hours_price
        data["pre_market_price"] = pre_market_price
        data["source"] = "google finance"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)
    return 0
