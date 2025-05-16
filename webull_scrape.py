from datetime import datetime
import logging
import urllib.parse
import time
import subprocess

# Configure logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

def read_tickers(file_path):
    with open(file_path, 'r') as file:
        tickers = [
            line.strip()
            for line in file
            if line.strip() and not line.strip().startswith('#')
        ]
    return tickers

def generate_url(ticker):
    base_url = "https://www.webull.com/quote/{}"
    encoded_ticker = urllib.parse.quote_plus(ticker)
    url = base_url.format(encoded_ticker)
    return url


def main():
    tickers_file = "webull_tickers.txt"  # Path to your tickers file
    tickers = read_tickers(tickers_file)
    #logging.info(f"Tickers read from file: {tickers}")
    for i, ticker in enumerate(tickers):
        url = generate_url(ticker)
        if not url:
            continue
     
        # call other script here
        subprocess.run(["python3", "webull_quote.py", "--url", url, "--ticker", ticker], check=True)
        time.sleep(2)

        # Log progress
        logging.info(f"Processed ticker {ticker} ({i+1}/{len(tickers)})")

if __name__ == "__main__":
    main()
