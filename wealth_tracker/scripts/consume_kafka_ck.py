#!/usr/bin/env python3
"""
Package entrypoint: confluent-kafka consumer for price_data topic.

Usage:
  python -m wealth_tracker.scripts.consume_kafka_ck
"""
import os
import json
import logging
import signal
from confluent_kafka import Consumer, KafkaException

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
TOPIC = os.getenv('KAFKA_TOPIC', 'price_data')
GROUP_ID = os.getenv('KAFKA_CONSUMER_GROUP', 'price_data_consumer_group')
AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
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
    'enable.auto.commit': ENABLE_AUTO_COMMIT,
}


def process_message(msg_value):
    logging.info(f"Processing message: {msg_value}")


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
                logging.error(f"Consumer error: {msg.error()}")
                continue
            try:
                payload = msg.value()
                if payload is None:
                    logging.warning('Received message with empty payload')
                else:
                    try:
                        data = json.loads(payload.decode('utf-8')) if isinstance(payload, (bytes, bytearray)) else json.loads(payload)
                    except Exception as e:
                        logging.exception(f"Failed to decode JSON payload: {e}")
                        continue

                    try:
                        process_message(data)
                    except Exception:
                        logging.exception("Error while processing message")

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
