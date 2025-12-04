import json
import logging
import os
import time
try:
    from kafka import KafkaProducer
    from kafka.errors import KafkaError
except Exception as e:
    raise ImportError(
        "Missing dependency 'kafka-python'. Install it into the Python interpreter you run with:\n"
        "python -m pip install kafka-python\n"
        "Or install all project deps: python -m pip install -r requirements.txt"
    ) from e


from wealth_tracker import config

def publish_to_kafka(data, bootstrap_servers=None, topic=None, retries=3, retry_delay=2):
    logging.info(f"publish_to_kafka called")
    """
    Publish a Python dict 'data' to a Kafka topic as JSON.

    Parameters:
    - data: dict - the message payload
    - bootstrap_servers: list or comma-separated string, default from config
    - topic: str - Kafka topic, default from config
    - retries: int - number of retries on failure
    - retry_delay: int - seconds between retries

    The function logs errors and raises if publishing ultimately fails.
    """
    
    if bootstrap_servers is None:
        bootstrap_servers = config.KAFKA_BOOTSTRAP_SERVERS
    if topic is None:
        topic = config.KAFKA_TOPIC

    # Create producer
    producer = KafkaProducer(
        bootstrap_servers=bootstrap_servers,
        value_serializer=lambda v: json.dumps(v).encode('utf-8'),
        retries=5
    )

    last_exception = None
    for attempt in range(1, retries + 1):
        try:
            future = producer.send(topic, data)
            result = future.get(timeout=10)
            logging.info(f"Published message to Kafka topic {topic}: {result}")
            print(f"Published message to Kafka topic {topic}: {result}")
            producer.flush()
            producer.close()
            return True
        except KafkaError as e:
            last_exception = e
            logging.error(f"Kafka publish attempt {attempt} failed: {e}")
            time.sleep(retry_delay)
        except Exception as e:
            last_exception = e
            logging.error(f"Unexpected error while publishing to Kafka: {e}")
            time.sleep(retry_delay)

    # If we reach here, all retries failed
    producer.close()
    raise last_exception
