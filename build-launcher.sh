#!/bin/bash
set -e

echo "Building WinBoat app launcher..."

cd "$(dirname "$0")/../src/native/app-launcher"

# Build the launcher in release mode
cargo build --release

# Copy to a standard location
LAUNCHER_BIN="target/release/winboat-launcher"
INSTALL_DIR="$HOME/.winboat"
mkdir -p "$INSTALL_DIR"

cp "$LAUNCHER_BIN" "$INSTALL_DIR/winboat-launcher"
chmod +x "$INSTALL_DIR/winboat-launcher"

echo "✅ Launcher built and installed to: $INSTALL_DIR/winboat-launcher"
echo "Size: $(du -h "$INSTALL_DIR/winboat-launcher" | cut -f1)"
