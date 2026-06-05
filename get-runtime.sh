#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/runtime"

echo ""
echo "  Downloading Node.js runtime..."

ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
  URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-arm64.tar.gz"
else
  URL="https://nodejs.org/dist/v22.14.0/node-v22.14.0-darwin-x64.tar.gz"
fi

curl -L --progress-bar "$URL" | tar -xz -C "$DIR/runtime" --strip-components=2 "*/bin/node"
chmod +x "$DIR/runtime/node"

echo ""
echo "  ✓ Done! Double-click 'Album Tool.command' to launch."
echo ""
