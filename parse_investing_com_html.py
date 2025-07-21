#!/usr/bin/env python3
import logging
import os
from bs4 import BeautifulSoup
import argparse
from datetime import datetime
from update_cell_in_numbers import update_numbers

from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from is_number import is_number
import json

# use monitor at investing.com 
# investing.com hsupports multiple watchlists. THe exported html will contain only the first/left watchlist on first load
# but reloading the web page after selecting another watchlist seems to load the correct html
# iCloudDrive/Script Editor/investing_com_export_html.scpt  -> saves html 
        
def parse_watchlist_table(html_content):
    logging.info("parse_watchlist_table")

    #logging.info(f"html_content: {html_content}")

    # Step 2: Parse the HTML content with BeautifulSoup
    soup = BeautifulSoup(html_content, 'html.parser')

    # Initialize an array to hold JSON objects
    specific_rows_json = []

    # Step 3: Locate the table in the HTML (assuming there's only one table of interest)
    # You might need to adjust this selector based on the actual structure of your HTML file.
    #table = soup.find('tbody', id='tbody_overview_' )  # This is a generic selector; you might need something like 'table#specific-id'
    table = soup.select_one('[id^="tbody_overview_"]' )
    if not table:
        print("No table found in the HTML.")
        return specific_rows_json
    else:
        logging.info(f"Found table")
        #logging.info(f"Found table: {table}")

    # Step 4: Identify rows with the required columns
    required_columns = {"symbol", "exchange", "last",
                        "bid", "ask", "extended_hours",
                        "extended_hours_percent", "open",
                        "prev", "high", "low", "chg",
                        "chgpercent", "vol", "next_earning",
                        "time"
                        }

    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()

    # tickers such as BKLC do not get priced correctly on investing.com in extended hours
    # price change in BKLC should closely follow VOO, so we'll calculate an estimated price
    # for BKLC
    model_tickers = [{"target":"BKLC", "source":"VOO", "percent_change": None},
                      {"target":"QQUP", "source":"QLD", "percent_change": None}]
    for row in table.find_all('tr'):
        #logging.info(f"row: {row}")
        cols = row.find_all('td')
        
        # Create a dictionary to hold the data of this row
        row_data = {}

        for col in cols:
            column_name = col.get('data-column-name')
            #logging.info(f"column name: {column_name}")
            if column_name in required_columns:
                #logging.info(f"req col found {column_name}")
                row_data[column_name] = col.get_text(strip=True)

        # Check if the row contains all required columns
        if set(row_data.keys()) == required_columns:
            source_ticker = None
            for model_ticker in model_tickers:
                if row_data["symbol"] == model_ticker["source"]:
                    source_ticker = model_ticker
                    break

            if source_ticker != None:
                logging.info(f"\n\nSOURCE_TICKER FOUND for {model_ticker["target"]} -> row_data {row_data}")
                if row_data["extended_hours_percent"] == "--":
                    model_ticker["percent_change"] = "0.00"
                else:
                   logging.info(f"ext_hours_percent: {row_data["extended_hours_percent"]}")
                   model_ticker["percent_change"] = row_data["extended_hours_percent"].rstrip('%')
            
                #logging.info(f"extended_hours_percent: {model_ticker["percent_change"]}")
                logging.info(f"model_ticker: {model_ticker}")


    for row in table.find_all('tr'):
        #logging.info(f"row: {row}")
        cols = row.find_all('td')
        
        # Create a dictionary to hold the data of this row
        row_data = {}
        
        for col in cols:
            column_name = col.get('data-column-name')
            #logging.info(f"column name: {column_name}")
            if column_name in required_columns:
                #logging.info(f"req col found {column_name}")
                row_data[column_name] = col.get_text(strip=True)
        
        # Check if the row contains all required columns
        if set(row_data.keys()) == required_columns:
            logging.info(f"\n\nrow_data {row_data}")
            specific_rows_json.append(row_data)
            # transfer data to object that udpate_cell_in_numbers.py expects
            # Get the current time
            current_time = datetime.now().time()

            data = {}
            data["key"] = row_data["symbol"]
            data["last_price"] = row_data["last"]
            #data["price_change_decimal"] = row_data["chg"]
            #data["price_change_percent"] = row_data["chgpercent"]
            data["source"] = "investing mon"
            
            # check if this row_data has a ticker that needs to have price modeled after another ticker
            source_ticker = None
            for model_ticker in model_tickers:
                if row_data["symbol"] == model_ticker["target"]:
                    source_ticker = model_ticker
                    logging.info(f"This ticker modeled after {model_ticker}")
                    break

            if current_time < market_open_time and current_time > pre_market_open_time and is_number(row_data["extended_hours"]):
                if source_ticker == None:
                    data["pre_market_price"] = row_data["extended_hours"]
                else:
                    data["pre_market_price"] = (float(1.00) + (float(.01) * float(source_ticker["percent_change"]))) * float(row_data["last"])
                    data["source"] = "modeled"
            elif (current_time > market_close_time or current_time < pre_market_open_time) and row_data["extended_hours"] != '--':
                if source_ticker == None:
                    data["after_hours_price"] = row_data["extended_hours"]
                else:
                    data["after_hours_price"] = (float(1.00) + (float(.01) * float(source_ticker["percent_change"]))) * float(row_data["last"])
                    data["source"] = "modeled"
            #FOR TESTING elif source_ticker != None:
            #    data["pre_market_price"] = (float(1.00) + (float(.01) * float(source_ticker["percent_change"]))) * float(row_data["last"])
            #    data["source"] = "modeled"

            logging.info(data)
            update_numbers(data)

    #logging.info(f"specific_rows_json: {specific_rows_json}")
    #logging.info(f"specific_rows_json: {json.dumps(specific_rows_json, indent=4)}")
    return specific_rows_json


