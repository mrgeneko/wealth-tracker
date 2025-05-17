import argparse
from datetime import datetime
import logging
import urllib.parse
import time
import subprocess




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
        logging.info(f"check bond type")
        #return [ticker for ticker in tickers if "bond-" in ticker]
        return [ticker for ticker in tickers if ticker.startswith("bond-")]
    elif include_type == "stocks":
        logging.info(f"check stock type")
        return [ticker for ticker in tickers if "bond-" not in ticker]
    else:
        logging.info(f"allow all type")
        return tickers  # Default: no additional filtering
    
def generate_url(ticker):
    base_url = "https://www.webull.com/quote/{}"
    encoded_ticker = urllib.parse.quote_plus(ticker)
    url = base_url.format(encoded_ticker)
    return url


def main():
    # Configure logging
    logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

    parser = argparse.ArgumentParser(description='Process tickers and update Apple Numbers.')

    # Define the new --input-file (-i) argument for the tickers file path
    parser.add_argument('--input-file', '-i', dest='tickers_file',
                        type=str,
                        default="webull_tickers.txt",
                        help='Path to the tickers file (default: webull_tickers.txt)')
    
    parser.add_argument('--include-type', '-t', dest='include_type', type=str,
                        choices=['stocks', 'bonds'], default='stocks',
                        help='Specify "stocks" to exclude bonds or "bonds" to include only bond lines')
    
    parser.add_argument('--sleep-interval', '-s', dest='sleep_interval',
                    type=int, default=20,
                    help='Seconds to sleep between processing each ticker (default: 20)')

    args = parser.parse_args()

    #tickers_file = "webull_tickers.txt"
    tickers_file = args.tickers_file
    logging.info(f"file: {tickers_file} type: {args.include_type}")
    tickers = read_tickers(tickers_file, include_type=args.include_type)
    logging.info(tickers)
    time.sleep(5)

    for i, ticker in enumerate(tickers):
        url = generate_url(ticker)
        if not url:
            continue

    tickers_file = "webull_tickers.txt"  # Path to your tickers file
    tickers = read_tickers(tickers_file, include_type="stocks")  # or "stocks"
    #logging.info(f"Tickers read from file: {tickers}")
    for i, ticker in enumerate(tickers):
        url = generate_url(ticker)
        if not url:
            continue
     
        # call other script here
        try:
            result = subprocess.run(
                ["python3", "webull_quote.py", "--url", url, "--ticker", ticker],
                capture_output=True,  # Capture standard output and error streams
                text=True, # Decode bytes to string using the default encoding
                check=True # Raise an exception if the subprocess returns a non-zero exit code
                )
        except subprocess.CalledProcessError as e:
            logging.error(f"Error processing ticker {ticker}: {e}")
            continue
        except Exception as e:
            logging.error(f"Unexpected error processing ticker {ticker}: {e}")
            continue
        
        # logging.info(f"Processed ticker {ticker} ({i+1}/{len(tickers)})")
        logging.info(f"result: {result.stdout}")
        
        time.sleep(args.sleep_interval)  # Sleep for the specified interval

if __name__ == "__main__":
    main()
