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
            # Ensure table exists with composite key (ticker, security_type, pricing_class)
            # - security_type: Distinguish BTC as crypto vs ETF vs stock
            # - pricing_class: Determines which scrapers can price this ticker (US_EQUITY, US_TREASURY, CRYPTO_INVESTING)
            # - source_session: Scraper name with price type (e.g., "yahoo (after-hours)")
            cursor = db_conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS latest_prices (
                    ticker VARCHAR(50) NOT NULL,
                    security_type VARCHAR(20) NOT NULL DEFAULT 'NOT_SET',
                    pricing_class VARCHAR(50) NOT NULL DEFAULT 'US_EQUITY',
                    price DECIMAL(18, 4),
                    previous_close_price DECIMAL(18, 4),
                    prev_close_source VARCHAR(50),
                    prev_close_time DATETIME,
                    source_session VARCHAR(100),
                    quote_time DATETIME,
                    capture_time DATETIME,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (ticker, security_type, pricing_class)
                )
            """)
            db_conn.commit()
            cursor.close()
            logging.info("Connected to MySQL and ensured table exists.")
    except Exception as e:
        logging.error(f"Database connection error: {e}")
        db_conn = None
    return db_conn

# Mapping from source (data provenance) to pricing_class (pricing capability)
SOURCE_TO_PRICING_CLASS = {
    'NASDAQ_FILE': 'US_EQUITY',
    'NYSE_FILE': 'US_EQUITY',
    'OTHER_LISTED_FILE': 'US_EQUITY',
    'TREASURY_FILE': 'US_TREASURY',
    'TREASURY_HISTORICAL': 'US_TREASURY',
    'US_TREASURY_AUCTIONS': 'US_TREASURY',
    'CRYPTO_INVESTING_FILE': 'CRYPTO_INVESTING',
    'INVESTING': 'CRYPTO_INVESTING',  # Investing.com watchlist scraper (crypto)
    'YAHOO': 'US_EQUITY',
    'USER_ADDED': 'US_EQUITY',
    'MANUAL_FETCH': 'US_EQUITY'
}

def get_pricing_class(source=None, pricing_class=None, security_type=None):
    """Get pricing_class from source, explicit pricing_class, or security_type"""
    # If explicit pricing_class provided, use it
    if pricing_class and isinstance(pricing_class, str) and pricing_class.upper() in ('US_EQUITY', 'US_TREASURY', 'CRYPTO_INVESTING'):
        return pricing_class.upper()
    
    # Map from source
    if source and isinstance(source, str):
        mapped = SOURCE_TO_PRICING_CLASS.get(source.upper())
        if mapped:
            return mapped
    
    # Default based on security type
    if security_type and isinstance(security_type, str):
        st = security_type.lower()
        if st in ('bond', 'us_treasury'):
            return 'US_TREASURY'
        if st == 'crypto':
            return 'CRYPTO_INVESTING'
    
    return 'US_EQUITY'

def process_message(data):
    logging.info(f"Processing message: {data}")

    ticker = data.get('key')
    if not ticker:
        logging.warning("Skipping message missing key")
        return

    # Extract security_type (default to NOT_SET to be explicit about missing data)
    security_type = data.get('security_type', 'NOT_SET')
    if isinstance(security_type, str):
        security_type = security_type.upper()
    else:
        security_type = 'NOT_SET'

    # Extract base_source (scraper name like "yahoo") for source_session
    base_source = data.get('source', 'unknown')
    if not base_source or not isinstance(base_source, str):
        base_source = 'unknown'
    
    # pricing_class determines which scrapers can price this ticker
    # Can be provided directly or derived from source/security_type
    pricing_class = get_pricing_class(
        source=data.get('position_source') or data.get('source'),  # Check both position_source and source fields
        pricing_class=data.get('pricing_class'),  # New field - pricing capability
        security_type=security_type
    )

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

    # Construct source_session with price_source detail (e.g., "yahoo (after-hours)")
    source_session = f"{base_source} ({price_source})"

    # Determine prev_close metadata
    prev_close_source = data.get('previous_close_source') or base_source if previous_close_price > 0 else None
    prev_close_time = capture_time if previous_close_price > 0 else None

    conn = get_db_connection()
    if conn:
        try:
            cursor = conn.cursor()
            # Composite PRIMARY KEY: (ticker, security_type, pricing_class)
            # - pricing_class determines which scrapers can price this ticker (US_EQUITY, US_TREASURY, CRYPTO_INVESTING)
            # - source_session stores the scraper name with price type (e.g., "yahoo (after-hours)")
            sql = """
                INSERT INTO latest_prices (ticker, security_type, pricing_class, price, previous_close_price, prev_close_source, prev_close_time, quote_time, capture_time, source_session)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    capture_time = VALUES(capture_time),
                    source_session = VALUES(source_session)
            """
            vals = (
                ticker,
                security_type,
                pricing_class,
                price_val,
                previous_close_price if previous_close_price > 0 else None,
                prev_close_source,
                prev_close_time,
                quote_time,
                capture_time,
                source_session  # scraper name with price type (e.g., "yahoo (after-hours)")
            )
            cursor.execute(sql, vals)
            conn.commit()
            cursor.close()
            logging.info(f"Upserted {ticker} ({security_type}) to DB: {price_val} ({source_session}), prev_close={previous_close_price if previous_close_price > 0 else 'preserved'}")
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
