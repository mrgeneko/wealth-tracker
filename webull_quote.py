# usage: python3 webull_quote.py <webull_quote_url>
# example: python3 webull_quote.py https://www.webull.com/quote/bond-912797pj0
import os
from datetime import datetime
import argparse
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import logging

parser = argparse.ArgumentParser(description="Webull Quote Scraper")
parser.add_argument("--ticker", help="Webull quote ticker")
parser.add_argument("--url", help="Webull quote URL")
args = parser.parse_args()
website = args.url
ticker = args.ticker

# check if log directory exists, if not create it
log_dir = "/Users/gene/Downloads/webull_scrape_logs"
if not os.path.exists(log_dir):
    os.makedirs(log_dir)

# Generate a timestamp for use in the log file name
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
log_file = f"/Users/gene/Downloads/webull_scrape_logs/webull_quote_{timestamp}_{ticker}.log"

#if os.path.exists(log_file):
#    os.makedirs(os.path.dirname(log_file))

# Configure logging to write to the new log file
if os.path.exists(log_file):
    # If the file exists, append a timestamp to it
    backup_log_file = f"bond_tickers_logging_{timestamp}_backup.log"
    if not os.path.exists(backup_log_file):
        os.rename(log_file, backup_log_file)  # Rename the existing log file with a backup extension

# Configure logging 
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', filename=log_file)


logging.info(f"Website URL: {website}")
if not website:
    logging.error("No URL provided. Exiting.")
    exit(1) 

#website = 'https://www.webull.com/quote/bond-912797pj0'
path = '/Users/gene/bin/chromedriver-mac-arm64/chromedriver'
service = Service(executable_path=path)

chrome_options = Options()
chrome_options.add_argument("--headless")  # Run in headless mode
driver = webdriver.Chrome(service=service, options=chrome_options)
driver.get(website)

if "bond" in website:
    logging.info(f"Process bond quote page: {website}")
    #description = driver.find_element(By.XPATH, '//*[@id="app"]/section[1]/div[1]/div[1]/div[2]/div[1]/div[1]/h1')
    #logging.info(f"description by.xpath {description.text}")

    description = driver.find_element(By.CLASS_NAME, 'csr124')
    logging.info(f"description {description.text}")

    cusip = driver.find_element(By.CLASS_NAME, 'csr125')
    logging.info(f"cusip {cusip.text}")

    last_price = driver.find_element(By.CLASS_NAME, 'csr112')
    logging.info(f"last_price {last_price.text}")

    price_change_decimal = driver.find_elements(By.CLASS_NAME, 'csr115')
    if len(price_change_decimal) >= 2:
        logging.info(f"price change {price_change_decimal[0].text} {price_change_decimal[1].text}")
    else:
        logging.warning("Could not find two price change elements on the page.")

    price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
    logging.info(f"price_datetime {price_datetime.text}")

    #bond_yield = driver.find_element(By.ID, 'server-side-script')
    #logging.info(f"yield {bond_yield.get_attribute('outerHTML')}")

    bond_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
    logging.info(f"bond_yield {bond_yield.text}")

    high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
    logging.info(f"high_price {high_price.text}")

    low_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
    logging.info(f"low_price {low_price.text}")

    open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[2]/DIV[2]')
    logging.info(f"open_price {open_price.text}")

    coupon_rate = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[1]/DIV[2]')
    logging.info(f"coupon_rate {coupon_rate.text}")

    maturity = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[2]/DIV[2]')
    logging.info(f"maturity {maturity.text}")

    prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[1]/DIV[2]')
    logging.info(f"prev_close_price {prev_close_price.text}")

    coupon_frequency = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[2]/DIV[2]')
    logging.info(f"coupon_frequency {coupon_frequency.text}")

    next_coupon_date = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[1]/DIV[2]')
    logging.info(f"next_coupon_date {next_coupon_date.text}")

    accrued_interest = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
    logging.info(f"accrued_interest {accrued_interest.text}")

else:
    logging.info(f"Process stock quote page: {website}")
    #ticker = driver.find_element(By.XPATH, '//*[@id="app"]/section[1]/div[1]/div[1]/div[2]/div[1]/div[1]/h1')
    ticker = driver.find_element(By.XPATH, '//div[@class="csr109"]/p[1]')
    logging.info(f"ticker by.xpath {ticker.text}")

    description = driver.find_element(By.CLASS_NAME, 'csr127')
    logging.info(f"description {description.text}")

    exchange = driver.find_element(By.CLASS_NAME, 'csr128')
    logging.info(f"exchange {exchange.text}")

    last_price = driver.find_element(By.CLASS_NAME, 'csr112')
    logging.info(f"last_price {last_price.text}")

    #price_change_decimal = driver.find_elements(By.CLASS_NAME, 'csr115')
    #if len(price_change_decimal) >= 2:
    #    logging.info(f"price change {price_change_decimal[0].text} {price_change_decimal[1].text}")
    #else:
    #    logging.warning("Could not find two price change elements on the page.")

    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
    logging.info(f"price_change_decimal {price_change_decimal.text}")

    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
    logging.info(f"price_change_percent {price_change_percent.text}")

    price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
    logging.info(f"price_datetime {price_datetime.text}")

    open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
    logging.info(f"open_price {open_price.text}")

    prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
    logging.info(f"prev_close_price {prev_close_price.text}")

    high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
    logging.info(f"high_price {high_price.text}")

    low_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[2]/DIV[2]')
    logging.info(f"low_price {low_price.text}")

    volume = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[1]/DIV[2]')
    logging.info(f"volume {volume.text}")

    turnover = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[3]/DIV[2]/DIV[2]')
    logging.info(f"turnover {turnover.text}")

    fiftytwo_week_high = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[1]/DIV[2]')
    logging.info(f"fiftytwo_week_high {fiftytwo_week_high.text}")

    fiftytwo_week_low = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[4]/DIV[2]/DIV[2]')
    logging.info(f"fiftytwo_week_low {fiftytwo_week_low.text}")

    market_cap = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[1]/DIV[2]')
    logging.info(f"market_cap {market_cap.text}")

    label = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[1]')
    #logging.info(f"label {label.text}")
    if "YTD YIELD" in label.text:
        #logging.info("YTD Yield.")
        ytd_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
        logging.info(f"ytd_yield {ytd_yield.text}")
    else:
        #logging.info("PE Ratio.")
        price_to_earnings_ttm = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
        logging.info(f"price_to_earnings_ttm {price_to_earnings_ttm.text}")
logging.info("Done.\n")

driver.quit()
