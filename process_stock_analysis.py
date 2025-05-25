#!/usr/bin/env python3
import os
import logging
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
#from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
#from selenium.common.exceptions import NoSuchElementException, TimeoutException, WebDriverException

#from bs4 import BeautifulSoup
from selenium import webdriver
import time
from selenium.webdriver.common.keys import Keys

import time
from datetime import datetime
import re
import pandas as pd

# Function to create log file path
def create_html_file_path(base_path, url):
    # Extract relevant parts from the URL
    parsed_url = re.sub(r'https?://', '', url)  # Remove http/https and slashes
    cleaned_url = re.sub(r'[:/]+', '_', parsed_url)  # Replace colons and slashes with underscores

    # Generate timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

    # Construct log file path
    log_file_path = os.path.join(base_path, f'{cleaned_url}_{timestamp}.html')
    
    return log_file_path

def process_stock_analysis(tickers,function_handlers,sleep_interval):
    logging.debug(f'Creating Chrome Service')
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--headless")  # Run in headless mode
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service,options=chrome_options)

    for i, ticker in enumerate(tickers):
        url_selection = 'finance_charts'
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
    
        ticker['key']
        logging.info(f'\n\nBegin processing: {ticker['key']} selected url: {url}')

        driver.get(url)
        logging.info(f'sleep 3 seconds to allow website to load')
        time.sleep(5)
        
        
        #html_content = driver.page_source

        # Base path for logs
        #base_path = '/Users/gene/logs'
        # Create log file path
        #html_file_path = create_html_file_path(base_path, url)
        #logging.info(f"save html to: {html_file_path}")
        #with open(html_file_path, "w") as f:
        #    f.write(html_content)

        try:
            logging.info(f"Process xpaths for {url}")
            
            try:
                last_price = driver.find_element(By.XPATH, '//*[@id="main"]/div[1]/div[2]/div[1]/div[1]')
                logging.info(f"last_price {last_price.text}")
                
                price_change_text = driver.find_element(By.XPATH, '//*[@id="main"]/div[1]/div[2]/div[1]/div[2]')
                logging.info(f"price_change_text {price_change_text.text}")
                parts = price_change_text.text.split()
                price_change_decimal = parts[0]
                price_change_percent = parts[1]
                logging.info(f"price_change_decimal: {price_change_decimal}")
                logging.info(f"price_change_percent: {price_change_percent}")
                price_datetime_element = driver.find_element(By.XPATH,'//*[@id="main"]/div[1]/div[2]/div[1]/div[3]')
                logging.info(f"last price datetime: {price_datetime_element.text}")
                price_datetime = price_datetime_element.text
            except Exception as e:
                logging.error(f"unable to find last price")
                continue

            try:
                after_hours_price_element = driver.find_element(By.XPATH, '//*[@id="main"]/div[1]/div[2]/div[2]/div[1]')
                logging.info(f"after_hours_price: {after_hours_price_element.text}")
                after_hours_price = after_hours_price_element.text
                after_hours_change_text = driver.find_element(By.XPATH,'//*[@id="main"]/div[1]/div[2]/div[2]/div[2]')
                parts = after_hours_change_text.text.split()
                after_hours_change_decimal = parts[0]
                logging.info(f"after_hours_change_decimal: {after_hours_change_decimal}")
                after_hours_change_percent = parts[1]
                logging.info(f"after_hours_change_percent: {after_hours_change_percent}")
                after_hours_datetime_element = driver.find_element(By.XPATH,'//*[@id="main"]/div[1]/div[2]/div[2]/div[3]/span[2]')
                logging.info(f"after_hours_datetime: {after_hours_datetime_element.text}")
                after_hours_datetime = after_hours_datetime_element.text
            except Exception as e:
                logging.error(f"error finding after hours pricing {e}")
                after_hours_price = ""
                after_hours_change_decimal = ""
                after_hours_change_percent = ""
                after_hours_datetime = ""


            try:
                data = {
                    "key": ticker['key'],
                    "url": ticker[url_selection],
                    "source": "stock_analysis.com",
                    #"ticker": "",#ticker.text,
                    #"description": "",#description.text,
                    #"exchange": "",#exchange.text,
                    "last_price": last_price.text,
                    "price_change_decimal": price_change_decimal,
                    "price_change_percent": price_change_percent,
                    "price_datetime": price_datetime,
                    "after_hours_price" : after_hours_price,
                    "after_hours_change_decimal" : after_hours_change_decimal,
                    "after_hours_change_percent" : after_hours_change_percent,
                    "after_hours_datetime" : after_hours_datetime
                }
            except Exception as e: 
                logging.error(f"Error creating data dictionary: {e}")
                continue
               
        except Exception as e:
            logging.error(f"Error processing xpaths: {e}")
            continue
        
        logging.info(f"result: {data}")
        function_handlers[0](data)

        logging.info(f'sleep {sleep_interval} seconds before next item')
        time.sleep(sleep_interval)

    driver.quit()

    return 0
