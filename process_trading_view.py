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

def get_trading_view_attributes():
    attributes = {
        "name" : "trading_view",
        "download" : "singlefile",
        "process" : process_trading_view,
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

def extract_trading_view(ticker,html_content):
    logging.info(f"extract trading_view")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')

    element = soup.select_one('[class="last-zoF9r75I js-symbol-last"]')
    logging.debug(f'last price element: {element}')
    last_price = element.text
    logging.debug(f"last_price: {last_price}")

    element = soup.select_one('[class="change-zoF9r75I js-symbol-change-direction down-raL_9_5p"]')
    logging.debug(f'1st price change element: {element}')
    if element != None:
        logging.debug(f"children:{element.findChildren()}")
        price_change_decimal = element.findChildren()[0].text
        logging.debug(f"price_change_decimal: {price_change_decimal}")

        price_change_percent = element.findChildren()[1].text
        logging.debug(f"price_change_percent: {price_change_percent}")
    else:
        element = soup.select_one('[class="change-zoF9r75I js-symbol-change-direction up-raL_9_5p"]')
        logging.debug(f'price change element: {element}')
        if element != None:
            price_change_decimal = element.findChildren()[0].text
            logging.debug(f"price_change_decimal: {price_change_decimal}")

            price_change_percent = element.findChildren()[1].text
            logging.debug(f"price_change_percent: {price_change_percent}")

    element = soup.select_one('[class="js-symbol-lp-time"]')
    last_price_datetime = element.text
    logging.debug(f"last_price_datetime: {last_price_datetime}")

    element = soup.select_one('[class="last-zoF9r75I last-NYvR1HH2 js-symbol-ext-hrs-close"]')
    if element != None:
        pre_post_market_element = soup.select_one('[class="marketStatusPre-NYvR1HH2"]')
        if pre_post_market_element != None and pre_post_market_element.text == "Pre-market":
            pre_market_price = element.text
            logging.info(f"pre_market_price: {pre_market_price}")

            element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
            pre_market_price_change_decimal = element.text
            logging.debug(f"pre_market_price_change_decimal: {pre_market_price_change_decimal}")

            element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
            pre_market_price_change_percent = element.text
            logging.debug(f"pre_market_price_change_percent: {pre_market_price_change_percent}")

            element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
            pre_market_price_datetime = element.text
            logging.info(f"pre_market_price_datetime: {pre_market_price_datetime}")
        else:
            after_hours_price = element.text
            logging.info(f"after_hours_price: {after_hours_price}")

            element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
            after_hours_price_change_decimal = element.text
            logging.debug(f"after_hours_price_change_decimal: {after_hours_price_change_decimal}")

            element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
            after_hours_price_change_percent = element.text
            logging.debug(f"after_hours_price_change_decimal: {after_hours_price_change_percent}")

            element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
            after_hours_price_datetime = element.text
            logging.debug(f"after_hours_price_datetime: {after_hours_price_datetime}")
    else:
        after_hours_price = ""
    

    # transfer data to object that udpate_cell_in_numbers.py expects
    # Get the current time   ---- THESE SHOULD BE WRAPPED UP IN FUNCTIONS!!!
    current_time = datetime.now().time()
    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()

    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["price_change_decimal"] = price_change_decimal
    data["price_change_percent"] = price_change_percent
    data["source"] = "trading view"
    
    if not is_weekday():
        # trading view actually does not display after hours price on weekends so this isn't really needed
        data["after_hours_price"] = after_hours_price
    if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        data["pre_market_price"] = pre_market_price
    elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        data["after_hours_price"] = after_hours_price
    #data["previous_close_price"] = ""

    logging.info(data)
    return data

def process_trading_view(driver,tickers,function_handlers,sleep_interval):
    logging.info("process_trading_view")

    for i, ticker in enumerate(tickers):
        url_selection = 'trading_view'
        if url_selection in ticker:
            logging.info(f"Key {ticker['key']} has url: {ticker[url_selection]}")
        else:
            logging.debug(f"Key {url_selection} does not exist in this object.")

        if not pd.isna(ticker[url_selection]):
            logging.debug(f"Key {ticker['key']} has value: {ticker[url_selection]}")
        else:
            logging.debug(f"Key {url_selection} does not have a value or has NaN.")
            continue

        url = ticker[url_selection]
        key = ticker['key']
        logging.info(f'{url_selection} - begin processing: {key} selected url: {url}')
        
        driver.get(url)
        logging.info(f'sleep {2} seconds to allow website to load')
        time.sleep(2)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
        #logging.info(f"html_content: {html_content}")

        soup = BeautifulSoup(html_content, 'html.parser')

        element = soup.select_one('[class="last-zoF9r75I js-symbol-last"]')
        logging.debug(f'last price element: {element}')
        last_price = element.text
        logging.debug(f"last_price: {last_price}")

        element = soup.select_one('[class="change-zoF9r75I js-symbol-change-direction down-raL_9_5p"]')
        logging.debug(f'1st price change element: {element}')
        if element != None:
            logging.debug(f"children:{element.findChildren()}")
            price_change_decimal = element.findChildren()[0].text
            logging.debug(f"price_change_decimal: {price_change_decimal}")

            price_change_percent = element.findChildren()[1].text
            logging.debug(f"price_change_percent: {price_change_percent}")
        else:
            element = soup.select_one('[class="change-zoF9r75I js-symbol-change-direction up-raL_9_5p"]')
            logging.debug(f'price change element: {element}')
            if element != None:
                price_change_decimal = element.findChildren()[0].text
                logging.debug(f"price_change_decimal: {price_change_decimal}")

                price_change_percent = element.findChildren()[1].text
                logging.debug(f"price_change_percent: {price_change_percent}")

        element = soup.select_one('[class="js-symbol-lp-time"]')
        last_price_datetime = element.text
        logging.debug(f"last_price_datetime: {last_price_datetime}")

        element = soup.select_one('[class="last-zoF9r75I last-NYvR1HH2 js-symbol-ext-hrs-close"]')
        if element != None:
            pre_post_market_element = soup.select_one('[class="marketStatusPre-NYvR1HH2"]')
            if pre_post_market_element != None and pre_post_market_element.text == "Pre-market":
                pre_market_price = element.text
                logging.info(f"pre_market_price: {pre_market_price}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
                pre_market_price_change_decimal = element.text
                logging.debug(f"pre_market_price_change_decimal: {pre_market_price_change_decimal}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
                pre_market_price_change_percent = element.text
                logging.debug(f"pre_market_price_change_percent: {pre_market_price_change_percent}")

                element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
                pre_market_price_datetime = element.text
                logging.info(f"pre_market_price_datetime: {pre_market_price_datetime}")
            else:
                after_hours_price = element.text
                logging.info(f"after_hours_price: {after_hours_price}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
                after_hours_price_change_decimal = element.text
                logging.debug(f"after_hours_price_change_decimal: {after_hours_price_change_decimal}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
                after_hours_price_change_percent = element.text
                logging.debug(f"after_hours_price_change_decimal: {after_hours_price_change_percent}")

                element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
                after_hours_price_datetime = element.text
                logging.debug(f"after_hours_price_datetime: {after_hours_price_datetime}")
        else:
            after_hours_price = ""
        
        

        

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
        data["source"] = "trading view"
        if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
            data["pre_market_price"] = pre_market_price
        elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
            data["after_hours_price"] = after_hours_price
        #data["previous_close_price"] = ""

        logging.info(f"process_trading_view sending : {data}")
        function_handlers[0](data)

    return 0

