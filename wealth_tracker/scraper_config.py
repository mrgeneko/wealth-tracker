import json
import os

_CONFIG = None

def _load_config():
    global _CONFIG
    if _CONFIG is not None:
        return _CONFIG
    base = os.path.dirname(__file__)
    path = os.path.join(base, 'scraper_attributes.json')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            _CONFIG = json.load(f)
    except Exception:
        _CONFIG = {}
    return _CONFIG

def get_attributes(name):
    """Return a shallow copy of attributes for the given site name from JSON.

    Caller can attach function references (e.g., 'extract') as needed.
    """
    cfg = _load_config()
    if not cfg:
        return None
    entry = cfg.get(name)
    if not entry:
        return None
    return dict(entry)

def list_sites():
    cfg = _load_config()
    return list(cfg.keys())
