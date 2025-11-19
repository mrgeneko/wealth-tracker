#!/usr/bin/env python3
import time
import subprocess
import yfinance as yf
from datetime import datetime
import logging
import pandas as pd
from .session_times import *
import pprint

numbers_file = "retirement plan.numbers"
sheet_investments = "Investments"
table_investments = "T"

def get_yahoo_attributes():
    from .scraper_config import get_attributes as _get_config_attrs
    attributes = _get_config_attrs('yahoo') or {}
    # attach callable references
    attributes['process'] = process_yahoo
    attributes['extract'] = extract_yahoo
    return attributes

def run_applescript(script):
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        print("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

def get_stock_tickers_from_numbers():
    script = f'''
    tell application "Numbers"
        tell document "{numbers_file}"
            tell sheet "{sheet_investments}"
                tell table "{table_investments}"
                    set stock_row to 0
                    repeat with i from 1 to row count
                        if value of cell 1 of row i is "Stocks" then
                            set stock_row to i + 2
                            exit repeat
                        end if
                    end repeat
                    if stock_row is 0 then error "Stock row not found."

                    set tickerList to ""
                    repeat with i from stock_row to row count
                        set tickerVal to value of cell 1 of row i
                        if tickerVal is not missing value and tickerVal is not "" then
                            set tickerList to tickerList & tickerVal & "\n"
                        else
                            exit repeat
                        end if
                    end repeat
                    return tickerList
                end tell
            end tell
        end tell
    end tell
    '''
    output = run_applescript(script)
    tickers = output.strip().split("\n") if output else []
    tickers = [t.strip() for t in tickers if t.strip()]
    print("Tickers fetched:", tickers)
    return tickers


def extract_yahoo(ticker,html_content):
    logging.info(f"extract_yahoo for {ticker}")
    try:    
        yfdata = yf.Ticker(ticker)
        if yfdata == None:
            logging.error(f"error: yf.Ticker returned None")
            return None
    except Exception as e:
        logging.error(f"extract_yahoo error fetching {ticker}: {e}")
        return None
    
    info = yfdata.info
    #pprint.pprint(info)

    price = info.get("regularMarketPrice")
    pre_market_price = ""
    after_hours_price = ""
    if not is_weekday():
        after_hours_price = info.get("postMarketPrice")
    elif is_pre_market_session():
        pre_market_price = info.get("preMarketPrice")
    elif is_after_hours_session():
        after_hours_price = info.get("postMarketPrice")

    previous_close_price = info.get("previousClose")

    data = {
        "key": ticker,
        "last_price": price,
        "pre_market_price": pre_market_price if pre_market_price is not None else "",
        "after_hours_price": after_hours_price if after_hours_price is not None else "",
        "previous_close_price": previous_close_price if previous_close_price is not None else "",
        "source" : "yahoo"
    }

    logging.info(f"Fetched price for {ticker} {data}")
    return data


def fetch_prices(tickers):
    prices = {}
    price_data = []
    for ticker in tickers:
        try:
            data = yf.Ticker(ticker)
            info = data.info
            logging.info(f'fetch_prices info object:',info)

            price = info.get("regularMarketPrice")
            price_change_decimal = info.get("regularMarketChange")
            previous_close_price = info.get("regularMarketPreviousClose")
            after_hours_price = info.get("postMarketPrice")

            single_ticker = {
                "key": ticker,
                "last_price": price,
                "price_change_decimal": round(price_change_decimal,4) if price_change_decimal is not None else "N/A",
                "previous_close_price": round(previous_close_price,4) if previous_close_price is not None else "N/A",
                "pre_market_price": "",
                "after_hours_price": round(after_hours_price,4) if after_hours_price is not None else "N/A",
                "source" : "yahoo"
            }
            price_data.append(single_ticker)
            logging.info(f"Fetched price for {ticker} {single_ticker}")
            time.sleep(2)
        except Exception as e:
            print(f"Error fetching {ticker}: {e}")
    return price_data


def process_yahoo_with_tickers_from_numbers(driver,tickers,function_handlers,sleep_interval):
    tickers_from_numbers = get_stock_tickers_from_numbers()
    data = fetch_prices(tickers_from_numbers)
    for ticker in data:
        function_handlers[0](ticker)
    

def process_yahoo(driver,tickers,function_handlers,sleep_interval):
    logging.info(f"process_yahoo")

    column_selection = 'yahoo'
    for i, ticker in enumerate(tickers):
        if column_selection in ticker:
            logging.debug(f"Key {ticker['key']} has url: {ticker[column_selection]}")
        else:
            logging.debug(f"Key {column_selection} does not exist in this object.")

        if not pd.isna(ticker[column_selection]):
            logging.debug(f"Key {ticker['key']} has value: {ticker[column_selection]}")
        else:
            logging.debug(f"Key {column_selection} does not have a value or has NaN.")
            continue

        single_ticker = [ticker[column_selection]]
        logging.info(f"yahoo fetch_prices for {ticker[column_selection]}")
        data = fetch_prices(single_ticker)
        logging.info(f"yahoo send to numbers data:{data}\n")
        function_handlers[0](data[0])
        time.sleep(sleep_interval)
