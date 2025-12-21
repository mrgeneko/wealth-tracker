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
from datetime import datetime, time
from zoneinfo import ZoneInfo
from confluent_kafka import Consumer, KafkaException

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9094')
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
            # Ensure table exists with security_type and source support
            # Composite PRIMARY KEY (ticker, security_type, source) to handle:
            # - Crypto ticker variations across sources (BTC.X vs BTC-USD)
            # - Same ticker on multiple exchanges (BP on NYSE vs LSE)
            cursor = db_conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS latest_prices (
                    ticker VARCHAR(50) NOT NULL,
                    security_type VARCHAR(20) NOT NULL DEFAULT 'EQUITY',
                    source VARCHAR(50) NOT NULL DEFAULT 'unknown',
                    price DECIMAL(18, 4),
                    previous_close_price DECIMAL(18, 4),
                    prev_close_source VARCHAR(50),
                    prev_close_time DATETIME,
                    quote_time DATETIME,
                    capture_time DATETIME,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (ticker, security_type, source)
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
    if not ticker:
        logging.warning("Skipping message missing key")
        return

    # Extract security_type (default to EQUITY for backward compatibility)
    security_type = data.get('security_type', 'EQUITY')
    if isinstance(security_type, str):
        security_type = security_type.upper()
    else:
        security_type = 'EQUITY'

    # Extract source for composite key (ticker, security_type, source)
    # This handles crypto ticker variations (BTC.X vs BTC-USD) and
    # multi-exchange tickers (BP on NYSE vs LSE)
    base_source = data.get('source', 'unknown')
    if not base_source or not isinstance(base_source, str):
        base_source = 'unknown'

    # Helper to clean price strings
    def clean_val(v):
        if v is None: return 0.0
        try:
            return float(str(v).replace('$', '').replace(',', ''))
        except ValueError:
            return 0.0

    # Helper to check regular hours
    def is_regular_hours(dt):
        if not dt: return False
        et_tz = ZoneInfo('America/New_York')
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo('UTC'))
        dt_et = dt.astimezone(et_tz)
        if dt_et.weekday() >= 5: return False # Sat/Sun
        t = dt_et.time()
        return time(9, 30) <= t < time(16, 0)

    # Parse capture_time
    capture_time_str = data.get('capture_time') or data.get('regular_time')
    capture_time = datetime.now(ZoneInfo('UTC'))
    if capture_time_str:
        try:
            capture_time = datetime.fromisoformat(capture_time_str.replace('Z', '+00:00'))
        except ValueError:
            pass

    now = datetime.now(ZoneInfo('UTC'))
    prefer_regular = is_regular_hours(now) and is_regular_hours(capture_time)

    regular_price = clean_val(data.get('regular_price'))
    pre_market = clean_val(data.get('pre_market_price'))
    after_hours = clean_val(data.get('after_hours_price'))
    extended = clean_val(data.get('extended_hours_price'))

    price_val = 0.0
    price_source = 'regular'
    found = False

    if prefer_regular and regular_price > 0:
        price_val = regular_price
        price_source = 'regular'
        found = True
    
    if not found:
        if pre_market > 0:
            price_val = pre_market
            price_source = 'pre-market'
        elif after_hours > 0:
            price_val = after_hours
            price_source = 'after-hours'
        elif extended > 0:
            price_val = extended
            price_source = 'extended'
        elif regular_price > 0:
            price_val = regular_price
            price_source = 'regular'

    if price_val == 0:
        logging.warning(f"No valid price found for {ticker}")
        return

    # Get previous close price
    previous_close_price = clean_val(data.get('previous_close_price'))

    # Get quote_time (the time of the quote, not the capture time)
    quote_time_str = data.get('regular_time') or data.get('quote_time') or data.get('regular_quote_time')
    quote_time = None
    if quote_time_str:
        try:
            quote_time = datetime.fromisoformat(quote_time_str.replace('Z', '+00:00'))
        except ValueError:
            quote_time = None

    # Construct final_source with price_source detail
    final_source = f"{base_source} ({price_source})"

    # Determine prev_close metadata
    prev_close_source = data.get('previous_close_source') or base_source if previous_close_price > 0 else None
    prev_close_time = capture_time if previous_close_price > 0 else None

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            # Use source-priority merge for previous_close_price:
            # Only update prev_close fields if incoming has a valid value AND
            # (no existing value OR incoming source has higher/equal priority)
            # Composite PRIMARY KEY: (ticker, security_type, source)
            # - source distinguishes crypto ticker variations (BTC.X vs BTC-USD)
            # - source distinguishes multi-exchange tickers (BP on NYSE vs LSE)
            sql = """
                INSERT INTO latest_prices (ticker, security_type, source, price, previous_close_price, prev_close_source, prev_close_time, quote_time, capture_time)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    price = VALUES(price),
                    previous_close_price = CASE
                        WHEN VALUES(previous_close_price) IS NOT NULL THEN VALUES(previous_close_price)
                        ELSE previous_close_price
                    END,
                    prev_close_source = CASE
                        WHEN VALUES(previous_close_price) IS NOT NULL THEN VALUES(prev_close_source)
                        ELSE prev_close_source
                    END,
                    prev_close_time = CASE
                        WHEN VALUES(previous_close_price) IS NOT NULL THEN VALUES(prev_close_time)
                        ELSE prev_close_time
                    END,
                    quote_time = VALUES(quote_time),
                    capture_time = VALUES(capture_time)
            """
            vals = (
                ticker,
                security_type,
                base_source,
                price_val,
                previous_close_price if previous_close_price > 0 else None,
                prev_close_source,
                prev_close_time,
                quote_time,
                capture_time
            )
            cursor.execute(sql, vals)
            conn.commit()
            cursor.close()
            logging.info(f"Upserted {ticker} ({security_type}) to DB: {price_val} ({final_source}), prev_close={previous_close_price if previous_close_price > 0 else 'preserved'}")
            logging.debug(f"prev_close_source={prev_close_source}, prev_close_time={prev_close_time}")
        except Exception as e:
            logging.error(f"Error writing to DB: {e}")
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
