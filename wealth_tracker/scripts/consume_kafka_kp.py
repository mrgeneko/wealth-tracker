#!/usr/bin/env python3
"""
Package entrypoint: kafka-python consumer for price_data topic.

Usage:
  python -m wealth_tracker.scripts.consume_kafka_kp
"""
import os
import json
import logging
import signal
from kafka import KafkaConsumer

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
TOPIC = os.getenv('KAFKA_TOPIC', 'price_data')
GROUP_ID = os.getenv('KAFKA_CONSUMER_GROUP', 'price_data_consumer_group')
AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
ENABLE_AUTO_COMMIT = os.getenv('KAFKA_ENABLE_AUTO_COMMIT', 'false').lower() in ('1', 'true', 'yes')
POLL_TIMEOUT_MS = int(os.getenv('KAFKA_POLL_TIMEOUT_MS', '1000'))
MAX_RECORDS = int(os.getenv('KAFKA_MAX_RECORDS', '100'))

running = True

def handle_signal(sig, frame):
    global running
    logging.info('Shutdown signal received')
    running = False

signal.signal(signal.SIGINT, handle_signal)
signal.signal(signal.SIGTERM, handle_signal)


def process_message(data: dict):
    logging.info(f"Processing message: {data}")


def main():
    consumer = KafkaConsumer(
        TOPIC,
        bootstrap_servers=BOOTSTRAP,
        group_id=GROUP_ID,
        auto_offset_reset=AUTO_OFFSET_RESET,
        enable_auto_commit=ENABLE_AUTO_COMMIT,
        value_deserializer=lambda m: json.loads(m.decode('utf-8')) if m is not None else None,
        consumer_timeout_ms=1000
    )

    logging.info(f"Kafka consumer started for topic={TOPIC} bootstrap={BOOTSTRAP} group={GROUP_ID}")

    try:
        while running:
            records = consumer.poll(timeout_ms=POLL_TIMEOUT_MS, max_records=MAX_RECORDS)
            if not records:
                continue
            for tp, msgs in records.items():
                for msg in msgs:
                    try:
                        data = msg.value
                        if data is None:
                            logging.warning('Received empty message')
                            continue
                        process_message(data)
                    except Exception:
                        logging.exception('Error processing message')
                if not ENABLE_AUTO_COMMIT:
                    try:
                        consumer.commit()
                    except Exception:
                        logging.exception('Failed to commit offsets')
    except Exception:
        logging.exception('Fatal error in consumer')
    finally:
        logging.info('Closing consumer')
        try:
            consumer.close()
        except Exception:
            logging.exception('Error closing consumer')


if __name__ == '__main__':
    main()
