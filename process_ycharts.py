#!/usr/bin/env python3
import logging
import time
from bs4 import BeautifulSoup
from datetime import datetime
from update_cell_in_numbers import update_numbers
import pandas as pd
from save_html_to_file import save_html_to_file
from is_number import is_number

# use monitor at investing.com 
# investing.com hsupports multiple watchlists. THe exported html will contain only the first/left watchlist on first load
# but reloading the web page after selecting another watchlist seems to load the correct html
# iCloudDrive/Script Editor/investing_com_export_html.scpt  -> saves html 

        
def process_ycharts(driver,tickers,function_handlers,sleep_interval):
    logging.info("process_ycharts")

    for i, ticker in enumerate(tickers):
        url_selection = 'ycharts'
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

        soup = BeautifulSoup(html_content, 'html.parser')

        element = soup.select_one('[class="index-rank-value"]')
        logging.info(f'last price element: {element}')
        last_price = element.text
        logging.info(f"last_price: {last_price}")

        price_change_parent_element = soup.select_one('[class="index-change index-change-up"]')
        price_change_parent_element = soup.select_one('[class="index-change index-change-down"]')
        if price_change_parent_element != None:
            # Find all elements with class "valNeg"
            val_neg_elements = price_change_parent_element.find_all('span', class_='valNeg')
            logging.info(f"val neg {val_neg_elements[0].text} {val_neg_elements[1].text}")
            price_change_decimal = val_neg_elements[0].text
            logging.info(f"price_change_decimal: {price_change_decimal}")
            price_change_percent = val_neg_elements[1].text
            logging.info(f"price_change_percent: {price_change_percent}")
        else:
            price_change_parent_element = soup.select_one('[class="index-change index-change-up"]')
            val_pos_elements = price_change_parent_element.find_all('span', class_='valPos')
            logging.info(f"val pos {val_pos_elements[0].text} {val_pos_elements[1].text}")
            price_change_decimal = val_pos_elements[0].text
            logging.info(f"price_change_decimal: {price_change_decimal}")
            price_change_percent = val_pos_elements[1].text
            logging.info(f"price_change_percent: {price_change_percent}")

        element = soup.select_one('[class="index-info"]')
        parta = element.get_text().split('|')[2]
        #logging.info(f"date segment: {parta.strip()}")
        partb = parta.split()
        #logging.info(f"partb: {partb}")
        last_price_datetime = partb[0] + ' ' + partb[1] + ' ' + partb[2]
        logging.info(f"last_price_datetime: {last_price_datetime}")
        
        

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
        data["source"] = "ycharts"
        #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
        #    data["pre_market_price"] = pre_market_price
        ##elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
         #   data["after_hours_price"] = after_hours_price
        
        logging.info(data)
        update_numbers(data)

    return 0

