#!/usr/bin/env python3
"""Compatibility shim: run the package module as a script.

This file was previously a top-level implementation. The canonical
implementation now lives in `wealth_tracker.parse_investing_com_html`.
Keeping this shim preserves scripts/users that call the top-level
file directly.
"""
import runpy


if __name__ == "__main__":
    # Execute the package module as __main__ so its argparse/main() runs
    runpy.run_module("wealth_tracker.parse_investing_com_html", run_name="__main__")
