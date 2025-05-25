#!/usr/bin/env python3
from datetime import datetime
import os
import argparse
import logging
import json
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
import time
import re
import pandas as pd
from update_cell_in_numbers import update_numbers
from process_yfinance import process_yfinance
from process_google_finance import process_google_finance
#from process_fintel import process_fintel
from process_stock_analysis import process_stock_analysis

def get_tickers_and_urls_from_csv(file_path, include_type=None):
    logging.info(f'get_tickers_and_urls_from_csv: {file_path}')
    
    try:
        # Read the CSV file into a DataFrame
        df = pd.read_csv(file_path)

    except Exception as e:
        logging.error(f"Error opening file {file_path}: {e}")
        exit(1)

    data_objects = df.to_dict(orient='records')
    logging.info(f"include_type: {include_type}")
    if include_type == "bonds":
        # change this to compare against include_type instead of hardcoded 'bond'
        bond_data_objects = [obj for obj in data_objects if obj.get('type') == 'bond'] 
        # Print the array of data objects
        for obj in bond_data_objects:
            print(obj)        
        return bond_data_objects
    if include_type == "stocks":
        stock_data_objects = [obj for obj in data_objects if obj.get('type') != 'bond']
        # Print the array of data objects
        for obj in stock_data_objects:
            print(obj)        
        return stock_data_objects
    
    # Print the array of data objects
    for obj in data_objects:
        print(obj)
    return data_objects
    

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


def process_investingcom(tickers,function_handlers,sleep_interval):
# https://www.repeato.app/reusing-browser-sessions-in-selenium-webdriver/
# I should reuse the driver across multiple pages

    logging.info(f'Creating Chrome Service')
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--headless")  # Run in headless mode
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service,options=chrome_options)

    for i, ticker in enumerate(tickers):
        url_selection = 'investing'
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
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
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

        logging.info(f'sleep {sleep_interval} seconds before next item')
        time.sleep(sleep_interval)

    driver.quit()

    return 0

