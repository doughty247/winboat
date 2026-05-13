#!/bin/bash
# WinBoat Launcher Wrapper
# This script dynamically finds and launches WinBoat with the provided app path
# Shortcuts call this script, which never needs to be updated

APP_PATH="$1"

if [ -z "$APP_PATH" ]; then
    zenity --error --text="No app path provided" --width=300 2>/dev/null
    exit 1
fi

# Function to find WinBoat binary
find_winboat() {
    # Check ~/.winboat/binary_path first
    if [ -f "$HOME/.winboat/binary_path" ]; then
        BINARY_PATH=$(cat "$HOME/.winboat/binary_path")
        if [ -f "$BINARY_PATH" ] && [ -x "$BINARY_PATH" ]; then
            echo "$BINARY_PATH"
            return 0
        fi
    fi
    
    # Search common locations for AppImage
    for DIR in "$HOME/AppImages" "$HOME/Applications" "$HOME/.local/bin" "$HOME/Downloads" "$HOME/Desktop"; do
        if [ -d "$DIR" ]; then
            APPIMAGE=$(find "$DIR" -maxdepth 1 -name "winboat*.AppImage" -o -name "WinBoat*.AppImage" 2>/dev/null | head -1)
            if [ -n "$APPIMAGE" ] && [ -x "$APPIMAGE" ]; then
                echo "$APPIMAGE"
                return 0
            fi
        fi
    done
    
    # Try system-installed binary
    if command -v winboat &> /dev/null; then
        echo "winboat"
        return 0
    fi
    
    return 1
}

# Find WinBoat
WINBOAT_BIN=$(find_winboat)

if [ -z "$WINBOAT_BIN" ]; then
    zenity --error --title="WinBoat Not Found" \
           --text="Could not find WinBoat binary.\nPlease install WinBoat or check ~/.winboat/binary_path" \
           --width=400 2>/dev/null
    notify-send "WinBoat Error" "Could not find WinBoat binary" 2>/dev/null
    exit 1
fi

# Launch WinBoat with the app path (-- separates Electron args from app args)
exec "$WINBOAT_BIN" -- --launch-app "$APP_PATH"
