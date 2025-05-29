#!/usr/bin/env python3
import logging
import time
from bs4 import BeautifulSoup
from datetime import datetime
from update_cell_in_numbers import update_numbers
import pandas as pd
from create_html_file_path import create_html_file_path

# use monitor at investing.com 
# investing.com hsupports multiple watchlists. THe exported html will contain only the first/left watchlist on first load
# but reloading the web page after selecting another watchlist seems to load the correct html
# iCloudDrive/Script Editor/investing_com_export_html.scpt  -> saves html 

def is_number(value):
    try:
        # Attempt to convert to an integer
        int(value)
        return True
    except ValueError:
        try:
            # If integer conversion fails, attempt to convert to a float
            float(value)
            return True
        except ValueError:
            return False
        
def process_trading_view(driver,tickers,function_handlers,sleep_interval):
    logging.info("process_trading_view")

    for i, ticker in enumerate(tickers):
        url_selection = 'trading_view'
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
        logging.info(f'{url_selection} - begin processing: {key} selected url: {url}')
        
        driver.get(url)
        logging.info(f'sleep {sleep_interval} seconds to allow website to load')
        time.sleep(sleep_interval)

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
        
        logging.info(data)
        update_numbers(data)

    return 0

