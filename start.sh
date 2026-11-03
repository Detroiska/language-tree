#!/bin/sh
# Launch Language Tree on macOS and Linux.
# Extra flags pass through to server.py, e.g. ./start.sh --port 9000 --no-browser.
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 server.py "$@"
else
  exec python server.py "$@"
fi
