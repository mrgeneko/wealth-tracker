import json
import sys
import subprocess
from datetime import datetime

def run_applescript(script):
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        print("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

def run_shell_command(command):
    """Run the given shell command."""
    try:
        result = subprocess.run(command, check=True)
        # If you need to capture output or handle errors more finely, you can do so here.
    except subprocess.CalledProcessError as e:
        print(f"An error occurred while running the shell command: {e}")

def update_numbers(data):
    #logging.info(f'begin update_numbers {data} ')
    
    numbers_file = "retirement plan.numbers"
    sheet_investments = "Investments"
    table_investments = "T"
    
    if "pre_market_price" not in data and 'after_hours_price' not in data :
        print("no pre market or after hours price")
        if data["last_price"] is not None and data["last_price"] !='':
            print("insert last price")
            price = data["last_price"]
        else:
            return
    else:
        # must be a stock. We should use something more appropriate to determine this
        print("have pre_market or after_hours price keys in data object")
        today = datetime.today()
        day_of_week = today.weekday()
        if day_of_week == 5 or day_of_week == 6:
            if data["last_price"] is not None and data["last_price"] !='':
                print("insert last price")
                price = data["last_price"]
        else:
            # its a week day. Decide if its pre market, during market, or after hours

            # Get the current time
            current_time = datetime.now().time()
            pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
            market_open_time = datetime.strptime("09:30", "%H:%M").time()
            market_close_time = datetime.strptime("16:00", "%H:%M").time()
            #after_hours_close_time = datetime.strptime("04:00", "%H:%M").time()

            # On Saturday and Sunday, should this use the after hours price from Friday?

            # Compare the current time with the target time
            if current_time < market_open_time:
                print(f"The current time is before {market_open_time}")
                if "pre_market_price" in data:
                    if data["pre_market_price"] is not None and data["pre_market_price"] != '':
                        print("insert pre market price")
                        price = data["pre_market_price"]
            elif current_time >= market_open_time and current_time < market_close_time:
                print(f"The current time is between {market_open_time} and {market_close_time}")
                if data["last_price"] is not None and data["last_price"] !='':
                    print("insert last price")
                    price = data["last_price"]

            elif current_time > market_close_time or current_time < pre_market_open_time:
                print(f"The current time is after {market_close_time} or before {pre_market_open_time}")
                if data["after_hours_price"] is not None and data["after_hours_price"] != '':
                    print("insert after hours price")
                    price = data["after_hours_price"]
                else:
                    print("no after hours price. insert last price")
                    price = data["last_price"]



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

                    set key_col to 0
                    repeat with i from 1 to column count
                        if value of cell i of row 1 is "key" then
                            set key_col to i
                            exit repeat
                        end if
                    end repeat
                    if key_col is 0 then error "Key column not found."

                    set rowCount to row count
                    repeat with r from 2 to rowCount
                        set tickerVal to value of cell key_col of row r
                        if tickerVal is not missing value and tickerVal is not "" then
                            {chr(10).join([
                                f'if tickerVal is "{data["key"]}" then set value of cell price_col of row r to "{price}"'
                            ])}
                        end if
                    end repeat
                end tell
            end tell
        end tell
    end tell
    '''

                                    #for ticker, data in prices.items()

    #logging.info(f"script: {script}")
    run_applescript(script)


def main():
    # Read the serialized data from standard input
    serialized_data = sys.stdin.read() #.decode()

    # Deserialize back to a Python object
    my_object = json.loads(serialized_data)

    print(f"Received object: {my_object}")
    update_numbers(my_object)   

if __name__ == "__main__":
    main()