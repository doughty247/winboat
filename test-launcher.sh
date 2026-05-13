#!/bin/bash
# Quick test script for WinBoat desktop launcher fixes

echo "============================================"
echo "WinBoat Desktop Launcher - Quick Test"
echo "============================================"
echo ""

# Check if wrapper exists
if [ ! -f ~/.local/bin/winboat-launcher ]; then
    echo "ERROR: Wrapper not found at ~/.local/bin/winboat-launcher"
    echo "   Launch WinBoat once to install it"
    exit 1
fi

echo "OK: Wrapper found at ~/.local/bin/winboat-launcher"

# Check if binary path is cached
if [ ! -f ~/.winboat/binary_path ]; then
    echo "ERROR: Binary path not cached at ~/.winboat/binary_path"
    echo "   Launch WinBoat once to create cache"
    exit 1
fi

WINBOAT_BIN=$(cat ~/.winboat/binary_path)
echo "OK: Binary path cached: $WINBOAT_BIN"

if [ ! -f "$WINBOAT_BIN" ]; then
    echo "WARNING: Cached binary does not exist: $WINBOAT_BIN"
    echo "   You may need to update the cache"
fi

echo ""
echo "Testing wrapper with Notepad..."
echo "Command: ~/.local/bin/winboat-launcher 'C:\\Windows\\System32\\notepad.exe'"
echo ""
echo "Expected behavior:"
echo "  - No error dialog appears"
echo "  - WinBoat window stays hidden (or in tray)"
echo "  - Notepad launches in Windows guest within ~5-10 seconds"
echo ""
echo "Press Enter to run test, or Ctrl+C to cancel..."
read

~/.local/bin/winboat-launcher 'C:\Windows\System32\notepad.exe'

echo ""
echo "============================================"
echo "Test complete!"
echo ""
echo "Did Notepad launch? (y/n)"
read -r response

if [[ "$response" =~ ^[Yy]$ ]]; then
    echo "SUCCESS: Launcher is working correctly."
    echo ""
    echo "Next steps:"
    echo "  1. Test multiple rapid launches (click 3-4 shortcuts quickly)"
    echo "  2. Test 'Open with WinBoat' from file manager"
    echo "  3. Check task manager shows separate icons per app"
else
    echo "FAILED: Check logs for errors:"
    echo "   tail -50 ~/.winboat/winboat.log"
    echo ""
    echo "Common issues:"
    echo "  - Container not running (check: docker ps | grep WinBoat)"
    echo "  - Guest API not ready (wait 30s after container start)"
    echo "  - FreeRDP not installed (check: which xfreerdp3)"
fi
