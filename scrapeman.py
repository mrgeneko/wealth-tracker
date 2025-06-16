#!/usr/bin/env python3

import argparse
import logging
from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.safari.service import Service as SafariService
from selenium.webdriver.firefox.options import Options as FirefoxOptions

import time
import os
from subprocess import run, CalledProcessError, CompletedProcess
import datetime
import pandas as pd
from update_cell_in_numbers import update_numbers
from process_yahoo import process_yahoo_with_tickers_from_numbers
from process_yahoo import get_yahoo_attributes
from process_google import get_google_attributes
from process_trading_view import get_trading_view_attributes
from process_ycharts import get_ycharts_attributes
from process_webull import get_webull_attributes
from process_marketbeat import get_marketbeat_attributes
from process_wsj import get_wsj_attributes
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


def get_html_for_url(mode, driver,tickers, source):
    logging.info(f"get_html_for_url with mode {mode}")

    for i, ticker in enumerate(tickers):

        if source in ticker:
            logging.debug(f"Key {ticker['key']} has url: {ticker[source]}")
        else:
            logging.debug(f"Key {source} does not exist in this object.")

        if not pd.isna(ticker[source]):
            logging.debug(f"Key {ticker['key']} has value: {ticker[source]}")
        else:
            logging.debug(f"Key {source} does not have a value or has NaN.")
            continue

        url = ticker[source]
        key = ticker['key']
        #logging.info("\n")
        logging.info(f'get html ticker: {ticker['key']} selected url: {url}')
        
        # Generate timestamp in YYYYMMDD_HHMMSS format
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # Get the full path to your directory (this is the key fix)
        directory = os.path.expanduser('~/singlefile_html')  # Expands ~ to full path
        bin_directory = os.path.expanduser('~/bin')  # Expands ~ to full path
        if not os.path.exists(directory):
            os.makedirs(directory)  # Create directory if it doesn't exist

        if mode == "chrome_dump_dom":
            
            command = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
            args = [ "--headless", "--dump-dom", url]
            #args = [ "--dump-dom", url]
            try:
                # Execute the command and redirect output to the file
                logging.info(f"run chrome dump for {url}")
                html_file = os.path.join(directory, f"{ticker['key']}.{source}.{timestamp}.html")
                result = run(
                    [*command, *args],
                    stdout=open(html_file, "w", encoding="utf-8"),
                    check=True
                )
                logging.info(f"done chrome dump command {result}")
                try:
                    html_file = os.path.join(directory, f"{ticker['key']}.{source}.{timestamp}.html")
                    with open(html_file, 'r', encoding='utf-8') as file:
                        html_content = file.read()
                except FileNotFoundError:
                    logging.error(f"Error: File not found {html_file}")
                    return 1

            except CalledProcessError as e:
                print(f"Error occurred while running the command: {e}")

        elif driver != None and mode == "selenium":
            logging.info(f"mode SELENIUM")
            driver.get(url)
            logging.info(f'sleep 2 seconds to allow website to load')
            time.sleep(2)
            html_content = driver.page_source
            logging.info(f"html: {html_content[:20]}")
            try:
                html_file = os.path.join(directory, f"{ticker['key']}.{source}.{timestamp}.html")
                with open(html_file, 'w', encoding='utf-8') as file:
                    file.write(html_content)
                logging.info(f"html file written")
            except FileNotFoundError:
                logging.error(f"Error: cannot write {html_file}")
                return 1
        else:
            logging.info(f"mode SINGLEFILE")
            # let's use singlefile command to retrieve html
            singlefile_script = os.path.join(bin_directory,"html_to_singlefile.sh")
            logfile = os.path.join(directory, f"{ticker['key']}.{source}.{timestamp}.log")
            filename = f"{ticker['key']}.{source}.{timestamp}.html"

            # Define the command and its arguments
            command = [ singlefile_script ]
            args = [url, filename]

            try:
                # Execute the command and redirect output to the file
                logging.info(f"run html_to_singlefile.sh for {url}")
                result = run(
                    [*command, *args],
                    #stdout=open(logfile, "w", encoding="utf-8"), # uncomment this line to create a log of command
                    check=True
                )
                logging.info(f"done singlefile command")
            except CalledProcessError as e:
                print(f"Error occurred while running the command: {e}")

            time.sleep(3)
            try:
                html_file = os.path.join(directory, f"{ticker['key']}.{source}.{timestamp}.html")
                with open(html_file, 'r', encoding='utf-8') as file:
                    html_content = file.read()
            except FileNotFoundError:
                logging.error(f"Error: File not found {html_file}")
                return 1
            except UnicodeDecodeError:
                logging.error(f"Error: Could not decode the {html_file} file with UTF-8 encoding")
                return 1
        logging.info(f"get_html_for_url returning html")
        return html_content

        
