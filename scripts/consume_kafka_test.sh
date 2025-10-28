#!/usr/bin/env bash
set -euo pipefail
PYTHON_EXEC="${PYTHON_EXEC:-/Users/gene/.pyenv/versions/3.13.3/bin/python}"
"$PYTHON_EXEC" "$(dirname "$0")/consume_kafka_test.py" "$@"
