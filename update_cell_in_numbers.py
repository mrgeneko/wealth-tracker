import json
import sys
import subprocess
import logging

def run_applescript(script):
    process = subprocess.run(["osascript", "-e", script], capture_output=True, text=True)
    if process.returncode != 0:
        print("AppleScript error:", process.stderr)
        return None
    return process.stdout.strip()

def update_numbers(data):
    #logging.info(f'begin update_numbers {data} ')
    numbers_file = "retirement plan.numbers"
    sheet_investments = "Investments"
    table_investments = "T"

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
                                f'if tickerVal is "{data["key"]}" then set value of cell price_col of row r to "{data["last_price"]}"'
                                #for ticker, data in prices.items()
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

    print(f"Received object: {my_object}")
    update_numbers(my_object)   

if __name__ == "__main__":
    main()