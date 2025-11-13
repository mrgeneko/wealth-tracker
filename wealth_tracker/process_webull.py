#!/usr/bin/env python3
import logging
from datetime import datetime
from bs4 import BeautifulSoup
from .is_number import is_number

def get_webull_attributes():
    attributes = {
        "name" : "webull",
        "download" : "singlefile",
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

def extract_webull(ticker, html_content):
    logging.info(f"extract_webull for {ticker}")
    #logging.info(html_content)
    soup = BeautifulSoup(html_content, 'html.parser')


    if "YIELD" in html_content and "MATURITY" in html_content:
        logging.info(f"detected BOND")
        # Extract last price: try csr121 csr117, then csr120 csr117
        last_price_tag = soup.find('div', class_='csr121 csr117')
        last_price = last_price_tag.get_text(strip=True) if last_price_tag else ""
        if last_price == "":
            last_price_tag = soup.find('div', class_='csr120 csr117')
            last_price = last_price_tag.get_text(strip=True) if last_price_tag else ""
        if last_price == "":
            logging.info("Webull: last_price not found in HTML.")
            logging.info(html_content)

        # Extract price change decimal and percent (class csr136 contains two csr121 or csr120 divs)
        price_change_decimal = ""
        price_change_percent = ""
        price_change_container = soup.find('div', class_='csr136')
        if price_change_container:
            change_tags = price_change_container.find_all('div', class_='csr121')
            if len(change_tags) < 2:
                change_tags = price_change_container.find_all('div', class_='csr120')
            if len(change_tags) >= 2:
                price_change_decimal = change_tags[0].get_text(strip=True)
                price_change_percent = change_tags[1].get_text(strip=True)

        previous_close_price = ""
        try:
            if last_price and price_change_decimal:
                previous_close_price = str(round(float(last_price) - float(price_change_decimal), 6))
        except Exception as e:
            logging.warning(f"Could not calculate previous_close_price: {e}")

    else:
        logging.info(f"detected STOCK")

        # Try to find last price in div.csr120.csr117 (Webull stock quote)
        last_price = ""
        last_price_element = soup.select_one('div.csr120.csr117')
        if last_price_element:
            last_price = last_price_element.get_text(strip=True)
            logging.info(f'last price element found in csr120 csr117: {last_price}')
        else:
            # Fallback to previous selectors for legacy or bond pages
            last_price_element = soup.select_one('div.csr115.csr112')
            if last_price_element:
                last_price = last_price_element.get_text(strip=True)
                logging.info(f'last price element found in csr115 csr112: {last_price}')
            else:
                last_price_element = soup.select_one('div.csr116.csr112')
                if last_price_element:
                    last_price = last_price_element.get_text(strip=True)
                    logging.info(f'last price element found in csr116 csr112: {last_price}')
                else:
                    last_price_element = soup.select_one('div.csr114.csr112')
                    if last_price_element:
                        last_price = last_price_element.get_text(strip=True)
                        logging.info(f'last price element found in csr114 csr112: {last_price}')
        if not last_price:
            logging.info('Webull: last_price not found in HTML.')


        # Parse pre-market price from div.csr137 containing 'Pre Market'
        pre_market_price = ""
        pre_market_price_change = ""
        pre_market_price_change_percent = ""
        price_change_decimal = ""
        price_change_percent = ""
        pre_market_found = False
        pre_market_divs = soup.find_all('div', class_='csr137')
        for div in pre_market_divs:
            if "Pre Market" in div.get_text():
                span = div.find('span', class_='csr121')
                if span:
                    parts = span.get_text(strip=True).split(' ')
                    if len(parts) >= 3:
                        pre_market_price = parts[0]
                        pre_market_price_change = parts[1]
                        pre_market_price_change_percent = parts[2]
                        logging.info(f'Parsed pre_market_price: {pre_market_price}')
                        logging.info(f'Parsed pre_market_price_change: {pre_market_price_change}')
                        logging.info(f'Parsed pre_market_price_change_percent: {pre_market_price_change_percent}')
                        price_change_decimal = pre_market_price_change
                        price_change_percent = pre_market_price_change_percent
                        pre_market_found = True
                break

        # If not pre-market, parse price change next to last price
        if not pre_market_found:
            # Find the container div.csr116 (parent of last price and change)
            price_change_container = None
            # Try to find the parent of last price
            last_price_tag = soup.find('div', class_='csr120 csr117')
            if last_price_tag:
                parent = last_price_tag.find_parent('div', class_='csr116')
                if parent:
                    price_change_container = parent.find('div', class_='csr136')
            if not price_change_container:
                price_change_container = soup.find('div', class_='csr136')
            if price_change_container:
                change_tags = price_change_container.find_all('div', class_='csr120')
                if len(change_tags) >= 2:
                    price_change_decimal = change_tags[0].get_text(strip=True)
                    price_change_percent = change_tags[1].get_text(strip=True)
                else:
                    # Try csr121
                    change_tags = price_change_container.find_all('div', class_='csr121')
                    if len(change_tags) >= 2:
                        price_change_decimal = change_tags[0].get_text(strip=True)
                        price_change_percent = change_tags[1].get_text(strip=True)

        # Only parse previous_close_price for stocks
        previous_close_price = ""
        prev_close_divs = soup.find_all('div', class_='csr140')
        for div in prev_close_divs:
            label = div.find('div', class_='csr143')
            value = div.find('div', class_='csr142')
            if label and value and label.get_text(strip=True).upper() == "PREV CLOSE":
                previous_close_price = value.get_text(strip=True)
                logging.info(f'Parsed previous_close_price: {previous_close_price}')
                break
    
    data = {
        "key": ticker,
        "last_price": last_price,
        "price_change_decimal": price_change_decimal,
        "price_change_percent": price_change_percent,
        "after_hours_price": "",
        "pre_market_price": pre_market_price,
        "previous_close_price": previous_close_price,
        "source": "webull"
    }
    logging.info(data)
    return data
