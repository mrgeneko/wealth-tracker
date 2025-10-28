#!/usr/bin/env python3
"""
Simple test publisher that sends a sample message using publish_to_kafka.publish_to_kafka
"""
import os
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

try:
    # Import from the installed package to avoid relying on CWD-based imports
    from scrapeman.publish_to_kafka import publish_to_kafka
except Exception as e:
    logging.error(f"publish_to_kafka import failed: {e}")
    raise


def main():
    data = {
        "key": "TEST-1",
        "last_price": "123.45",
        "source": "test",
        "previous_price": "120.00",
        "quote_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "capture_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "note": "this is a test message"
    }

    bootstrap = os.getenv('KAFKA_BOOTSTRAP_SERVERS')
    topic = os.getenv('KAFKA_TOPIC')
    logging.info(f"Publishing test message to topic={topic} bootstrap={bootstrap}")
    try:
        publish_to_kafka(data)
        logging.info("Publish successful")
    except Exception:
        logging.exception("Publish failed")


if __name__ == '__main__':
    main()
