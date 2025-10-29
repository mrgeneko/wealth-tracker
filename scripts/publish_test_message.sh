#!/usr/bin/env bash
set -euo pipefail
PYTHON_EXEC="${PYTHON_EXEC:-/Users/gene/.pyenv/versions/3.13.3/bin/python}"
# Ensure the repository root is on PYTHONPATH so local modules can be imported
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHONPATH="$REPO_ROOT" "$PYTHON_EXEC" "$REPO_ROOT/scripts/publish_test_message.py"
