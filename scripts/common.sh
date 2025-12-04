#!/usr/bin/env bash

# Kafka Configuration
export KAFKA_BOOTSTRAP_SERVERS="${KAFKA_BOOTSTRAP_SERVERS:-localhost:9093}"
export KAFKA_TOPIC="${KAFKA_TOPIC:-price_data}"
