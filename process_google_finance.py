#!/usr/bin/env python3
import logging
from bs4 import BeautifulSoup
import time
from datetime import datetime
import pandas as pd
#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def process_google_finance(driver,tickers,function_handlers,sleep_interval):

    url_selection = 'google'
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
        logging.info(f'\n\nBegin processing: {ticker['key']} selected url: {url}')

        driver.get(url)
        logging.info(f'sleep 3 seconds to allow website to load')
        time.sleep(3)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        html_content = driver.page_source
    
        #logging.info(f"html_content: {html_content}")

        # Base path for logs
        #base_path = '/Users/gene/logs'
        # Create log file path
        #html_file_path = create_html_file_path(base_path, url)
        #logging.info(f"save html to: {html_file_path}")
        #with open(html_file_path, "w") as f:
        #    f.write(html_content)

        soup = BeautifulSoup(html_content, 'html.parser')
        main_element = element = soup.select_one('[class="Gfxi4"]')
        main_element.select_one('[class="YMlKec fxKbKc"]')
        element = main_element.select_one('[class="YMlKec fxKbKc"]')
        #logging.info(f'last price element: {element}')
        last_price = element.text
        if last_price.startswith("$"):
            last_price = last_price[1:]
        logging.info(f"last_price: {last_price}")

        element = main_element.select_one('[class="P2Luy Ez2Ioe ZYVHBb"]')
        logging.debug(f'price change element: {element}')
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
            logging.debug(f"price_change element: {element.text}")
            price_change_percent = price_change_sign + element.text
            logging.debug(f"price_change_percent: {price_change_percent}")


        element = main_element.select_one('[class="ygUjEc"]')
        last_price_datetime = element.text.split()[:5]
        logging.debug(f"last_price_datetime: {last_price_datetime}")

        comment='''
        element = soup.select_one('[class="last-zoF9r75I last-NYvR1HH2 js-symbol-ext-hrs-close"]')
        if element != None:
            pre_post_market_element = soup.select_one('[class="marketStatusPre-NYvR1HH2"]')
            if pre_post_market_element.text == "Pre-market":
                pre_market_price = element.text
                logging.info(f"pre_market_price: {pre_market_price}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
                pre_market_price_change_decimal = element.text
                logging.info(f"pre_market_price_change_decimal: {pre_market_price_change_decimal}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
                pre_market_price_change_percent = element.text
                logging.info(f"pre_market_price_change_percent: {pre_market_price_change_percent}")

                element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
                pre_market_price_datetime = element.text
                logging.info(f"pre_market_price_datetime: {pre_market_price_datetime}")
            else:
                after_hours_price = element.text
                logging.info(f"after_hours_price: {after_hours_price}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change"]')
                after_hours_price_change_decimal = element.text
                logging.info(f"after_hours_price_change_decimal: {after_hours_price_change_decimal}")

                element = soup.select_one('[class="js-symbol-ext-hrs-change-pt"]')
                after_hours_price_change_percent = element.text
                logging.info(f"after_hours_price_change_decimal: {after_hours_price_change_percent}")

                element = soup.select_one('[class="js-symbol-rtc-time textDimmed-zoF9r75I"]')
                after_hours_price_datetime = element.text
                logging.info(f"after_hours_price_datetime: {after_hours_price_datetime}")
        else:
            after_hours_price = ""
        
        '''

        

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
        data["source"] = "google finance"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
        #    data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        function_handlers[0](data)
    return 0
