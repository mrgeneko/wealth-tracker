#!/usr/bin/env python3
"""Root shim for scrapeman.process_cnbc

Exports the package implementation at `scrapeman.process_cnbc` so existing
imports that use `process_cnbc` from the repository root continue to work.
"""
from scrapeman import process_cnbc as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
	globals()[_name] = getattr(_mod, _name)