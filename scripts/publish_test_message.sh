#!/usr/bin/env bash
set -euo pipefail
PYTHON_EXEC="${PYTHON_EXEC:-/Users/gene/.pyenv/versions/3.13.3/bin/python}"
# Ensure the repository root is on PYTHONPATH so local modules can be imported
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Quick health check for Kafka before running the publish script. Exits with code 2 if unreachable.
"$PYTHON_EXEC" - <<'PY'
import os, socket, sys
bs = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
hostport = bs.split(',')[0]
if ':' in hostport:
		host, port = hostport.split(':', 1)
else:
		host, port = hostport, '9092'
try:
		s = socket.socket()
		s.settimeout(2)
		s.connect((host, int(port)))
		s.close()
		print('KAFKA_OK')
except Exception as e:
		print('KAFKA_UNREACHABLE', e)
		sys.exit(2)
PY
if [ $? -ne 0 ]; then
	echo "Kafka health check failed (see above). Exiting." >&2
	exit 2
fi

# Run the package entrypoint
PYTHONPATH="$REPO_ROOT" "$PYTHON_EXEC" -m wealth_tracker.scripts.publish_test_message
