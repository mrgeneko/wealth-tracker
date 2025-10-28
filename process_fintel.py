#!/usr/bin/env python3
"""Root shim for scrapeman.process_fintel

Re-export the package implementation to keep repository-root imports working.
"""
from scrapeman import process_fintel as _mod

__all__ = getattr(_mod, "__all__", [n for n in dir(_mod) if not n.startswith("_")])
for _name in __all__:
    globals()[_name] = getattr(_mod, _name)
