#!/usr/bin/env python3
import logging
import os
from bs4 import BeautifulSoup
import argparse
from datetime import datetime
from update_cell_in_numbers import update_numbers

# use monitor at investing.com 
# investing.com hsupports multiple watchlists. THe exported html will contain only the first/left watchlist on first load
# but reloading the web page after selecting another watchlist seems to load the correct html
# iCloudDrive/Script Editor/investing_com_export_html.scpt  -> saves html 

def is_number(value):
    try:
        # Attempt to convert to an integer
        int(value)
        return True
    except ValueError:
        try:
            # If integer conversion fails, attempt to convert to a float
            float(value)
            return True
        except ValueError:
            return False
        
def parse_watchlist_table(file_path):
    logging.info("parse_html_for_specific_columns")

    if not os.path.exists(file_path):
        print(f"File does not exist: {file_path}")
        return

    # Step 1: Read the HTML content from the file
    with open(file_path, 'r', encoding='utf-8') as file:
        html_content = file.read()

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
            logging.info(f"row_data {row_data}")
            specific_rows_json.append(row_data)
            # transfer data to object that udpate_cell_in_numbers.py expects
            # Get the current time
            current_time = datetime.now().time()
            pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
            market_open_time = datetime.strptime("09:30", "%H:%M").time()
            market_close_time = datetime.strptime("16:00", "%H:%M").time()

            data = {}
            data["key"] = row_data["symbol"]
            data["last_price"] = row_data["last"]
            data["price_change_decimal"] = row_data["chg"]
            data["price_change_percent"] = row_data["chgpercent"]
            data["source"] = "investing.com mon"
            if current_time < market_open_time and current_time > pre_market_open_time and is_number(row_data["extended_hours"]):
                data["pre_market_price"] = row_data["extended_hours"]
            elif (current_time > market_close_time or current_time < pre_market_open_time) and row_data["extended_hours"] != '--':
                data["after_hours_price"] = row_data["extended_hours"]
            # html dodes not appear to have extended hours fields populated although it is diasplayed
            logging.info(data)
            update_numbers(data)


    return specific_rows_json



def setup_logging(log_level):
    numeric_level = getattr(logging, log_level.upper(), None)
    if not isinstance(numeric_level, int):
        raise ValueError('Invalid log level: %s' % log_level)
    logging.basicConfig(level=numeric_level, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    parser = argparse.ArgumentParser(description="Process investing.com .html file to extract stock data")
    parser.add_argument("--file_path", '-f', type=str, help="Path to the invesing.com .html file")
    parser.add_argument('--log-level', '-l', default='INFO', help='Set the logging level')
    args = parser.parse_args()
    setup_logging(args.log_level)
    
    specific_data = parse_watchlist_table(args.file_path)
    #print(json.dumps(specific_data, indent=4))

if __name__ == "__main__":
    main()
                            