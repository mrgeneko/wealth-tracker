#!/usr/bin/env python3
 
import logging
import time
import pandas as pd
from selenium.webdriver.common.by import By
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

def get_investing_attributes():
    attributes = {
        "name" : "investing",
        "process" : process_investing,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def process_investing(driver,tickers,function_handlers,sleep_interval):

    url_selection = 'investing'

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
        logging.info(f'Investing - begin processing: {ticker['key']} selected url: {url}')

        driver.get(url)
        logging.info(f'wait 6 seconds to allow website to load')
        time.sleep(3)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        #html_content = driver.page_source

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
            last_price = driver.find_element(By.XPATH, '//*[@data-test="instrument-price-last"]')
            logging.debug(f"last_price {last_price.text}")

            price_change_decimal = driver.find_element(By.XPATH, '//*[@data-test="instrument-price-change"]')
            logging.debug(f"price_change_decimal {price_change_decimal.text}")
            try:
                #price_change_percent = driver.find_element(By.XPATH, '//*/html/body/div/div[2]/div[2]/div[2]/div/div/div[3]/div/div/div[2]/span[2]/text()[2]')
                #price_change_percent = driver.find_element(By.XPATH, '//*/span[contains(@data-test, "instrument-price-change-percent")]/text()[2]')
                price_change_percent = driver.find_element(By.XPATH, '//*/span[contains(@data-test, "instrument-price-change-percent")]')
                logging.info(f"price_change_percent {price_change_percent.text}")
            except Exception as e:
                logging.error(f'find element price_change_percent by xpath. {e}')

            try:
                after_hours_price = driver.find_element(By.XPATH, "//span[contains(@class, 'text-[#232526]')]")
                logging.info(f"after_hours_price {after_hours_price.text}")
                #after_hours_price_change_decimal = after_hours_price_string.text.split(" ")[1]
                #logging.debug(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
                #after_hours_price_change_percent = after_hours_price_string.text.split(" ")[2]
                #logging.debug(f"after_hours_price_change_percent {after_hours_price_change_percent}")
            except Exception as e:
                logging.info(f"after_hours_price not found: {e}")
                after_hours_price = ""
                        
            price_datetime = driver.find_element(By.XPATH, '//*[@data-test="trading-time-label"]')
            logging.debug(f"price_datetime {price_datetime.text}")
            try:
                data = {
                    "key": ticker['key'],
                    "url": ticker[url_selection],
                    "source": "investing.com",
                    #"ticker": "",#ticker.text,
                    #"description": "",#description.text,
                    #"exchange": "",#exchange.text,
                    "last_price": last_price.text,
                    "after_hours_price" : after_hours_price.text,
                    "price_change_decimal": price_change_decimal.text,
                    "price_change_percent": price_change_percent.text,
                    "price_datetime": price_datetime.text
                }
            except Exception as e: 
                logging.error(f"Error creating data dictionary: {e}")
               
        except Exception as e:
            logging.error(f"Error processing xpaths: {e}")
        
        logging.info(f"result: {data}")
        function_handlers[0](data)

    return 0
