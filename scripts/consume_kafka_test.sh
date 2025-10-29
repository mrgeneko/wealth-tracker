#!/usr/bin/env bash
set -euo pipefail
PYTHON_EXEC="${PYTHON_EXEC:-/Users/gene/.pyenv/versions/3.13.3/bin/python}"
# Quick health check for Kafka before running the consumer script. Exits with code 2 if unreachable.
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

"$PYTHON_EXEC" -m scrapeman.scripts.consume_kafka_test "$@"
