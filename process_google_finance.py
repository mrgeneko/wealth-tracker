#!/usr/bin/env python3
import logging
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import NoSuchElementException, TimeoutException, WebDriverException
import time
import pandas as pd

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
        ticker['key']
        logging.info(f'\n\nBegin processing: {ticker['key']} selected url: {url}')

        driver.get(url)
        logging.info(f'sleep 5 seconds to allow website to load')
        time.sleep(5)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        # THIS DOESN"T SEEM TO HELP
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.TAG_NAME, 'title')))
        #logging.info("waiting over")
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
            comment1='''
            ticker = driver.find_element(By.XPATH, '//div[@class="csr109"]/p[1]')
            logging.debug(f"ticker by.xpath {ticker.text}")

            description = driver.find_element(By.CLASS_NAME, 'csr127')
            logging.debug(f"description {description.text}")

            exchange = driver.find_element(By.CLASS_NAME, 'csr128')
            logging.debug(f"exchange {exchange.text}")
    '''
            last_price = driver.find_element(By.XPATH, '//*/div[@class="YMlKec fxKbKc"]')

            logging.debug(f"last_price {last_price.text}")

            element = driver.find_element(By.XPATH, '//*/span[@class="P2Luy Ebnabc ZYVHBb"]')
            price_change_decimal_str = element.text
            parts = price_change_decimal_str.split()
            price_change_decimal = parts[0]
            logging.debug(f"price_change_decimal {price_change_decimal}") 
                        
            price_datetime = driver.find_element(By.XPATH, '//*/div[@class="ygUjEc"]')
            logging.debug(f"price_datetime {price_datetime.text}")

            #price_change_percent = driver.find_element(By.XPATH, '//*/div[@class="JwB6zf"]')
            #price_change_percent = driver.find_element(By.XPATH,
            #    '//*[@id="yDmH0d"]/c-wiz[3]/div/div[4]/div/main/div[2]/div[1]/c-wiz/div/div[1]/div/div[1]/div/div[2]/div/span[1]/div/div')
            #/html/body/c-wiz[3]/div/div[4]/div/main/div[2]/div[1]/c-wiz/div/div[1]/div/div[1]/div/div[2]/div/span[1]/div/div/text()
            #logging.info(f"price_change_percent {price_change_percent.text}")  
            #//*[@id="yDmH0d"]/c-wiz[3]/div/div[4]/div/main/div[2]/div[1]/c-wiz/div/div[1]/div/div[1]/div/div[2]/div/span[1]/div/div
            title_text = driver.find_element(By.TAG_NAME,'title')
            logging.info(f"title: {title_text.text}")
            try:
                data = {
                    "key": ticker['key'],
                    "url": ticker[url_selection],
                    "source": "google.com/finance",
                    #"ticker": "",#ticker.text,
                    #"description": "",#description.text,
                    #"exchange": "",#exchange.text,
                    "last_price": last_price.text,
                    #"after_hours_price" : after_hours_price.text,
                    "price_change_decimal": price_change_decimal,
                    #"price_change_percent": price_change_percent.text,
                    "price_datetime": price_datetime.text
                }
            except Exception as e: 
                logging.error(f"Error creating data dictionary: {e}")
                continue
               
        except Exception as e:
            logging.error(f"Error processing xpaths: {e}")
            continue
        
        logging.info(f"result: {data}")
        function_handlers[0](data)

    return 0