def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def process_round_robin(driver, tickers, sources, function_handlers):
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
            #logging.info(f"sources[current]['name']: {sources[current]['name']}")
            #logging.info(f"ticker[sources[current]['name']]: {ticker[sources[current]['name']]}")
            if sources[current]['name'] in ticker and not pd.isna(ticker[sources[current]['name']]) \
                and ((is_pre_market_session() and sources[current]['has_pre_market']) or \
                (is_after_hours_session() and sources[current]['has_after_hours']) or \
                (is_regular_trading_session() or not is_weekday() )):
                logging.info(f"has source {sources[current]['name']} for {ticker[sources[current]['name']]}")
                selected = current
            else:
                logging.info(f"does not have source {current} {sources[current]['name']}")
                current = current + 1
                if current == num_sources:
                    current = 0
                if current == first_checked:
                    logging.info(f"no sources found")
                    break

        if selected != -1:
            logging.info(f"process_round_robin selected source {sources[selected]['name']}")
            single_ticker = [ None ]
            single_ticker[0] = ticker
            selected_source = sources[selected]['name']
            #logging.info(f"selected: {sources[selected]}")
            download = sources[selected]['download']
            
            # Call the 'extract' function to scrape website for a single ticker
            try:
                if download == "chrome_dump_dom":
                    try:
                        mode = "chrome_dump_dom" # THIS could just use the download variable instead!!
                        html_content = get_html_for_url(mode,driver,single_ticker, selected_source )
                        data = sources[selected]['extract'](ticker['key'],html_content)
                    except Exception as e:
                        logging.error(f"get_html_for_url with chrome_dom_dump error {e}. FALL BACK TO YAHOO")
                        html_content=""
                        for s in sources:
                            if s['name'] == "yahoo":
                                data = s['extract'](ticker['key'],html_content)
                elif download == "selenium":
                    if driver != None:
                        mode="selenium"
                        try:
                            html_content = get_html_for_url(mode,driver,single_ticker, selected_source )
                            data = sources[selected]['extract'](ticker['key'],html_content)
                        except Exception as e:
                            logging.error(f"get_html_for_url with selenium error {e}. FALL BACK TO YAHOO")
                            html_content=""
                            for s in sources:
                                if s['name'] == "yahoo":
                                    data = s['extract'](ticker['key'],html_content)
                    else:
                        # fallback to yahoo. Hits are slightly off if this happens
                        logging.error(f"NO SELENIUM DRIVER. FALLING BACK TO YAHOO")
                        html_content=""
                        for s in sources:
                            if s['name'] == "yahoo":
                                data = s['extract'](ticker['key'],html_content)
                elif download == "yfinance":
                    # yahoo uses the yfinance API and does not need html retrieval
                    html_content=""
                    data = sources[selected]['extract'](ticker['key'],html_content)
                elif download == "singlefile":
                    mode="singlefile"
                    html_content = get_html_for_url(mode,driver,single_ticker, selected_source )
                    data = sources[selected]['extract'](ticker['key'],html_content)

                sources[selected]['hits'] = sources[selected]['hits'] + 1
                #logging.info(f"call function handlers[0]")
                function_handlers[0](data)
                #logging.info(f"done function handlers[0]")
            except Exception as e:
                logging.error(f"process round robin source error {e}")
            current = current + 1
            if current == num_sources:
                current = 0
            first_checked = current
            selected = -1
            #time.sleep(sleep_interval)
        else:
            logging.info(f"no source found for this ticker")

    for source in sources:
        logging.info(f"{source['name']} : {source['hits']}")

