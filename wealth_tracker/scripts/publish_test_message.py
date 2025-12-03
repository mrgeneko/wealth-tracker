#!/usr/bin/env python3
"""
Package entrypoint that publishes a sample message using the package publisher.

Usage:
  python -m wealth_tracker.scripts.publish_test_message
"""
import os
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

from wealth_tracker.publish_to_kafka import publish_to_kafka


def main():
    data = {
        "key": "TEST-1",
        "regular_last_price": "123.45",
        "source": "test",
        "previous_price": "120.00",
        "regular_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "capture_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "note": "this is a test message"
    }

    logging.info(f"Publishing test message to topic={os.getenv('KAFKA_TOPIC')} bootstrap={os.getenv('KAFKA_BOOTSTRAP_SERVERS')}")
    try:
        publish_to_kafka(data)
        logging.info("Publish successful")
    except Exception:
        logging.exception("Publish failed")


if __name__ == '__main__':
    main()
