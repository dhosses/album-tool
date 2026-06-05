#!/bin/bash
echo ""
echo "  Album Info Tool"
echo "  ─────────────────────────────"
echo "  Starting server..."
echo "  Open → http://localhost:3000"
echo "  ─────────────────────────────"
echo ""

# Load .env if it exists
if [ -f "$(dirname "$0")/.env" ]; then
  export $(grep -v '^#' "$(dirname "$0")/.env" | xargs)
fi

node "$(dirname "$0")/server.js"