def main():

    parser = argparse.ArgumentParser(description='scrape a list of websites for a list of fields.')

    parser.add_argument('--input-file', '-i', dest='input_file',
                        type=str,
                        default="scrapeman.csv",
                        help='Path to the input file (default: scrapeman.csv)')
    
    parser.add_argument('--include-type', '-t', dest='include_type', type=str,
                        choices=['stocks', 'bonds'], default='stocks',
                        help='Specify "stocks" to exclude bonds or "bonds" to include only bond lines')
    
    parser.add_argument('--driver', '-d', dest='browser',
                    default='chrome',
                    help='web browser [chrome|firefox|safari] (default: chrome)')
    
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')

    
    # the 'sources' argument which accepts multiple strings
    parser.add_argument(
        '--sources', '-s',
        nargs='+',  # This allows one or more arguments to be passed
        type=str,
        required=False,
        help='pricing sources [google|investing|trading_view|webull|yahoo|ycharts] (default: yahoo'
    )
    
    parser.add_argument('--yahoo', '-y', dest='yahoo_batch', type=bool, default=False,
                    help='retrieve stock tickers from numbers, use yfinance for prices')


    args = parser.parse_args()
    setup_logging(args.log_level)

    input_file = args.input_file
    tickers = get_tickers_and_urls_from_csv(input_file, args.include_type)
    browser = args.browser
    yahoo_batch = args.yahoo_batch
    sleep_interval = 1

    function_handlers = [update_numbers]

    #   Source       | Pre Market | After Hours | Real Time | Delayed | Bond Prices | Prev Close | Change Dec | Change PC
    #   yahoo        |    ???     |      X      |     X     |         |             |     X      |      X     |
    #   webull       |     X      |      X      |     X     |         |      X      |
    #   trading view |     X      | only til 8p |     X     |         |             |
    #   investing    |     X      |      X      |     X     |         |             |
    #   google       |     X      |      X      |     X     |         |             |            |      X
    #   ycharts      |     X      |      X      |     X     |         |             |            |      X     |     X
    #   moomoo       |  no etf    |   no etf    |     X     |         |             |            |      X     |     X
    #   marketbeat   |     ?      |    some?    |           |    X    |
    #   nasdaq       |            |      X      |     X     | 
    #   cnbc         |     ?      |      X      |     X     |         |             |

    yahoo = get_yahoo_attributes()
    webull = get_webull_attributes()
    ycharts = get_ycharts_attributes()
    trading_view = get_trading_view_attributes()
    google = get_google_attributes()
    #wsj = get_wsj_attributes() # does not work with singlefile due to bot detection
    moomoo = get_moomoo_attributes()
    marketbeat = get_marketbeat_attributes()
    cnbc = get_cnbc_attributes() # SINGLEFILE gets stuck on cnbc.com so use selenium!!
    #investing = get_investing_attributes() # investing.com is blocked by cloudflare
    #nasdaq = get_nasdaq_attributes() # does not seem to work in headless mode
    #available_sources = [ cnbc, google, moomoo, trading_view, webull, yahoo, ycharts ]
    available_sources = [ wsj ]
    delayed_sources = [ marketbeat ]

    logging.info(f"args.sources: {args.sources}")
    selected_sources = []
    if args.sources != None:
        for s in args.sources:
            for asource in available_sources:
                if s == asource['name']:
                    selected_sources.append(asource)
    else:
        logging.info(f"no sources arguement provided")
        selected_sources = available_sources

    logging.info(f"selected_sources: {selected_sources}")
    
    driver = None
    if browser == 'chrome':
        logging.info(f"USE CHROMEs DRIVER")
        chrome_options = webdriver.ChromeOptions()
        chrome_options.add_argument("--headless")  # Run in headless mode
        chrome_options.add_argument("--no-sandbox")
        #chrome_options.add_argument("--user-data-dir=/Users/chewie/Library/Application Support/Google/Chrome/Profile 1")  # Overcome limited resource problems
        service = Service(ChromeDriverManager().install())
        try:
            driver = webdriver.Chrome(service=service,options=chrome_options)
        except Exception as e:
            logging.error(f"unable to create chrome driver {e}")
    elif browser == "firefox":
        logging.info(f"USE FIREFOX DRIVER")
        #service = FirefoxService(executable_path="firefox.geckodriver")
        options = FirefoxOptions()
        options.add_argument('--no-sandbox')
        options.add_argument('--disable-dev-shm-usage')
        options.add_argument('--headless')
        try:
            driver = webdriver.Firefox(options=options)
        except Exception as e:
            logging.error(f"unable to create firefox driver {e}")
    elif browser == "safari":
        logging.info(f"USE SAFARI DRIVER")
        safari_path = '/usr/bin/safaridriver'
        service = SafariService(executable_path=safari_path)
        try:
            driver = webdriver.Safari(service=service)
        except Exception as e:
            logging.error(f"unable to create safari driver {e}")

    if yahoo_batch:
        # the main reason to use this version is to pull tickers from the numbers spreadsheet
        # instead of the .csv file
        process_yahoo_with_tickers_from_numbers(driver,tickers,function_handlers,sleep_interval)
        exit(0)

    process_round_robin(driver,tickers, selected_sources, function_handlers)
    exit(0)

if __name__ == "__main__":
    main()
