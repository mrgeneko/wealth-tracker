#!/usr/bin/env python3
import os
import logging
from bs4 import BeautifulSoup
import time
import datetime
from subprocess import run, CalledProcessError,  CompletedProcess
import pandas as pd
from is_number import is_number

#from selenium.webdriver.support.wait import WebDriverWait
#from selenium.webdriver.support import expected_conditions as EC

def get_moomoo_attributes():
    attributes = {
        "name" : "moomoo",
        "download" : "selenium",
        "process" : process_moomoo,
        "extract" : extract_moomoo,
        "has_realtime" : True, 
        "has_pre_market" : True,
        "has_after_hours" : True, # True only for stocks, not for ETFs
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes


def process_moomoo(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"load_url_moomoo")
    obsolete='''
    url_selection = 'moomoo'
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
        
        if driver != None:
            driver.get(url)
            #logging.info(f'sleep 3 seconds to allow website to load')
            time.sleep(2)
            html_content = driver.page_source
        else:
            logging.info(f"mode SINGLEFILE")
            # let's use singlefile command to retrieve html
            # Generate timestamp in YYYYMMDD_HHMMSS format
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

            # Get the full path to your directory (this is the key fix)
            directory = os.path.expanduser('~/investing_com_html')  # Expands ~ to full path
            if not os.path.exists(directory):
                os.makedirs(directory)  # Create directory if it doesn't exist

            #output_file = f"~/investing_com_html/{ticker['key']}_{url_selection}.{timestamp}.html"
            filename = os.path.join(directory, f"{ticker['key']}.moomoo.{timestamp}.html")

            # Define the command and its arguments
            #command = ["docker", "run", "--rm", "singlefile"]
            command = ["/Users/chewie/bin/html_to_singlefile.sh"]
            args = [key, url_selection, timestamp, url]

            
            try:
                # Execute the command and redirect output to the file
                logging.info(f"run save_html_to_singlefile.sh command")
                result = run(
                    [*command, *args],
                    #stdout=open(filename, "w", encoding="utf-8"),
                    check=True
                )
                logging.info(f"done singlefile command")
            except CalledProcessError as e:
                print(f"Error occurred while running the command: {e}")

            #time.sleep(3)
            logging.info(f"now writing html file")
            try:
                with open(filename, 'r', encoding='utf-8') as file:
                    html_content = file.read()
            except FileNotFoundError:
                logging.error(f"Error: File not found {filename}")
                return 1
            except UnicodeDecodeError:
                logging.error(f"Error: Could not decode the {filename} file with UTF-8 encoding")
                return 1

        extract_moomoo(key,url,html_content,function_handlers)
'''

def extract_moomoo(ticker,html_content):
    logging.info(f"extract moomoo")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')
    quote_element = soup.select_one('[class="flex-end stock-data"]')
    price_normal_element = quote_element.select_one('[class="price-normal"]')
    last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-up"]')
    if last_price_element == None:
        last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-down"]')
    if last_price_element != None:
        last_price = last_price_element.text.strip()
        logging.info(f'last price element: {last_price}')
    newline_index = last_price.find('\n')
    if newline_index != -1:
        last_price = last_price[:newline_index]


    logging.info(f"check for after_hours_price")   
    after_hours_price = ""
    pre_market_price = ""
    after_hours_section = quote_element.select_one('[class="disc-info"]')
    if after_hours_section == None:
        logging.info(f"could not find after hours section")
    
    after_hours_price_element = None
    if after_hours_section != None:
        logging.info(f"look for after hours up")
        after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-up"]')
        if after_hours_price_element == None:
            logging.info(f"look for after hours down")
            after_hours_price_element = after_hours_section.select_one('[class="mg-r-8 disc-price direct-down"]')

    after_hours_datetime = ""
    if after_hours_price_element != None:
        after_hours_price_string = after_hours_price_element.text.strip()
        #plus_index = after_hours_price_string.find('+')
        #plus_index = after_hours_price_string.find('+')
        max_pos = len(after_hours_price_string) 
        token_index = next((idx for char in ('+', '-') if (idx := after_hours_price_string.find(char, 0, max_pos)) != -1), -1)
        if token_index != -1:
            after_hours_price = after_hours_price_string[:token_index]
        else:
            after_hours_price = after_hours_price_string


        after_hours_datetime_element = after_hours_section.select_one('[class="status"]')
        logging.info(f"after_hours_datetime_element: {after_hours_datetime_element.text}")
        parts = after_hours_datetime_element.text.split()

        if parts[0] == "Post":
            logging.info(f"Found post session price")
        else:
            logging.info(f"Found pre market session price??")
            pre_market_price = after_hours_price
            after_hours_price = ""

    else:
        logging.info(f"could not find after hours price")
    logging.info(f"after_hours_price: {after_hours_price}")


    data = {}
    data["key"] = ticker
    data["last_price"] = last_price
    data["after_hours_price"] = after_hours_price
    data["pre_market_price"] = pre_market_price
    data["source"] = "moomoo"
    #if current_time < market_open_time and current_time > pre_market_open_time and is_number(pre_market_price):
    #    data["pre_market_price"] = pre_market_price
    #elif (current_time > market_close_time or current_time < pre_market_open_time) and is_number(after_hours_price):
    #    data["after_hours_price"] = after_hours_price
    
    logging.info(data)
    return data
