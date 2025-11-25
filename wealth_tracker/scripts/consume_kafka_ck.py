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
import mysql.connector
from datetime import datetime
from confluent_kafka import Consumer, KafkaException

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
TOPIC = os.getenv('KAFKA_TOPIC', 'price_data')
GROUP_ID = os.getenv('KAFKA_CONSUMER_GROUP', 'price_data_consumer_group')
AUTO_OFFSET_RESET = os.getenv('KAFKA_AUTO_OFFSET_RESET', 'earliest')
ENABLE_AUTO_COMMIT = os.getenv('KAFKA_ENABLE_AUTO_COMMIT', 'false').lower() in ('1', 'true', 'yes')
POLL_TIMEOUT = float(os.getenv('KAFKA_POLL_TIMEOUT', '1.0'))

# MySQL Configuration
MYSQL_HOST = os.getenv('MYSQL_HOST', 'mysql')
MYSQL_PORT = int(os.getenv('MYSQL_PORT', '3306'))
MYSQL_USER = os.getenv('MYSQL_USER', 'test')
MYSQL_PASSWORD = os.getenv('MYSQL_PASSWORD', 'test')
MYSQL_DATABASE = os.getenv('MYSQL_DATABASE', 'testdb')

running = True
db_conn = None

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

def get_db_connection():
    global db_conn
    try:
        if db_conn is None or not db_conn.is_connected():
            logging.info(f"Connecting to MySQL at {MYSQL_HOST}:{MYSQL_PORT}...")
            db_conn = mysql.connector.connect(
                host=MYSQL_HOST,
                port=MYSQL_PORT,
                user=MYSQL_USER,
                password=MYSQL_PASSWORD,
                database=MYSQL_DATABASE
            )
            # Ensure table exists
            cursor = db_conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS latest_prices (
                    ticker VARCHAR(50) PRIMARY KEY,
                    price DECIMAL(18, 4),
                    change_decimal DECIMAL(18, 4),
                    change_percent VARCHAR(20),
                    source VARCHAR(50),
                    capture_time DATETIME,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            """)
            db_conn.commit()
            cursor.close()
            logging.info("Connected to MySQL and ensured table exists.")
    except Exception as e:
        logging.error(f"Database connection error: {e}")
        db_conn = None
    return db_conn

def process_message(data):
    logging.info(f"Processing message: {data}")
    
    ticker = data.get('key')
    last_price = data.get('last_price')
    
    if not ticker or last_price is None:
        logging.warning("Skipping message missing key or last_price")
        return

    # Clean price
    try:
        price_val = float(str(last_price).replace('$', '').replace(',', ''))
    except ValueError:
        logging.warning(f"Invalid price format for {ticker}: {last_price}")
        return

    change_decimal = data.get('price_change_decimal')
    change_percent = data.get('price_change_percent')
    source = data.get('source')
    capture_time = data.get('capture_time')

    # Clean change_decimal if present
    if change_decimal:
        try:
            change_decimal = float(str(change_decimal).replace('$', '').replace(',', ''))
        except ValueError:
            change_decimal = None

    # Parse capture_time
    if capture_time:
        try:
            # Handle ISO format with Z
            capture_time = capture_time.replace('Z', '+00:00')
            capture_time = datetime.fromisoformat(capture_time)
        except ValueError:
            logging.warning(f"Could not parse capture_time: {capture_time}, using NOW()")
            capture_time = datetime.now()
    else:
        capture_time = datetime.now()

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            sql = """
                INSERT INTO latest_prices (ticker, price, change_decimal, change_percent, source, capture_time)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    price = VALUES(price),
                    change_decimal = VALUES(change_decimal),
                    change_percent = VALUES(change_percent),
                    source = VALUES(source),
                    capture_time = VALUES(capture_time)
            """
            # Convert ISO string to MySQL datetime format if needed, or let MySQL handle it if it's standard ISO
            # Python's mysql-connector handles datetime objects well, but string ISO usually works too.
            # If capture_time is missing, use NOW()
            
            vals = (ticker, price_val, change_decimal, change_percent, source, capture_time)
            cursor.execute(sql, vals)
            conn.commit()
            cursor.close()
            logging.info(f"Upserted {ticker} to DB")
        except Exception as e:
            logging.error(f"Error writing to DB: {e}")
            # Force reconnection on next attempt if it was a connection issue
            global db_conn
            try:
                db_conn.close()
            except:
                pass
            db_conn = None

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
