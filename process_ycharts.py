#!/usr/bin/env python3
"""Root shim for scrapeman.process_ycharts

Re-export the package implementation to keep repository-root imports working.
"""
from scrapeman import process_ycharts as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
    globals()[_name] = getattr(_mod, _name)
#!/usr/bin/env python3
"""Root shim for scrapeman.process_ycharts

Re-export the package implementation to keep repository-root imports working.
"""
from scrapeman import process_ycharts as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
    globals()[_name] = getattr(_mod, _name)
#!/usr/bin/env python3
"""Root shim for scrapeman.process_ycharts

Re-export the package implementation to keep repository-root imports working.
"""
from scrapeman import process_ycharts as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
    globals()[_name] = getattr(_mod, _name)

def get_ycharts_attributes():
    attributes = {
        "name" : "ycharts",
        "download" : "singlefile",
        "process" : process_ycharts,
        "extract" : extract_ycharts,
        "has_realtime" : True,
        "has_pre_market" : True,
        "has_after_hours" : True,
        "has_bond_prices" : False,
        "has_stock_prices" : True,
        "has_previous_close" : False,
        "hits" : 0
    }
    return attributes


def extract_ycharts(ticker,html_content):
    logging.info(f"extract ycharts")

    #logging.info(f"html_content: {html_content}")

    soup = BeautifulSoup(html_content, 'html.parser')
    last_price = ""
    after_hours_price = ""
    pre_market_price = ""

    last_price_element = soup.select_one('[class="index-rank-value"]')
    #price_normal_element = quote_element.select_one('[class="price-normal"]')
    #last_price_element = price_normal_element.select_one('[class="mg-r-8 price direct-up"]')
    if last_price_element != None:
        last_price = last_price_element.text
        logging.info(f'last price element: {last_price}')
    else:
        logging.info(f'last price element not')
            
    price_change_decimal = ""
    price_change_percent = ""
    parent_price_element = soup.select_one('[class="index-rank col-auto"]')
    price_change_parent_element = parent_price_element.select_one('[class="index-change index-change-up"]')
    if price_change_parent_element != None:
        #logging.info(f"found price_change_parent_element {price_change_parent_element}")
        # Find all elements with class "valNeg"
        val_neg_elements = price_change_parent_element.find_all('span', class_='valNeg')
        if val_neg_elements != None and len(val_neg_elements)>0:
            logging.info(f"val neg {val_neg_elements[0].text} {val_neg_elements[1].text}")
            price_change_decimal = val_neg_elements[0].text
            logging.info(f"price_change_decimal: {price_change_decimal}")
            price_change_percent = val_neg_elements[1].text
            logging.info(f"price_change_percent: {price_change_percent}")

        if price_change_decimal == "" and price_change_percent == "":
            val_pos_elements = price_change_parent_element.find_all('span', class_='valPos')
            if val_pos_elements != None and len(val_pos_elements)>0:
                logging.info(f"val pos {val_pos_elements[0].text} {val_pos_elements[1].text}")
                price_change_decimal = val_pos_elements[0].text
                logging.info(f"price_change_decimal: {price_change_decimal}")
                #!/usr/bin/env python3
                """Root shim for scrapeman.process_ycharts

                Re-export the package implementation to keep repository-root imports working.
                """
                from scrapeman import process_ycharts as _mod

                __all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
                for _name in __all__:
                    globals()[_name] = getattr(_mod, _name)
            logging.info(f"price_change_percent: {price_change_percent}")