def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    parser = argparse.ArgumentParser(description="Process investing.com .html file to extract stock data")
    parser.add_argument("--file_path", '-f', type=str, help="Path to the invesing.com .html file")
    parser.add_argument("--output_file_path", '-o', type=str, help="Path to the json output file")
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')
    args = parser.parse_args()
    setup_logging(args.log_level)
    
    if True:
        if not os.path.exists(args.file_path):
            print(f"File does not exist: {args.file_path}")
            return

        # Step 1: Read the HTML content from the file
        with open(args.file_path, 'r', encoding='utf-8') as file:
            html_content = file.read()
    else:   
        logging.info(f'Creating Chrome Service')
        chrome_options = webdriver.ChromeOptions()
        chrome_options.add_experimental_option("debuggerAddress", "localhost:9222")
        #chrome_options.add_argument("--headless")  # Run in headless mode
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service,options=chrome_options)
        print(driver.title)

        #save_url = driver.command_executor
        #session_id = driver.session_id
        #url = "https://www.investing.com/portfolio/?portfolioID=MzAzZDRgNGE3Z2lkM2UwOw%3D%3D"
        #logging.info("connect to remote webdriver")
        #driver = webdriver.Remote(command_executor=url)
        #logging.info("connect to remote webdriver done")
        #driver.close() # this prevents the dummy browser
        #driver.session_id = session_id
        #driver.get("https://www.investing.com/portfolio/?portfolioID=MzAzZDRgNGE3Z2lkM2UwOw%3D%3D")
        #time.sleep(7)
        #driver.find_element(By.NAME,"loginFormUser_email").send_keys(username)
        #time.sleep(3)
        #driver.find_element(By.ID, "loginForm_password").send_keys(password)
        #time.sleep(5)
        #driver.find_element(By.XPATH,'//*[@id="signup"]/a').click()

        #time.sleep(15)
        #print("logged in!")
        driver.get("https://www.investing.com/portfolio/?portfolioID=MzAzZDRgNGE3Z2lkM2UwOw%3D%3D")
        html_content = driver.page_source
        logging.info(f"{html_content}")
        driver.quit()

    price_data = parse_watchlist_table(html_content)

    #if not os.path.exists(args.file_path):
    #    print(f"File does not exist: {args.file_path}")
    #    return

    # Step 1: Read the HTML content from the file
    with open(args.output_file_path, 'w', encoding='utf-8') as file:
        file.write(json.dumps(price_data, indent=4))

    #print(json.dumps(price_data, indent=4))

if __name__ == "__main__":
    main()
                            