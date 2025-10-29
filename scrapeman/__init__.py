"""scrapeman package init

Expose commonly used functions at package level.
"""

from .publish_to_kafka import publish_to_kafka

__all__ = ["publish_to_kafka"]
