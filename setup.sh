#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  Album Tool — First-time setup"
echo "  ─────────────────────────────"
echo ""

# Fix permissions
chmod +x "$DIR/Album Tool.app/Contents/MacOS/Album Tool"
chmod +x "$DIR/start.sh"
echo "  ✓ Permissions set"

# Remove quarantine flag (macOS Gatekeeper)
xattr -rd com.apple.quarantine "$DIR/Album Tool.app" 2>/dev/null
echo "  ✓ Gatekeeper flag removed"

# Download Node.js runtime if not already present
if [ ! -f "$DIR/runtime/node" ]; then
  echo "  Downloading Node.js runtime..."
  bash "$DIR/get-runtime.sh"
else
  echo "  ✓ Node.js runtime already present"
fi

# Create .env if missing
if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  echo "  ✓ Created .env — opening it now..."
  echo ""
  echo "  → Fill in your Spotify credentials and password, then save."
  open -a TextEdit "$DIR/.env"
else
  echo "  ✓ .env already exists"
fi

echo ""
echo "  Done! Double-click 'Album Tool.app' to launch."
echo ""
