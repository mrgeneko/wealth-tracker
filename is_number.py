#!/usr/bin/env python3

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
        