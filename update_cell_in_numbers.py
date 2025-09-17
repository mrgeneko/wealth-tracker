#!/usr/bin/env python3
import json
import logging
import sys
import subprocess
from session_times import *
from datetime import datetime

def run_applescript(script):
    #logging.info(f"run_applescript")
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        logging.error("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

def run_shell_command(command):
    """Run the given shell command."""
    try:
        result = subprocess.run(command, check=True)
        # If you need to capture output or handle errors more finely, you can do so here.
    except subprocess.CalledProcessError as e:
        logging.error(f"An error occurred while running the shell command: {e}")

# update_numbers accepts a dict holding pricing for a single ticker
def update_numbers(data):
    logging.info(f'begin update_numbers {data} ')
    if data == None:
        logging.error("update_numbers was passed data as None")
        return

    numbers_file = "retirement plan.numbers"
    sheet_investments = "Investments"
    table_investments = "T"

    if "source" not in data:
        source = "unknown"
    else:
        source = data["source"]
    
    #price_change_decimal=""
    if "pre_market_price" not in data and 'after_hours_price' not in data :
        logging.info("no pre market or after hours price")
        if data["last_price"] is not None and data["last_price"] !='':
            price = data["last_price"]
        else:
            return
    else:
        #print("have pre_market or after_hours price keys in data object")
        price_change_decimal = ""
        if not is_weekday():
            #logging.info(f"not a weekday")
            if data["after_hours_price"] is not None and data["after_hours_price"] != '':
                price = data["after_hours_price"]
                logging.info(f"{data["key"]} - insert after hours price {price}")
            else:
                if data["last_price"] is not None and data["last_price"] !='':
                    price = data["last_price"]
                    logging.info(f"{data["key"]} - no after hours price. insert last price {price}")
                    #price_change_decimal = data["price_change_decimal"]
        else:
            logging.info(f"is a weekday")
            # should this use the after hours price from Friday?
            if is_pre_market_session():
                logging.info(f"The current time is before {market_open_time}")
                if "pre_market_price" in data:
                    if data["pre_market_price"] is not None and data["pre_market_price"] != '':
                        price = data["pre_market_price"]
                        logging.info(f"{data["key"]} - insert pre_market_price {price}")
                    else:
                        price = data["last_price"]
                        logging.info(f"{data["key"]} - insert last price {price}")
            elif is_regular_trading_session():
                logging.info(f"The current time is between {market_open_time} and {market_close_time}")
                if data["last_price"] is not None and data["last_price"] !='':
                    price = data["last_price"]
                    logging.info(f"{data["key"]} - insert last price {price}")
                #if data["price_change_decimal"] is not None and data["price_change_decimal"] !='':
                #    logging.info("use price_change_decimal")
                    #price_change_decimal = data["price_change_decimal"]

            elif is_after_hours_session():
                logging.info(f"The current time is after {market_close_time} or before {pre_market_open_time}")
                if data["after_hours_price"] is not None and data["after_hours_price"] != '':
                    price = data["after_hours_price"]
                    logging.info(f"{data["key"]} - insert after hours price {price}")
                else:
                    price = data["last_price"]
                    logging.info(f"{data["key"]} - no after hours price. insert last price {price}")
                    #price_change_decimal = data["price_change_decimal"]

    if "previous_price" not in data:
        logging.info("no previous price")
        previous_price = "-1"
    else:
        previous_price = data["previous_price"]

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # THIS SHOULD BE REPLACED BY THE LAST TRADE TIME STAMP!
    #logging.info(f"create applescript {price} {now} {source}")
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

                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Previous Price" then
                            set prev_price_col to i
                            exit repeat
                        end if
                    end repeat
                    if prev_price_col is 0 then error "Previous Price column not found."  

                    set key_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "key" then
                            set key_col to i
                            exit repeat
                        end if
                    end repeat
                    if key_col is 0 then error "Key column not found."

                    set update_time_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Update Time" then
                            set update_time_col to i
                            exit repeat
                        end if
                    end repeat
                    if update_time_col is 0 then error "Update time column not found."

                    set source_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Update Source" then
                            set source_col to i
                            exit repeat
                        end if
                    end repeat
                    if source_col is 0 then error "Source column not found."

                    set rowCount to row count
                    repeat with r from 2 to rowCount
                        set tickerVal to value of cell key_col of row r
                        if tickerVal is not missing value and tickerVal is not "" then
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell price_col of row r to "{price}"'
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell prev_price_col of row r to "{previous_price}"'
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell update_time_col of row r to "{now}"'
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell source_col of row r to "{source}"'
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


def main():
    # Read the serialized data from standard input
    serialized_data = sys.stdin.read() #.decode()

    # Deserialize back to a Python object
    my_object = json.loads(serialized_data)

    logging.info(f"Received object: {my_object}")
    update_numbers(my_object)   

if __name__ == "__main__":
    main()