#!/usr/bin/env python3
from datetime import datetime

# Get the current time
current_time = datetime.now().time()
pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
market_open_time = datetime.strptime("09:30", "%H:%M").time()
market_close_time = datetime.strptime("16:00", "%H:%M").time()
#after_hours_close_time = datetime.strptime("04:00", "%H:%M").time()

def is_weekday():
    today = datetime.today()
    day_of_week = today.weekday()
    if day_of_week == 5 or day_of_week == 6:
        return False
    
    return True

def is_pre_market_session():
    # Get the current time
    current_time = datetime.now().time()
    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()
    #after_hours_close_time = datetime.strptime("04:00", "%H:%M").time()

    if current_time < market_open_time and current_time > pre_market_open_time:
        return True
    return False

def is_regular_trading_session():
    current_time = datetime.now().time()
    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()
    #after_hours_close_time = datetime.strptime("04:00", "%H:%M").time()

    if current_time >= market_open_time and current_time < market_close_time:
        return True
    
    return False

def is_after_hours_session():
    current_time = datetime.now().time()
    pre_market_open_time = datetime.strptime("04:00", "%H:%M").time()
    market_open_time = datetime.strptime("09:30", "%H:%M").time()
    market_close_time = datetime.strptime("16:00", "%H:%M").time()
    #after_hours_close_time = datetime.strptime("04:00", "%H:%M").time()

    if current_time > market_close_time or current_time < pre_market_open_time:
        return True
    
    return False