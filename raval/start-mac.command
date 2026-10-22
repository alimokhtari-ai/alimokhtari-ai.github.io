#!/bin/bash
set -u
cd -- "$(dirname -- "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "RAVAL needs Python 3.10 or newer. Install Python, then run this file again."
  read -r -p "Press Return to close. "
  exit 1
fi

if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "RAVAL needs Python 3.10 or newer."
  read -r -p "Press Return to close. "
  exit 1
fi

echo "RAVAL local demo: http://127.0.0.1:8765"
echo "Keep this terminal open. Press Ctrl+C to stop."
echo "Default mode: fixture. Telegram in the web interface is a simulator."
python3 server.py --open
raval_exit_code=$?
if [ "$raval_exit_code" -ne 0 ] && [ "$raval_exit_code" -ne 130 ]; then
  echo "The server stopped with an error. Review the message above."
  read -r -p "Press Return to close. "
fi
exit "$raval_exit_code"

