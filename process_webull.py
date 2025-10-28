#!/usr/bin/env python3
"""Root shim for scrapeman.process_webull

This file re-exports the package implementation so existing imports from the
repository root keep working.
"""
from scrapeman import process_webull as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
    globals()[_name] = getattr(_mod, _name)
 