def process_webull(tickers,function_handlers,sleep_interval):

    logging.info(f'Creating Chrome Service')
    chrome_options = webdriver.ChromeOptions()
    chrome_options.add_argument("--headless")  # Run in headless mode
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service,options=chrome_options)

    for i, ticker in enumerate(tickers):
        url_selection = 'webull'
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
        logging.info(f'\n\nBegin processing: {key} selected url: {url}')
        
        driver.get(url)
        logging.info(f'sleep 5 seconds to allow website to load')
        time.sleep(5)

        logging.info(f"Website URL: {url}")
        if not url:
            logging.error("No URL provided. Exiting.")
            continue
    
        driver.get(url)
        logging.info(f'sleep 5 seconds to allow website to load')
        time.sleep(5)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        #html_content = driver.page_source

        # Base path for logs
        #base_path = '/Users/gene/logs'
        # Create log file path
        ##html_file_path = create_html_file_path(base_path, website)
        #logging.info(f"save html to: {html_file_path}")
        #with open(html_file_path, "w") as f:
        #    f.write(html_content)

        try:
            logging.info(f"Process xpaths for {url}")
            if "bond" in url:
                logging.info(f"Process bond quote page: {url}")

                description = driver.find_element(By.CLASS_NAME, 'csr124')
                #logging.info(f"description {description.text}")

                cusip = driver.find_element(By.CLASS_NAME, 'csr125')
                #logging.info(f"cusip {cusip.text}")

                last_price = driver.find_element(By.CLASS_NAME, 'csr112')
                #logging.info(f"last_price {last_price.text}")

                try:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
                except Exception as e:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][1]")
                #logging.info(f"price_change_decimal {price_change_decimal.text}")

                try:
                    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
                except Exception as e:
                    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][2]")
                #logging.info(f"price_change_percent {price_change_percent.text}")

                price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
                #logging.info(f"price_datetime {price_datetime.text}")

                bond_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
                #logging.info(f"bond_yield {bond_yield.text}")

                high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
                #logging.info(f"high_price {high_price.text}")

                low_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
                #logging.info(f"low_price {low_price.text}")

                open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[2]/DIV[2]')
                #logging.info(f"open_price {open_price.text}")

                coupon_rate = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[1]/DIV[2]')
                #logging.info(f"coupon_rate {coupon_rate.text}")

                maturity = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[2]/DIV[2]')
                #logging.info(f"maturity {maturity.text}")

                prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[1]/DIV[2]')
                #logging.info(f"prev_close_price {prev_close_price.text}")

                coupon_frequency = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[2]/DIV[2]')
                #logging.info(f"coupon_frequency {coupon_frequency.text}")

                next_coupon_date = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[1]/DIV[2]')
                #logging.info(f"next_coupon_date {next_coupon_date.text}")

                accrued_interest = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
                #logging.info(f"accrued_interest {accrued_interest.text}")
                
                data = {
                    "key": key,
                    "url": url,
                    "source":"webull.com",
                    "description": description.text,
                    "cusip": cusip.text,
                    "last_price": last_price.text,
                    "price_change_decimal": price_change_decimal.text,
                    "price_change_percent": price_change_percent.text,
                    "price_datetime": price_datetime.text,
                    "bond_yield": bond_yield.text,
                    "high_price": high_price.text,
                    "low_price": low_price.text,
                    "open_price": open_price.text,
                    "coupon_rate": coupon_rate.text,
                    "maturity": maturity.text,
                    "prev_close_price": prev_close_price.text,
                    "coupon_frequency": coupon_frequency.text,
                    "next_coupon_date": next_coupon_date.text,
                    "accrued_interest": accrued_interest.text
                }
                
            else:
                logging.info(f"Process stock quote page: {url}")
                
                ticker = driver.find_element(By.XPATH, '//div[@class="csr109"]/p[1]')
                logging.debug(f"ticker by.xpath {ticker.text}")

                description = driver.find_element(By.CLASS_NAME, 'csr127')
                logging.debug(f"description {description.text}")

                exchange = driver.find_element(By.CLASS_NAME, 'csr128')
                logging.debug(f"exchange {exchange.text}")

                last_price = driver.find_element(By.CLASS_NAME, 'csr112')
                logging.debug(f"last_price {last_price.text}")

                try:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
                    logging.debug(f"price_change_decimal {price_change_decimal.text}")
                except Exception as e:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][1]")
                    logging.debug(f"price_change_decimal {price_change_decimal.text}")

                try:
                    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
                    logging.debug(f"price_change_percent {price_change_percent.text}")
                except Exception as e:
                    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][2]")
                    logging.debug(f"price_change_percent {price_change_percent.text}")

                price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
                logging.debug(f"price_datetime {price_datetime.text}")

                after_hours_price_string = ""
                after_hours_price = ""
                after_hours_price_change_decimal = ""
                after_hours_price_change_percent = ""
                pre_market_price_string = ""
                pre_market_price = ""
                pre_market_price_change_decimal = ""
                pre_market_price_change_percent = ""
                if "After Hours" in price_datetime.text:
                    try:
                        after_hours_price_string = driver.find_element(By.XPATH, "//div[contains(@class, 'csr132')]/div[contains(@class, 'csr132')]/span[1]")
                        after_hours_price = after_hours_price_string.text.split(" ")[0]
                        logging.debug(f"after_hours_price_string {after_hours_price_string.text}")
                        after_hours_price_change_decimal = after_hours_price_string.text.split(" ")[1]
                        logging.debug(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
                        after_hours_price_change_percent = after_hours_price_string.text.split(" ")[2]
                        logging.debug(f"after_hours_price_change_percent {after_hours_price_change_percent}")
                    except Exception as e:
                        logging.debug(f"after_hours_price not found: {e}")
                elif "Pre Market" in price_datetime.text:
                    try:
                        logging.info(f'looking for pre market prices')
                        pre_market_price_string = driver.find_element(By.XPATH, "//div[contains(@class, 'csr132')]/div[contains(@class, 'csr132')]/span[1]")
                        pre_market_price = pre_market_price_string.text.split(" ")[0]
                        logging.info(f"pre_market_price_string {pre_market_price_string.text}")
                        pre_market_price_change_decimal = pre_market_price_string.text.split(" ")[1]
                        logging.info(f"pre_market_price_change_decimal {pre_market_price_change_decimal}")
                        pre_market_price_change_percent = pre_market_price_string.text.split(" ")[2]
                        logging.info(f"pre_market_price_change_percent {pre_market_price_change_percent}")
                    except Exception as e:
                        logging.info(f"pre_market price not found: {e}")
                else:
                    logging.debug(f"After Hours/Pre Market not found")

                
                logging.debug(f"after_hours_price {after_hours_price}")
                logging.debug(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
                logging.debug(f"after_hours_price_change_percent {after_hours_price_change_percent}")    

                open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
                logging.debug(f"open_price {open_price.text}")

                prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
                logging.debug(f"prev_close_price {prev_close_price.text}")

                high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
                logging.debug(f"high_price {high_price.text}")

                low_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[2]/DIV[2]')
                logging.debug(f"low_price {low_price.text}")

                volume = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[1]/DIV[2]')
                logging.debug(f"volume {volume.text}")

                turnover = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[2]/DIV[2]')
                logging.debug(f"turnover {turnover.text}")

                fiftytwo_week_high = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[1]/DIV[2]')
                logging.debug(f"fiftytwo_week_high {fiftytwo_week_high.text}")

                fiftytwo_week_low = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[2]/DIV[2]')
                logging.debug(f"fiftytwo_week_low {fiftytwo_week_low.text}")

                market_cap = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[1]/DIV[2]')
                logging.debug(f"market_cap {market_cap.text}")

                label = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[1]')
                logging.debug(f"label {label.text}")
                
                if "YTD YIELD" in label.text:
                    logging.debug("YTD Yield.")
                    ytd_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
                    logging.debug(f"ytd_yield {ytd_yield.text}")
                    price_to_earnings_ttm = ""
                else:
                    logging.debug("PE Ratio.")
                    price_to_earnings_ttm = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
                    logging.debug(f"price_to_earnings_ttm {price_to_earnings_ttm.text}")
                    ytd_yield = ""
                    
                data = {
                    "key": key,
                    "url": url,
                    "source":"webull.com",
                    "ticker": ticker.text,
                    "description": description.text,
                    "exchange": exchange.text,
                    "last_price": last_price.text,
                    "price_change_decimal": price_change_decimal.text,
                    "price_change_percent": price_change_percent.text,
                    "price_datetime": price_datetime.text,
                    "after_hours_price": after_hours_price,
                    "after_hours_price_change_decimal": after_hours_price_change_decimal,
                    "after_hours_price_change_percent": after_hours_price_change_percent,
                    "pre_market_price": pre_market_price,
                    "pre_market_price_change_decimal": pre_market_price_change_decimal,
                    "pre_market_price_change_percent": pre_market_price_change_percent,
                    "open_price": open_price.text,
                    "prev_close_price": prev_close_price.text,
                    "high_price": high_price.text,
                    "low_price": low_price.text,
                    "volume": volume.text,
                    "turnover": turnover.text,
                    "fiftytwo_week_high": fiftytwo_week_high.text,
                    "fiftytwo_week_low": fiftytwo_week_low.text,
                    "market_cap": market_cap.text,
                    "ytd_yield": ytd_yield.text if ytd_yield else "",
                    "price_to_earnings_ttm": price_to_earnings_ttm.text if price_to_earnings_ttm else "" 
                }
        except Exception as e:
            logging.error('Exception processing xpath. will quit driver')
        
        logging.info(f"result: {data}")
        function_handlers[0](data)
        
        logging.info(f'sleep {sleep_interval} seconds before next item')
        time.sleep(sleep_interval)  # Sleep for the specified interval

    driver.quit()

    return 0
        
def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def main():

    parser = argparse.ArgumentParser(description='scrape a list of websites for a list of fields.')

    parser.add_argument('--input-file', '-i', dest='input_file',
                        type=str,
                        default="scrapeman.csv",
                        help='Path to the input file (default: scrapeman.csv)')
    
    parser.add_argument('--include-type', '-t', dest='include_type', type=str,
                        choices=['stocks', 'bonds'], default='stocks',
                        help='Specify "stocks" to exclude bonds or "bonds" to include only bond lines')
    
    parser.add_argument('--sleep-interval', '-z', dest='sleep_interval',
                    type=int, default=15,
                    help='Seconds to sleep between processing each ticker (default: 15)')
    
    parser.add_argument('--browser', '-d', dest='browser',
                    default='chrome',
                    help='web browser [chrome|safari] (default: chrome)')
    
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')

    parser.add_argument('--source', '-s', dest='source',
                    default='yahoo',
                    help='web site source [google|investing|stock_analysis|webull|yahoo] (default: yahoo')

    args = parser.parse_args()
    setup_logging(args.log_level)
   
    input_file = args.input_file
    tickers = get_tickers_and_urls_from_csv(input_file, args.include_type)
    browser = args.browser
    url_selection=args.source
    sleep_interval = args.sleep_interval

    # Give the user a chance to review tickers
    logging.info(f'sleep 5 seconds')
    time.sleep(2)

    function_handlers = [update_numbers]

    if url_selection == "webull":
        result = process_webull(tickers,function_handlers,sleep_interval)
    elif url_selection == "investing":
        result = process_investingcom(tickers,function_handlers,sleep_interval)
    elif url_selection == "yahoo":
        result = process_yfinance(tickers,function_handlers,sleep_interval)
    elif url_selection == "google":
        result = process_google_finance(tickers,function_handlers,sleep_interval)
    #elif url_selection == "fintel":
    #    result = process_fintel(tickers,function_handlers,sleep_interval)
    elif url_selection == "stock_analysis":
        result = process_stock_analysis(tickers,function_handlers,sleep_interval)
    exit(0)

if __name__ == "__main__":
    main()
