from datetime import datetime
import os
import sys
import argparse
import logging
import urllib.parse
import json
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.safari.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import time
import subprocess
import re
import pandas as pd


def read_urls(file_path, include_type=None):
    logging.info(f'read_urls: {file_path}')
    
    try:
        # Read the CSV file into a DataFrame
        df = pd.read_csv(file_path)
        #logging.info(df)

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
    
#def generate_url(ticker):
#    base_url = "https://www.webull.com/quote/{}"
#    encoded_ticker = urllib.parse.quote_plus(ticker)
##    url = base_url.format(encoded_ticker)
 #   return url

def run_applescript(script):
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        print("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

def update_numbers(data):
    #logging.info(f'begin update_numbers {data} ')
    numbers_file = "retirement plan.numbers"
    sheet_investments = "Investments"
    table_investments = "T"

    script = f'''
    tell application "Numbers"
        tell document "{numbers_file}"
            tell sheet "{sheet_investments}"
                tell table "{table_investments}"
                    set price_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Price" then
                            set price_col to i
                            exit repeat
                        end if
                    end repeat
                    if price_col is 0 then error "Price column not found."

                    set key_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "key" then
                            set key_col to i
                            exit repeat
                        end if
                    end repeat
                    if key_col is 0 then error "Key column not found."

                    set rowCount to row count
                    repeat with r from 2 to rowCount
                        set tickerVal to value of cell key_col of row r
                        if tickerVal is not missing value and tickerVal is not "" then
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell price_col of row r to "{data["last_price"]}"'
                                #for ticker, data in prices.items()
                            ])}
                        end if
                    end repeat
                end tell
            end tell
        end tell
    end tell
    '''
    #logging.info(f"script: {script}")
    run_applescript(script)


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

def process_xpaths(website,key):

    logging.info(f"Website URL: {website}")
    if not website:
        logging.error("No URL provided. Exiting.")
        sys.exit(1) 

    if True:
        safari_path = '/usr/bin/safaridriver'
        service = Service(executable_path=safari_path)
        #logging.info(f'Safari Service created')
        driver = webdriver.Safari(service=service)
    else:
        chrome_path = '/Users/gene/bin/chromedriver-mac-arm64/chromedriver'
        service = Service(executable_path=chrome_path)
        logging.info(f'Chrome Service created')
        chrome_options = Options()
        chrome_options.add_argument("--headless")  # Run in headless mode
        driver = webdriver.Chrome(service=service,options=chrome_options)
    
    driver.get(website)
    logging.info(f'sleep 5 seconds to allow website to load')
    time.sleep(5)

    # Wait for a specific element to be present (e.g., an element with ID 'example')
    #wait = WebDriverWait(driver, 10)
    #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
    
    html_content = driver.page_source
    #logging.info(html_content)

    # Base path for logs
    base_path = '/Users/gene/logs'
    # Create log file path
    html_file_path = create_html_file_path(base_path, website)
    logging.info(f"save html to: {html_file_path}")
    with open(html_file_path, "w") as f:
        f.write(html_content)

    try:
        if "bond" in website:
            logging.info(f"Process bond quote page: {website}")

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
                "webull_url": website,
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
            logging.debug('quit driver')
            driver.quit()
            
        else:
            logging.info(f"Process stock quote page: {website}")
            
            ticker = driver.find_element(By.XPATH, '//div[@class="csr109"]/p[1]')
            logging.debug(f"ticker by.xpath {ticker.text}")

            description = driver.find_element(By.CLASS_NAME, 'csr127')
            logging.debug(f"description {description.text}")

            exchange = driver.find_element(By.CLASS_NAME, 'csr128')
            logging.debug(f"exchange {exchange.text}")

            last_price = driver.find_element(By.CLASS_NAME, 'csr112')
            logging.info(f"last_price {last_price.text}")

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
            logging.info(f"price_datetime {price_datetime.text}")

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
            else:
                logging.debug(f"After Hours not found")
                after_hours_price = ""
                after_hours_price_change_decimal = ""
                after_hours_price_change_percent = ""
            
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
                "webull_url": website,
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
            logging.debug('quit driver')
            driver.quit()
    except Exception as e:
        logging.error('Exception processing xpath. will quit driver')
        driver.quit()
    
    json_string = json.dumps(data, indent=4)
    logging.info(f"Data extracted: {json_string}")
    return data
        
def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    # Configure logging
    #logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    parser = argparse.ArgumentParser(description='scrape a list of websites for a list of fields.')

    # Define the new --input-file (-i) argument for the tickers file path
    parser.add_argument('--input-file', '-i', dest='input_file',
                        type=str,
                        default="scrapeman.csv",
                        help='Path to the input file (default: scrapeman.csv)')
    
    parser.add_argument('--include-type', '-t', dest='include_type', type=str,
                        choices=['stocks', 'bonds'], default='stocks',
                        help='Specify "stocks" to exclude bonds or "bonds" to include only bond lines')
    
    parser.add_argument('--sleep-interval', '-s', dest='sleep_interval',
                    type=int, default=20,
                    help='Seconds to sleep between processing each ticker (default: 20)')
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')

    args = parser.parse_args()
    setup_logging(args.log_level)
   
    input_file = args.input_file
    tickers = read_urls(input_file, args.include_type)
    
    # Give the user a chance to review tickers
    logging.info(f'sleep 5 seconds')
    time.sleep(5)

    for i, ticker in enumerate(tickers):
        url_selection = 'webull_url'
        if url_selection in ticker:
            logging.debug(f"Key '{url_selection}' exists with value: {ticker[url_selection]}")
        else:
            logging.debug(f"Key '{url_selection}' does not exist in this object.")

        if not pd.isna(ticker[url_selection]):
            logging.debug(f"Key '{url_selection}' exists with value: {ticker[url_selection]}")
        else:
            logging.debug(f"Key '{url_selection}' does not have a value or has NaN.")
            continue

        url = ticker[url_selection]
        row_key = ticker['key']

        logging.info(f'row_key: {row_key} selected url: {url}')
        try:
            result = process_xpaths(url,row_key)
        except subprocess.CalledProcessError as e:
            logging.error(f"Error processing {row_key}: {e}")
            logging.info(f'sleep {args.sleep_interval} seconds')
            time.sleep(args.sleep_interval)  # Sleep for the specified interval
            continue
        except Exception as e:
            logging.error(f"Unexpected error process_xpaths {row_key}: {e}")
            logging.info(f'sleep {args.sleep_interval} seconds')
            time.sleep(args.sleep_interval)  # Sleep for the specified interval
            continue
        
        # logging.info(f"Processed ticker {ticker} ({i+1}/{len(tickers)})")
        #logging.info(f"result: {result}")
        update_numbers(result)

        logging.info(f'sleep {args.sleep_interval} seconds before next item')
        time.sleep(args.sleep_interval)  # Sleep for the specified interval
    
    exit(0)

if __name__ == "__main__":
    main()
