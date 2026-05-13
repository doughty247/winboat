#!/bin/bash
set -e

echo "Building WinBoat launcher binary (Go)..."

LAUNCHER_DIR="src/native/app-launcher-go"
STATIC_DIR="src/main/static"

cd "$LAUNCHER_DIR"

# Build the launcher with size optimization
go build -ldflags="-s -w" -o winboat-launcher main.go

cd ../../..

# Create static directory if it doesn't exist
mkdir -p "$STATIC_DIR"

# Copy the launcher to static directory for bundling
cp "$LAUNCHER_DIR/winboat-launcher" "$STATIC_DIR/winboat-launcher"
chmod +x "$STATIC_DIR/winboat-launcher"

echo "Launcher built and copied to $STATIC_DIR/"
echo "Size: $(du -h "$STATIC_DIR/winboat-launcher" | cut -f1)"
