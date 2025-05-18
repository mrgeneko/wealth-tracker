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
import pandas as pd

class Ticker:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __repr__(self):
        # Create a string representation of the object using its attributes
        attrs = ', '.join(f"{key}={getattr(self, key)}" for key in self.__dict__)
        return f"Ticker({attrs})"



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

def read_tickers(file_path, include_type=None):

    try:
        with open(file_path, 'r') as file:
            # Filter out empty lines and comments first
            tickers = [
                line.strip()
                for line in file
                if line.strip() and not line.strip().startswith('#')
            ]
    except Exception as e:
        logging.error(f"Error opening file {file_path}: {e}")
        exit(1)

    logging.info(f"include_type: {include_type}")
    # Apply additional filtering based on `include_type`
    if include_type == "bonds":
        #return [ticker for ticker in tickers if "bond-" in ticker]
        return [ticker for ticker in tickers if ticker.startswith("bond-")]
    elif include_type == "stocks":
        return [ticker for ticker in tickers if "bond-" not in ticker]
    else:
        logging.info(f"allow all type")
        return tickers  # Default: no additional filtering
    
def generate_url(ticker):
    base_url = "https://www.webull.com/quote/{}"
    encoded_ticker = urllib.parse.quote_plus(ticker)
    url = base_url.format(encoded_ticker)
    return url

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
    logging.info(f'sleep 5 seconds')
    time.sleep(5)

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

    else:
        logging.info(f"Process stock quote page: {website}")
        
        ticker = driver.find_element(By.XPATH, '//div[@class="csr109"]/p[1]')
        #logging.info(f"ticker by.xpath {ticker.text}")

        description = driver.find_element(By.CLASS_NAME, 'csr127')
        #logging.info(f"description {description.text}")

        exchange = driver.find_element(By.CLASS_NAME, 'csr128')
        #logging.info(f"exchange {exchange.text}")

        last_price = driver.find_element(By.CLASS_NAME, 'csr112')
        #logging.info(f"last_price {last_price.text}")

        price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
        #logging.info(f"price_change_decimal {price_change_decimal.text}")

        price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
        #logging.info(f"price_change_percent {price_change_percent.text}")

        price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
        #logging.info(f"price_datetime {price_datetime.text}")

        if "After Hours" in price_datetime.text:
            try:
                after_hours_price_string = driver.find_element(By.XPATH, "//div[contains(@class, 'csr132')]/div[contains(@class, 'csr132')]/span[1]")
                after_hours_price = after_hours_price_string.text.split(" ")[0]
                #logging.info(f"after_hours_price_string {after_hours_price_string.text}")
                after_hours_price_change_decimal = after_hours_price_string.text.split(" ")[1]
                #logging.info(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
                after_hours_price_change_percent = after_hours_price_string.text.split(" ")[2]
                #logging.info(f"after_hours_price_change_percent {after_hours_price_change_percent}")
            except Exception as e:
                logging.info(f"after_hours_price not found: {e}")
        else:
            logging.info(f"After Hours not found")
            after_hours_price = ""
            after_hours_price_change_decimal = ""
            after_hours_price_change_percent = ""
        
        #logging.info(f"after_hours_price {after_hours_price}")
        #logging.info(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
        #logging.info(f"after_hours_price_change_percent {after_hours_price_change_percent}")    

        open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
        #logging.info(f"open_price {open_price.text}")

        prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
        #logging.info(f"prev_close_price {prev_close_price.text}")

        high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
        #logging.info(f"high_price {high_price.text}")

        low_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[2]/DIV[2]')
        #logging.info(f"low_price {low_price.text}")

        volume = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[1]/DIV[2]')
        #logging.info(f"volume {volume.text}")

        turnover = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[2]/DIV[2]')
        #logging.info(f"turnover {turnover.text}")

        fiftytwo_week_high = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[1]/DIV[2]')
        #logging.info(f"fiftytwo_week_high {fiftytwo_week_high.text}")

        fiftytwo_week_low = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[2]/DIV[2]')
        #logging.info(f"fiftytwo_week_low {fiftytwo_week_low.text}")

        market_cap = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[1]/DIV[2]')
        #logging.info(f"market_cap {market_cap.text}")

        label = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[1]')
        #logging.info(f"label {label.text}")
        
        if "YTD YIELD" in label.text:
            #logging.info("YTD Yield.")
            ytd_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
            #logging.info(f"ytd_yield {ytd_yield.text}")
            price_to_earnings_ttm = ""
        else:
            #logging.info("PE Ratio.")
            price_to_earnings_ttm = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
            #logging.info(f"price_to_earnings_ttm {price_to_earnings_ttm.text}")
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

    driver.quit()
    json_string = json.dumps(data, indent=4)
    logging.info(f"Data extracted: {json_string}")
    return data
        


def main():
    # Configure logging
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    parser = argparse.ArgumentParser(description='Process tickers and update Apple Numbers.')

    # Define the new --input-file (-i) argument for the tickers file path
    parser.add_argument('--input-file', '-i', dest='tickers_file',
                        type=str,
                        default="tickers.csv",
                        help='Path to the tickers file (default: webull_tickers.txt)')
    
    parser.add_argument('--include-type', '-t', dest='include_type', type=str,
                        choices=['stocks', 'bonds'], default='stocks',
                        help='Specify "stocks" to exclude bonds or "bonds" to include only bond lines')
    
    parser.add_argument('--sleep-interval', '-s', dest='sleep_interval',
                    type=int, default=20,
                    help='Seconds to sleep between processing each ticker (default: 20)')

    args = parser.parse_args()

   
    tickers_file = args.tickers_file
    tickers = read_urls(tickers_file, args.include_type)
    
    # Give the user a chance to review tickers
    logging.info(f'sleep 5 seconds')
    time.sleep(5)

    for i, ticker in enumerate(tickers):
        url_selection = 'webull_url'
        if url_selection in ticker:
            print(f"Key '{url_selection}' exists with value: {ticker[url_selection]}")
        else:
            print(f"Key '{url_selection}' does not exist in this object.")

        if not pd.isna(ticker[url_selection]):
            logging.info(f"Key '{url_selection}' exists with value: {ticker[url_selection]}")
        else:
            logging.info(f"Key '{url_selection}' does not have a value or has NaN.")
            continue

        url = ticker[url_selection]
        row_key = ticker['key']

        logging.info(f'row_key: {row_key} selected url: {url}')
        # call other script here
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

        logging.info(f'sleep {args.sleep_interval} seconds')
        time.sleep(args.sleep_interval)  # Sleep for the specified interval
    
    exit(0)


if __name__ == "__main__":
    main()
