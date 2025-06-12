#!/usr/bin/env python3
 
import logging
import time
import pandas as pd
from selenium.webdriver.common.by import By
from bs4 import BeautifulSoup

def get_webull_attributes():
    attributes = {
        "name" : "webull",
        "process" : process_webull,
        "extract" : extract_webull,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : True,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes

def extract_webull(ticker,html_content):
    logging.info(f"extract webull")

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

def process_webull(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"process_webull for {tickers[0]}")
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
        logging.info(f'Webull - begin processing: {key} selected url: {url}')
        
        driver.get(url)
        logging.info(f'sleep 2 seconds to allow website to load')
        time.sleep(2)

        # Wait for a specific element to be present (e.g., an element with ID 'example')
        #wait = WebDriverWait(driver, 10)
        #element = wait.until(EC.presence_of_element_located((By.ID, 'example')))
        
        #html_content = driver.page_source

        try:
            logging.info(f"Process xpaths for {url}")
            if "bond" in url:
                logging.info(f"Process bond quote page: {url}")

                description = driver.find_element(By.CLASS_NAME, 'csr124')
                logging.info(f"description {description.text}")

                cusip = driver.find_element(By.CLASS_NAME, 'csr125')
                logging.info(f"cusip {cusip.text}")

                last_price = driver.find_element(By.CLASS_NAME, 'csr112')
                logging.info(f"last_price {last_price.text}")

                price_change_decimal = ""
                try:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
                except Exception as e:
                    logging.info("price_change_decimal not found in csr115")

                if price_change_decimal == "":
                    try:
                        price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][1]")
                        logging.info(f"price_change_decimal {price_change_decimal.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr116")

                if price_change_decimal == "":
                    try:
                        price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr117')][1]")
                        logging.info(f"price_change_decimal {price_change_decimal.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr117")  

                price_change_percent = ""
                try:
                    price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
                except Exception as e:
                    logging.info("price_change_decimal not found in csr115") 

                if price_change_percent == "":
                    try:
                        price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][2]")
                        logging.info(f"price_change_percent {price_change_percent.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr116")

                if price_change_percent == "":
                    try:
                        price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr117')][2]")
                        logging.info(f"price_change_percent {price_change_percent.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr116")

                

                price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
                logging.info(f"price_datetime {price_datetime.text}")

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
                logging.info(f"last_price {last_price.text}")

                price_change_decimal = ""
                comment='''
                try:
                    price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][1]")
                    logging.info(f"price_change_decimal {price_change_decimal.text}")
                except Exception as e:
                    logging.info("price_change_decimal not found in csr115[1]")

                if price_change_decimal == "":
                    try:
                        price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr116')][1]")
                        logging.info(f"price_change_decimal {price_change_decimal.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr116[1]")

                if price_change_decimal == "":
                    try:
                        price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr115')][2]")
                        logging.info(f"price_change_percent {price_change_percent.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr115[2]")

                if price_change_percent == "":
                    try:
                        price_change_percent = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr117')]")
                        logging.info(f"price_change_percent {price_change_percent.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr117")

                if price_change_decimal == "":
                    try:
                        price_change_decimal = driver.find_element(By.XPATH, "//div[contains(@class, 'csr111')]/div[contains(@class, 'csr131')]/div[contains(@class, 'csr117')][2]")
                        logging.info(f"price_change_decimal {price_change_decimal.text}")
                    except Exception as e:
                        logging.info("price_change_decimal not found in csr117[1]")
'''
                price_datetime = driver.find_element(By.CLASS_NAME, 'csr132')
                logging.info(f"price_datetime {price_datetime.text}")

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

                
                logging.info(f"after_hours_price {after_hours_price}")
                logging.info(f"after_hours_price_change_decimal {after_hours_price_change_decimal}")
                logging.info(f"after_hours_price_change_percent {after_hours_price_change_percent}")    

                open_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[1]/DIV[2]')
                logging.info(f"open_price {open_price.text}")

                prev_close_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[1]/DIV[2]/DIV[2]')
                logging.info(f"prev_close_price {prev_close_price.text}")

                high_price = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[2]/DIV[1]/DIV[2]')
                logging.info(f"high_price {high_price.text}")

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
                logging.info(f"label {label.text}")
                
                if "YTD YIELD" in label.text:
                    logging.info("YTD Yield.")
                    ytd_yield = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
                    logging.info(f"ytd_yield {ytd_yield.text}")
                    price_to_earnings_ttm = ""
                else:
                    logging.info("PE Ratio.")
                    price_to_earnings_ttm = driver.find_element(By.XPATH, '//*[@id="app"]/SECTION[1]/DIV[1]/DIV[1]/DIV[2]/DIV[2]/DIV[1]/DIV[5]/DIV[2]/DIV[2]')
                    logging.info(f"price_to_earnings_ttm {price_to_earnings_ttm.text}")
                    ytd_yield = ""
                    
                data = {
                    "key": key,
                    "url": url,
                    "source":"webull.com",
                    "ticker": ticker.text,
                    "description": description.text,
                    "exchange": exchange.text,
                    "last_price": last_price.text,
                    #"price_change_decimal": price_change_decimal.text,
                    #"price_change_percent": price_change_percent.text,
                    "price_datetime": price_datetime.text,
                    "after_hours_price": after_hours_price,
                    #"after_hours_price_change_decimal": after_hours_price_change_decimal,
                    #"after_hours_price_change_percent": after_hours_price_change_percent,
                    "pre_market_price": pre_market_price,
                    #"pre_market_price_change_decimal": pre_market_price_change_decimal,
                    #"pre_market_price_change_percent": pre_market_price_change_percent,
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
            logging.error('Exception processing xpath')
        
        logging.info(f"result: {data}")
        function_handlers[0](data)

    return 0

