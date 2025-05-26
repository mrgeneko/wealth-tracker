import pdfplumber
import pprint
import os
import argparse
from update_cell_in_numbers import update_numbers

# use monitor at investing.com 
# iCloudDrive/Script Editor/investing_com_export_pdf.scpt  -> saves pdf to /Users/gene/logs/

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
        
def process_investing_com_pdf(file_path):
    if not os.path.exists(file_path):
        print(f"File does not exist: {file_path}")
        return
    
    #pp = pprint.PrettyPrinter(indent=4)
    data = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            
            # Extract tables from each page
            tables = page.extract_tables()
            for table in tables:
                print("------------")
                print(table)
                print("------------")
                #if table[0][0].startswith("My Watchlist"):
                found=False
                for row in table:
                    print(f"check row: {row}")
                    if found:
                        # check to see if we have gone beyond the table rows holding ticker data
                        if row[0] != None:
                            if "\n" in row[0]:
                                print("detected end of table \\n")
                                break
                            if "Reuters" in row[0]:
                                print("detected end of table (Reuters)")
                                break
                            if "News" in row[0] or "news" in row[0] or "story" in row[0]:
                                print("detected end of table [News/news/story]")
                                break


                        # pdf plumber is a bit inconsistent with creating rows and columns
                        # we'll need two strategies to parsing this data
                        if len(row[0]) > 20:
                            parts = row[0].split()
                            #print(f"parts[1]:{parts[1]}")
                            if is_number(parts[1]):
                                last_price = parts[1]
                            else:
                                last_price = None

                            if is_number(parts[5]):
                                price_change_decimal = parts[5]
                            else:
                                price_change_decimal = None
                            
                            if len(parts) == 9:
                                price_datetime = parts[8]
                            else:
                                price_datetime = ""
                            
                            if "%" in parts[6]:
                                price_change_percent = parts[6]
                            else:
                                price_change_percent = ""

                            print(f"parts: {parts}")
                            stock = { "key" : parts[0],
                                    "source" : "investing.com mon",
                                    "last_price" : last_price,
                                    "price_change_decimal" : price_change_decimal,
                                    "price_change_percent" : price_change_percent,
                                    #"extended_hours_price" : parts[2],
                                    #"extended_hours_price_change_decimal" : parts[4],
                                    #"previous_close_price" : parts[5],
                                    "volume" : parts[7],
                                    "price_datetime" : price_datetime
                                    }
                            print(f"stock {stock}")
                            data.append(stock)
                        elif len(row[0]) == 0:
                            stock = { "key" : row[5],
                                    "source" : "investing.com mon",
                                    "last_price" : row[6],
                                    "price_change_decimal" : row[11],
                                    "price_change_percent" : row[12],
                                    #"extended_hours_price" : "",
                                    #"extended_hours_price_change_decimal" : "",
                                    #"previous_close_price" : "",
                                    "volume" : row[14],
                                    "price_datetime" : row[15]
                                    }
                            print(f"stock {stock}")
                            data.append(stock)
                        update_numbers(stock)
                    if row[0] != None:
                        if "Symbol" in row[0] and "Last" in row[0]:
                            print(f"found header row {row}")
                            found=True

#    pp.pprint(data)


def main():
    parser = argparse.ArgumentParser(description="Process investing.com .pdf file to extract stock data")
    parser.add_argument("--file_path", '-f', type=str, help="Path to the invesing.com .pdf file")
    args = parser.parse_args()
    process_investing_com_pdf(args.file_path)

if __name__ == "__main__":
    main()
                            