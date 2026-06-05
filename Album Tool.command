#!/bin/bash
cd "$(dirname "$0")"

# Stop any existing instance on port 3000
pkill -f "server.js" 2>/dev/null
sleep 0.3

echo ""
echo "  Album Tool — starting..."
echo ""

# Use bundled runtime if available, otherwise fall back to system node
if [ -x "$(dirname "$0")/runtime/node" ]; then
  NODE="$(dirname "$0")/runtime/node"
else
  NODE="$(which node 2>/dev/null)"
  if [ -z "$NODE" ]; then
    osascript -e 'display alert "Node.js not found" message "Run get-runtime.sh first to download the runtime, or install Node.js from nodejs.org"'
    exit 1
  fi
fi

"$NODE" server.js &
SERVER_PID=$!

sleep 1.5
open http://localhost:3000

echo "  Running at http://localhost:3000"
echo "  Close this window to stop."
echo ""

wait $SERVER_PID
