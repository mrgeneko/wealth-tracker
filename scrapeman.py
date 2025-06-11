#!/usr/bin/env python3

import argparse
import logging
import subprocess
from selenium import webdriver
from selenium.common.exceptions import WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By

from selenium.webdriver.safari.service import Service as SafariService

from selenium.webdriver.firefox.options import Options as FirefoxOptions
#from selenium.webdriver.firefox.service import Service as FirefoxService

import time
import pandas as pd
from update_cell_in_numbers import update_numbers
from process_yahoo import process_yahoo
from process_yahoo import process_yahoo_with_tickers_from_numbers
from process_yahoo import get_yahoo_attributes
from process_google import process_google
from process_google import get_google_attributes
#from process_finance_charts import process_finance_charts
from process_trading_view import process_trading_view
from process_trading_view import get_trading_view_attributes
from process_ycharts import process_ycharts
from process_ycharts import get_ycharts_attributes
from process_investing import process_investing
from process_webull import process_webull
from process_webull import get_webull_attributes
from process_nasdaq import process_nasdaq
from process_nasdaq import get_nasdaq_attributes
from process_marketbeat import get_marketbeat_attributes
from process_marketbeat import process_marketbeat
from process_moomoo import *
from process_cnbc import *
from session_times import *
import random

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
        bond_data_objects = [obj for obj in data_objects if obj.get('type') == 'bond' and not obj.get('key').startswith("#")] 
        # Print the array of data objects
        #for obj in bond_data_objects:
        #    print(obj)        
        return bond_data_objects
    if include_type == "stocks":
        stock_data_objects = [obj for obj in data_objects if obj.get('type') != 'bond' and not obj.get('key').startswith("#")]
        # Print the array of data objects
        #or obj in stock_data_objects:
        #    print(obj)        
        return stock_data_objects
    
    # Print the array of data objects
    #for obj in data_objects:
    #    print(obj)
    return data_objects

        
def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def process_round_robin(driver, tickers, sources, function_handlers, sleep_interval):
    logging.info(f"process round-robin")
    num_sources=len(sources)
    current = random.randint(0, (num_sources-1))

    for i, ticker in enumerate(tickers):
        logging.info("\n\n")
        logging.info(f"KEY: {ticker['key']}")
        selected = -1
        first_checked = current
        while selected == -1:
            logging.debug(f"is_weekday: {is_weekday()} is_pre_market: {is_pre_market_session()} is_regular_trading:{is_regular_trading_session()} is_after_hours:{is_after_hours_session()}")
            logging.debug(f"{sources[current]['name']} pre:{sources[current]['has_pre_market']} ah:{sources[current]['has_after_hours']}")

            if sources[current]['name'] in ticker and not pd.isna(ticker[sources[current]['name']]) \
                and ((is_pre_market_session() and sources[current]['has_pre_market']) or \
                (is_after_hours_session() and sources[current]['has_after_hours']) or \
                (is_regular_trading_session() or not is_weekday() )):
                logging.debug(f"has source {current} {ticker[sources[current]['name']]}")
                selected = current
            else:
                logging.debug(f"does not have source {current} {sources[current]['name']}")
                current = current + 1
                if current == num_sources:
                    current = 0
                if current == first_checked:
                    logging.info(f"no sources found")
                    break

        if selected != -1:
            logging.debug(f"process single ticker")
            single_ticker = [ None ]
            single_ticker[0] = ticker
            # Call the 'process_source' function to scrape website for a single ticker
            try:
                sources[current]['hits'] = sources[current]['hits'] + 1
                sources[selected]['process'](driver,single_ticker,function_handlers,sleep_interval)
            except Exception as e:
                logging.error(f"process source error {e}")
            current = current + 1
            if current == num_sources:
                current = 0
            first_checked = current
            selected = -1
            time.sleep(sleep_interval)
        else:
            logging.info(f"nothing to work on")

    for source in sources:
        logging.info(f"{source['name']} : {source['hits']}")
    #logging.info(f"usage: {sources}")

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
                    type=int, default=3,
                    help='Seconds to sleep between processing each ticker (default: 3)')
    
    parser.add_argument('--driver', '-d', dest='browser',
                    default='safari',
                    help='web browser [chrome|firefox|safari] (default: safari)')
    
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')

    parser.add_argument('--source', '-s', dest='source',
                    default='yahoo',
                    help='web site source [finance_c|google|investing|nasdaq|trading_view|webull|yahoo|ycharts] (default: yahoo')
    
    parser.add_argument('--roundrobin', '-r', dest='round_robin', type=bool, default=False,
                        help='rotate websites round robin')
    
    parser.add_argument('--yahoo', '-y', dest='yahoo_batch', type=bool, default=False,
                    help='retrieve stock tickers from numbers, use yfinance for prices')


    args = parser.parse_args()
    setup_logging(args.log_level)

    round_robin = args.round_robin
    input_file = args.input_file
    tickers = get_tickers_and_urls_from_csv(input_file, args.include_type)
    browser = args.browser
    yahoo_batch = args.yahoo_batch
    selected_source=args.source
    sleep_interval = args.sleep_interval

    function_handlers = [update_numbers]
    if browser == 'chrome':
        logging.info(f"USE CHROMEs DRIVER")
        chrome_options = webdriver.ChromeOptions()
        chrome_options.add_argument("--headless")  # Run in headless mode
        chrome_options.add_argument("--no-sandbox")
        #chrome_options.add_argument("--user-data-dir=/Users/chewie/Library/Application Support/Google/Chrome/Profile 1")  # Overcome limited resource problems
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service,options=chrome_options)
    elif browser == "firefox":

        logging.info(f"USE FIREFOX DRIVER")
        #service = FirefoxService(executable_path="firefox.geckodriver")
        options = FirefoxOptions()
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--headless')
        driver = webdriver.Firefox(options=options)
    elif browser == "safari":
        logging.info(f"USE SAFARI DRIVER")
        safari_path = '/usr/bin/safaridriver'
        service = SafariService(executable_path=safari_path)


