#!/usr/bin/env python3
"""
Package entrypoint: consume fixed number of messages from Kafka then exit.

Usage:
  python -m wealth_tracker.scripts.consume_kafka_test --num 5
"""
import os
import json
import logging
import argparse
import uuid
from kafka import KafkaConsumer
from wealth_tracker import config

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')


def main():
    parser = argparse.ArgumentParser(description='Consume N messages from Kafka then exit')
    parser.add_argument('--num', '-n', type=int, default=1, help='Number of messages to consume before exiting')
    parser.add_argument('--timeout', '-t', type=float, default=10.0, help='Poll timeout in seconds')
    parser.add_argument('--bootstrap', '-b', type=str, default=config.KAFKA_BOOTSTRAP_SERVERS)
    parser.add_argument('--topic', '-p', type=str, default=config.KAFKA_TOPIC)
    parser.add_argument('--from-beginning', action='store_true', help='Start from earliest offset')

    args = parser.parse_args()

    group_id = f"test-consumer-{uuid.uuid4()}"
    logging.info(f"Starting test consumer for topic={args.topic} bootstrap={args.bootstrap} group={group_id}")

    auto_offset = 'earliest' if args.from_beginning else 'latest'

    try:
        consumer = KafkaConsumer(
            args.topic,
            bootstrap_servers=args.bootstrap,
            group_id=group_id,
            auto_offset_reset=auto_offset,
            enable_auto_commit=False,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')) if m is not None else None,
            consumer_timeout_ms=int(args.timeout * 1000)
        )
    except Exception as e:
        logging.exception(f"Failed to create KafkaConsumer: {e}")
        return 2

    count = 0
    try:
        for msg in consumer:
            logging.info(f"Received message (partition={msg.partition} offset={msg.offset}): {msg.value}")
            count += 1
            if count >= args.num:
                logging.info(f"Consumed {count} messages, exiting")
                break
    except Exception:
        logging.exception('Error while consuming messages')
        return 3
    finally:
        try:
            consumer.close()
        except Exception:
            logging.exception('Error closing consumer')

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
