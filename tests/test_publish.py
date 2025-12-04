import pytest
from unittest.mock import Mock, patch


def test_publish_to_kafka_success():
    # import inside test so patches resolve correctly
    from wealth_tracker.publish_to_kafka import publish_to_kafka

    data = {"test": "hello"}

    # Mock future returned by producer.send
    mock_future = Mock()
    mock_future.get.return_value = "metadata"

    # Mock producer with expected methods
    mock_producer = Mock()
    mock_producer.send.return_value = mock_future

    with patch("wealth_tracker.publish_to_kafka.KafkaProducer", return_value=mock_producer):
        res = publish_to_kafka(data, bootstrap_servers="localhost:9094", topic="test_topic", retries=1)

    assert res is True
    mock_producer.send.assert_called_once_with("test_topic", data)
    mock_producer.flush.assert_called_once()
    mock_producer.close.assert_called_once()
