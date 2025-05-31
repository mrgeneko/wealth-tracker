#!/usr/bin/env python3
from bs4 import BeautifulSoup
import logging
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from save_html_to_file import save_html_to_file

#from bs4 import BeautifulSoup
from selenium import webdriver
import time
from selenium.webdriver.common.keys import Keys

import time
from datetime import datetime
import re
import pandas as pd

def get_finance_charts_attributes():
    attributes = {
        "name" : "finance_charts",
        "process" : process_finance_charts,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def process_finance_charts(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"process_finance_charts")
    url_selection = 'finance_charts'

    for i, ticker in enumerate(tickers):
        
        if url_selection in ticker:
            logging.info(f"Key {ticker['key']} has url: {ticker[url_selection]}")
        else:
            logging.info(f"Key {url_selection} does not exist in this object.")

        if not pd.isna(ticker[url_selection]):
            logging.info(f"Key {ticker['key']} has value: {ticker[url_selection]}")
        else:
            logging.info(f"Key {url_selection} does not have a value or has NaN.")
            continue

        url = ticker[url_selection]
        key = ticker['key']
        logging.info(f'Begin processing: {ticker['key']} selected url: {url}')

        driver.get(url)
        html_content = driver.page_source
        soup = BeautifulSoup(html_content,'html.parser')

        #save_html_to_file(url,html_content)

        element = soup.select_one('[class="highlight"]')
        if element != None:
            last_price = element.text
        else:
            logging.info(f"last price element not found")
            last_price = ""
        logging.info(f"last_price: {last_price}")
        
        element = soup.select_one('[class="cb-change cb-change-d"]')
        if element != None:
            parts = element.text.split()
            price_change_decimal = parts[0]
            logging.info(f"price_change_decimal: {price_change_decimal}")
            price_change_percent = parts[1]
            logging.info(f"price_change_percent: {price_change_percent}")

        return 0
        # Extract the stock price 
        table_element = quote_section.select_one('[style="margin-top:-6px"]')
        logging.info(f"table_element : {table_element}")

        stock_price = soup.select_one('td:contains("(*)")').get_text().strip()
        logging.info(f"stock price  {stock_price}")
        # Extract the percentage change "-0.47 (0.23%)"
        percentage_change = soup.select_one('.cb-change').get_text().strip()

        quote_td = quote_section.select('td')
        logging.info(f"quote_td: {quote_td.text}")
        last_price = quote_td.text
        print(last_price)

        return 0

        driver.get(url)
        logging.info(f'sleep 3 seconds to allow website to load')
        time.sleep(3)
        
        html_content = driver.page_source

        logging.info(f"Process xpaths for {url}")
        last_price = ""
        try:
            last_price = driver.find_element(By.XPATH, '//*[@id="main"]/div[1]/div[2]/div[1]/div[1]')
            logging.info(f"last_price {last_price.text}")
            
        except Exception as e:
            logging.error(f"first xpath for last price failed")

        if last_price == "":
            try:
                
                #last_price = driver.find_element(By.XPATH,'//*/html/body/div[3]/div/div[2]/h1/table/tbody/tr/td[2]/text()[2]')
                last_price = driver.find_element(By.XPATH,'//h1[@class="mb-1 mb-sm-2 pb-2 pb-md-1 "]/table/tbody/tr/td[2]/text()[2]')
                logging.info(f"second xpath for last_price: {last_price.text}")
            except Exception as e:
                logging.info(f"second xpath for last price failed {e}")

        try:
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
            logging.info(f"xpath for price_changes failed: {e}")

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
                "source": "financecharts.com",
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
               

        
        logging.info(f"result: {data}")
        function_handlers[0](data)

    return 0
