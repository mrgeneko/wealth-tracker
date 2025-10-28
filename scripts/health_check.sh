#!/usr/bin/env bash
set -euo pipefail

# Health check for scrapeman: verifies python interpreter, required imports, and Kafka connectivity.
PYTHON_EXEC="${PYTHON_EXEC:-/Users/gene/.pyenv/versions/3.13.3/bin/python}"

echo "Using python: $PYTHON_EXEC"

# Run a small python snippet to check imports and Kafka reachability
$PYTHON_EXEC - <<'PY'
import sys, os, socket
ok = True
reqs = ['kafka', 'mysql.connector', 'bs4', 'selenium']
print('Checking imports...')
for r in reqs:
    try:
        __import__(r)
        print(f'OK import {r}')
    except Exception as e:
        print(f'MISSING import {r}: {e}', file=sys.stderr)
        ok = False

# Check Kafka bootstrap server connectivity
bs = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')
first = bs.split(',')[0].strip()
if ':' in first:
    host, port = first.split(':', 1)
    port = int(port)
else:
    host = first
    port = 9092
print(f'Checking Kafka at {host}:{port}...')
try:
    s = socket.create_connection((host, port), timeout=3)
    s.close()
    print(f'Kafka reachable at {host}:{port}')
except Exception as e:
    print(f'Kafka unreachable at {host}:{port}: {e}', file=sys.stderr)
    ok = False

sys.exit(0 if ok else 2)
PY

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo "Health check: OK"
else
    echo "Health check: FAILED (exit $EXIT_CODE)" >&2
fi
exit $EXIT_CODE
