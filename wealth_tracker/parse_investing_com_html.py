#!/usr/bin/env python3
import logging
import os
from bs4 import BeautifulSoup
import argparse
from datetime import datetime
from .update_cell_in_numbers import update_numbers
from .publish_to_kafka import publish_to_kafka

from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from .is_number import is_number
import json

def parse_watchlist_table(html_content):
    logging.info("parse_watchlist_table")
    capture_time = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"
    soup = BeautifulSoup(html_content, 'html.parser')
    specific_rows_json = []
    table = soup.select_one('[id^="tbody_overview_"]')
    if not table:
        print("No table found in the HTML.")
        return specific_rows_json
    else:
        logging.info(f"Found table")

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

    model_tickers = [{"target":"BKLC", "source":"VOO", "percent_change": None},
                      {"target":"QQUP", "source":"QLD", "percent_change": None}]

    for row in table.find_all('tr'):
        cols = row.find_all('td')
        row_data = {}
        for col in cols:
            column_name = col.get('data-column-name')
            if column_name in required_columns:
                row_data[column_name] = col.get_text(strip=True)

        if set(row_data.keys()) == required_columns:
            specific_rows_json.append(row_data)
            current_time = datetime.now().time()

            data = {}
            data["key"] = row_data["symbol"]
            data["last_price"] = row_data["last"]
            data["source"] = "investing"
            data["previous_price"] = row_data["prev"]
            data["capture_time"] = capture_time

            qt = row_data["time"]
            try:
                if qt and len(qt) == 8 and qt.count(":") == 2:
                    now = datetime.now()
                    if now.weekday() == 5:
                        friday = now.replace(day=now.day - 1)
                        today = friday.strftime("%Y-%m-%d")
                    elif now.weekday() == 6:
                        friday = now.replace(day=now.day - 2)
                        today = friday.strftime("%Y-%m-%d")
                    else:
                        today = now.strftime("%Y-%m-%d")
                    qt_full = f"{today} {qt}"
                    data["quote_time"] = qt_full
                else:
                    data["quote_time"] = qt
            except Exception as e:
                logging.error(f"Error parsing quote_time: {e}")
                data["quote_time"] = qt
            data["capture_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            source_ticker = None
            for model_ticker in model_tickers:
                if row_data["symbol"] == model_ticker["target"]:
                    source_ticker = model_ticker
                    break

            if current_time < market_open_time and current_time > pre_market_open_time:
                if source_ticker is None and is_number(row_data["extended_hours"]):
                    data["pre_market_price"] = row_data["extended_hours"]
                elif source_ticker is not None:
                    # percent_change may be None or non-numeric; guard against that
                    pct = source_ticker.get("percent_change")
                    try:
                        if pct is not None and is_number(pct) and is_number(row_data.get("last")):
                            data["pre_market_price"] = (1.0 + (0.01 * float(pct))) * float(row_data["last"])
                            data["source"] = "modeled"
                        else:
                            logging.warning("Cannot model pre_market_price for %s: percent_change=%s last=%s", row_data.get("symbol"), pct, row_data.get("last"))
                    except Exception as e:
                        logging.error(f"Error modeling pre_market_price for {row_data.get('symbol')}: {e}")
            elif (current_time > market_close_time or current_time < pre_market_open_time):
                if source_ticker is None and is_number(row_data["extended_hours"]):
                    data["after_hours_price"] = row_data["extended_hours"]
                elif source_ticker is not None:
                    pct = source_ticker.get("percent_change")
                    try:
                        if pct is not None and is_number(pct) and is_number(row_data.get("last")):
                            data["after_hours_price"] = (1.0 + (0.01 * float(pct))) * float(row_data["last"])
                            data["source"] = "modeled"
                        else:
                            logging.warning("Cannot model after_hours_price for %s: percent_change=%s last=%s", row_data.get("symbol"), pct, row_data.get("last"))
                    except Exception as e:
                        logging.error(f"Error modeling after_hours_price for {row_data.get('symbol')}: {e}")

            logging.info(data)
            update_numbers(data)
            try:
                publish_to_kafka(data)
            except Exception as e:
                logging.error(f"publish_to_kafka error: {e}")

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
        with open(args.file_path, 'r', encoding='utf-8') as file:
            html_content = file.read()
    price_data = parse_watchlist_table(html_content)
    if args.output_file_path != None:
        with open(args.output_file_path, 'w', encoding='utf-8') as file:
            file.write(json.dumps(price_data, indent=4))

if __name__ == "__main__":
    main()
