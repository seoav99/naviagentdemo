#!/bin/zsh
set -u

APP_DIR="${0:A:h}"
cd "$APP_DIR" || exit 1

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -x "/Users/eujinlee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  NODE_BIN="/Users/eujinlee/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print "Node.js 18 or later is required. Install Node.js, then open this file again."
  read "REPLY?Press Return to close this window. "
  exit 1
fi

"$NODE_BIN" server.mjs &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
sleep 1
open "http://127.0.0.1:4173"
wait "$SERVER_PID"
