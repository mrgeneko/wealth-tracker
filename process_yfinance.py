#!/usr/bin/env python3
import time
import subprocess
import yfinance as yf
from datetime import datetime

numbers_file = "retirement plan.numbers"
#sheet_stock_prices = "StockPrices"
#table_stock_prices = "Table 1"
sheet_investments = "Investments"
table_investments = "T"

def run_applescript(script):
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        print("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

# Assumes Numbers file is already open.
# Yahoo finance ticker list must be in column 'A' and
# begins with 'Stocks' header and a row below for 'Cash' which is ignored.
def get_tickers_from_numbers():
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
                            set tickerList to tickerList & tickerVal & "\\n"
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



def fetch_prices(tickers):
    # it may be possible to change this loop to retrieve all tickers in a single request
    prices = {}
    for ticker in tickers:
        try:
            
            data = yf.Ticker(ticker)
            info = data.info
            #print(f'info object:',info)
            example='''
            info object: {'longBusinessSummary': 'Under normal market conditions, the fund generally invests substantially all, but at least 80%, of its total assets in the securities comprising the index. The index is designed to measure the performance of the large-capitalization segment of the U.S. equity market.',
              'companyOfficers': [], 'executiveTeam': [], 'maxAge': 86400, 'priceHint': 2, 'previousClose': 68.57,
                'open': 67.74, 'dayLow': 67.7, 'dayHigh': 68.425, 'regularMarketPreviousClose': 68.57, 'regularMarketOpen': 67.74,
                  'regularMarketDayLow': 67.7, 'regularMarketDayHigh': 68.425, 'trailingPE': 25.239775, 'volume': 6445925,
                    'regularMarketVolume': 6445925, 'averageVolume': 12145171, 'averageVolume10days': 7060870,
                      'averageDailyVolume10Day': 7060870, 'bid': 68.1, 'ask': 68.11, 'bidSize': 40, 'askSize': 22,
                        'yield': 0.0137, 'totalAssets': 61824921600, 'fiftyTwoWeekLow': 56.67, 'fiftyTwoWeekHigh': 72.14,
                          'fiftyDayAverage': 65.4332, 'twoHundredDayAverage': 67.72, 'navPrice': 68.56803, 'currency': 'USD',
                            'tradeable': False, 'category': 'Large Blend', 'ytdReturn': -4.92252, 'beta3Year': 1.0,
                              'fundFamily': 'SPDR State Street Global Advisors', 'fundInceptionDate': 1131408000, 'legalType': 'Exchange Traded Fund',
                              'threeYearAverageReturn': 0.1612789, 'fiveYearAverageReturn': 0.1633566, 'quoteType': 'ETF', 'symbol': 'SPLG', 'language': 'en-US',
                                'region': 'US', 'typeDisp': 'ETF', 'quoteSourceName': 'Nasdaq Real Time Price', 'triggerable': True, 'customPriceAlertConfidence': 'HIGH',
                                  'dividendYield': 1.37, 'trailingThreeMonthReturns': -7.49607, 'trailingThreeMonthNavReturns': -7.49607, 'netAssets': 61824922000.0,
                                    'epsTrailingTwelveMonths': 2.6993108, 'fiftyDayAverageChange': 2.6968002, 'fiftyDayAverageChangePercent': 0.041214556,
                                      'twoHundredDayAverageChange': 0.40999603, 'twoHundredDayAverageChangePercent': 0.0060542827, 'netExpenseRatio': 0.02,
                                        'sourceInterval': 15, 'exchangeDataDelayedBy': 0, 'cryptoTradeable': False, 'hasPrePostMarketData': True,
                                          'firstTradeDateMilliseconds': 1132065000000, 'exchange': 'PCX', 'messageBoardId': 'finmb_25497858', 'exchangeTimezoneName': 'America/New_York',
                                            'exchangeTimezoneShortName': 'EDT', 'gmtOffSetMilliseconds': -14400000, 'market': 'us_market', 'esgPopulated': False, 'marketState': 'POST',
                                              'shortName': 'SPDR Portfolio S&P 500 ETF', 'longName': 'SPDR Portfolio S&P 500 ETF', 'corporateActions': [], 'postMarketTime': 1748033221,
                                                'regularMarketTime': 1748030400, 'regularMarketChangePercent': -0.641684, 'regularMarketPrice': 68.13,
                                                  'postMarketChangePercent': -0.13209502, 'postMarketPrice': 68.04, 'postMarketChange': -0.08999634, 'regularMarketChange': -0.440002,
                                                    'regularMarketDayRange': '67.7 - 68.425', 'fullExchangeName': 'NYSEArca', 'averageDailyVolume3Month': 12145171,
                                                      'fiftyTwoWeekLowChange': 11.459999, 'fiftyTwoWeekLowChangePercent': 0.20222339, 'fiftyTwoWeekRange': '56.67 - 72.14',
                                                        'fiftyTwoWeekHighChange': -4.010002, 'fiftyTwoWeekHighChangePercent': -0.05558639, 'fiftyTwoWeekChangePercent': 10.081875,
                                                          'trailingPegRatio': None}
            '''

            price = info.get("regularMarketPrice")
            price_change_decimal = info.get("regularMarketChange")
            previous_close_price = info.get("regularMarketPreviousClose")

            prices[ticker] = {
                "price": price,
                "price_change_decimal": round(price_change_decimal,4) if price_change_decimal is not None else "N/A",
                "previous_close_price": round(previous_close_price,4) if previous_close_price is not None else "N/A"
            }
            
            print(f"Fetched price for {ticker} {prices[ticker]}")
            time.sleep(3)
        except Exception as e:
            print(f"Error fetching {ticker}: {e}")
    return prices

def update_numbers(prices):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ticker_rows = list(prices.items())
    
    updates = []

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

                    set update_time_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Update Time" then
                            set update_time_col to i
                            exit repeat
                        end if
                    end repeat
                    if update_time_col is 0 then error "Update time column not found."

                    set stock_row to 0
                    repeat with i from 1 to row count
                        if value of cell 1 of row i is "Stocks" then
                            set stock_row to i + 2
                            exit repeat
                        end if
                    end repeat
                    if stock_row is 0 then error "Stock row not found."

                    set price_change_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Price Change" then
                            set price_change_col to i
                            exit repeat
                        end if
                    end repeat
                    if price_change_col is 0 then error "Price change column not found."   

                    set previous_close_price_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Previous Close" then
                            set previous_close_price_col to i
                            exit repeat
                        end if
                    end repeat
                    if previous_close_price_col is 0 then error "Previous Close Price column not found."                      

                    set source_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "Update Source" then
                            set source_col to i
                            exit repeat
                        end if
                    end repeat
                    if source_col is 0 then error "Source column not found."
                    
                    set rowCount to row count
                    repeat with r from stock_row to rowCount
                        set tickerVal to value of cell 1 of row r
                        if tickerVal is not missing value and tickerVal is not "" then
                            {chr(10).join([
                                f'if tickerVal is "{ticker}" then set value of cell price_col of row r to "{data["price"]}"'
                                for ticker, data in prices.items()
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{ticker}" then set value of cell previous_close_price_col of row r to "{data["previous_close_price"]}"'
                                for ticker, data in prices.items()
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{ticker}" then set value of cell update_time_col of row r to "{now}"'
                                for ticker, data in prices.items()
                            ])}
                            {chr(10).join([
                                f'if tickerVal is "{ticker}" then set value of cell source_col of row r to "yfinance"'
                                for ticker, data in prices.items()
                            ])}
                        end if
                    end repeat
                end tell
            end tell
        end tell
    end tell
    '''

#        {chr(10).join([
#        f'if tickerVal is "{ticker}" then set value of cell price_change_col of row r to "{data["price_change_decimal"]}"'
#        for ticker, data in prices.items()
#    ])}
    run_applescript(script)

def process_yfinance(driver,tickers,function_handlers,sleep_interval):
    tickers_from_numbers = get_tickers_from_numbers()
    prices = fetch_prices(tickers_from_numbers)
    update_numbers(prices)