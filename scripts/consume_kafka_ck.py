#!/usr/bin/env python3
"""
Confluent Kafka consumer script for the `price_data` topic.

Usage:
  export KAFKA_BOOTSTRAP_SERVERS='localhost:9092'
  export KAFKA_TOPIC='price_data'
  export KAFKA_CONSUMER_GROUP='price_data_consumer_group'
  python3 scripts/consume_kafka_ck.py

The script reads JSON messages and logs them. It supports graceful shutdown and optional manual commits.
"""

import os
import json
import logging
import signal
import sys
from confluent_kafka import Consumer, KafkaException

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
TOPIC = os.getenv('KAFKA_TOPIC', 'price_data')
GROUP_ID = os.getenv('KAFKA_CONSUMER_GROUP', 'price_data_consumer_group')
AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
# If ENABLE_AUTO_COMMIT is 'true' (case-insensitive) consumer will use automatic commits
ENABLE_AUTO_COMMIT = os.getenv('KAFKA_ENABLE_AUTO_COMMIT', 'false').lower() in ('1', 'true', 'yes')
POLL_TIMEOUT = float(os.getenv('KAFKA_POLL_TIMEOUT', '1.0'))

running = True

def handle_signal(sig, frame):
    global running
    logging.info('Shutdown signal received')
    running = False

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)

conf = {
    'bootstrap.servers': BOOTSTRAP,
    'group.id': GROUP_ID,
    'auto.offset.reset': AUTO_OFFSET_RESET,
    # 'enable.auto.commit' defaults to True; we can set based on env
    'enable.auto.commit': ENABLE_AUTO_COMMIT,
}


def process_message(msg_value):
    """Process a single message payload (dict). Implement your business logic here."""
    logging.info(f"Processing message: {msg_value}")
    # Example: write to DB, publish metrics, etc.
    # For now we just log.


def main():
    consumer = Consumer(conf)
    try:
        consumer.subscribe([TOPIC])
        logging.info(f"Subscribed to topic {TOPIC} (bootstrap={BOOTSTRAP})")

        while running:
            msg = consumer.poll(timeout=POLL_TIMEOUT)
            if msg is None:
                continue
            if msg.error():
                # Error may be recoverable or fatal
                logging.error(f"Consumer error: {msg.error()}")
                continue
            try:
                payload = msg.value()
                if payload is None:
                    logging.warning('Received message with empty payload')
                else:
                    # Decode JSON
                    try:
                        data = json.loads(payload.decode('utf-8')) if isinstance(payload, (bytes, bytearray)) else json.loads(payload)
                    except Exception as e:
                        logging.exception(f"Failed to decode JSON payload: {e}")
                        # Optionally send to a dead-letter topic or log and skip
                        continue

                    # Process the data
                    try:
                        process_message(data)
                    except Exception:
                        logging.exception("Error while processing message")
                        # decide whether to commit or not on processing failure

                    # Commit offset if manual commits are in use
                    if not ENABLE_AUTO_COMMIT:
                        try:
                            consumer.commit(message=msg)
                        except KafkaException:
                            logging.exception('Failed to commit offset')
            except Exception:
                logging.exception('Unexpected error in consumer loop')

    except Exception:
        logging.exception('Fatal consumer error')
    finally:
        logging.info('Closing consumer')
        try:
            consumer.close()
        except Exception:
            logging.exception('Error closing consumer')


if __name__ == '__main__':
    main()
