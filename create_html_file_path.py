#!/usr/bin/env python3
"""Shim for wealth_tracker.create_html_file_path

Root-level `create_html_file_path.py` was moved into the package. This file
re-exports the package implementation so existing imports continue to work.
"""
from wealth_tracker.create_html_file_path import create_html_file_path

__all__ = ["create_html_file_path"]