#            driver = webdriver.Safari(service=service)
    max_attempts = 5
    attempt_count = 0

    while attempt_count < max_attempts:
        try:
            # Attempt to start the driver
            driver = webdriver.Safari(service=service)
            
            # If successful, break out of the loop
            print(f"Safari driver started successfully on attempt {attempt_count + 1}")
            break
        
        except WebDriverException as e:
            # Handle the exception
            print(f"Attempt {attempt_count + 1} failed: {str(e)}")
            
            # Check if the error is about the driver exiting unexpectedly
            if "unexpectedly exited" in str(e).lower():
                print("Safari driver failed to start. Restarting Safari...")

                # Close any running instances of Safari
                try:
                    subprocess.run(['pkill', 'Safari'],)
                    print("Closed all Safari instances.")
                except Exception as e2:
                    print(f"Error closing Safari: {e2}")

                time.sleep(1)

                # Restart Safari
                try:
                    subprocess.run(['/Applications/Safari.app/Contents/MacOS/Safari'], start_new_session=True)
                    print("Safari restarted. Waiting 5 seconds before retry...")
                except Exception as e3:
                    print(f"Error restarting Safari: {e3}")

            else:
                # If it's a different error, raise after giving up
                if attempt_count == max_attempts - 1:
                    print("Giving up after maximum attempts.")
                    raise
                else:
                    # Wait before retrying (add delay to avoid overwhelming system)
                    time.sleep(5)
                    
        attempt_count += 1

    # Continue with your Selenium tests
    if 'driver' in locals():
        try:
            # Your test code here

        #   Source       | Pre Market | After Hours | Real Time | Delayed | Bond Prices | Prev Close | Change Dec | Change PC
        #   yahoo        |    ???     |      X      |     X     |         |             |     X      |      X     |
        #   webull       |     X      |      X      |     X     |         |      X      |
        #   trading view |     X      | only til 8p |     X     |         |             |
        #   investing    |     X      |      X      |     X     |         |             |
        #   google       |     X      |      X      |     X     |         |             |            |      X
        #   ycharts      |     X      |      X      |     X     |         |             |            |      X     |     X
        #   moomoo       |  no etf    |   no etf    |     X     |         |             |            |      X     |     X
        #   marketbeat   |            |             |           |    X    |
        #   nasdaq       |            |      X      |     X     | 
        #   cnbc         |     ?      |      X      |     X     |         |             |
            yahoo = get_yahoo_attributes()
            webull = get_webull_attributes()
            ycharts = get_ycharts_attributes()
            trading_view = get_trading_view_attributes()
            google_finance = get_google_attributes()
            #wsj = get_marketbeat_attributes()
            moomoo = get_moomoo_attributes()
            cnbc = get_cnbc_attributes()
            #nasdaq = get_nasdaq_attributes()
            sources = [ yahoo, webull, ycharts, trading_view, google_finance, moomoo, cnbc ]
            
            if round_robin:
                process_round_robin(driver,tickers, sources, function_handlers, sleep_interval)
                driver.quit()
                exit(0)

            if yahoo_batch:
                # the main reason to use this version is to pull tickers from the numbers spreadsheet
                # instead of the .csv file
                process_yahoo_with_tickers_from_numbers(driver,tickers,function_handlers,sleep_interval)
                exit(0)

            #logging.info(f"source: {selected_source}")

            for source in sources:
                #logging.info(f"compare source: {source}")
                if selected_source == source['name']:
                    #logging.info(f"call process : {selected_source}")
                    result = source['process'](driver,tickers,function_handlers,sleep_interval)
                    break


            # When finished
            driver.quit()
        except Exception as e:
            print(f"Error during test execution: {str(e)}")
    else:
        # Driver couldn't be started
        print("Safari driver could not be initialized after maximum attempts")

    exit(0)

if __name__ == "__main__":
    main()
