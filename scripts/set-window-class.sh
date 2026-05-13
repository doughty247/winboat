#!/bin/bash
# Script to set window metadata for RemoteApp windows
# Helps KDE map windows to the correct desktop entry + icon

WINDOW_TITLE="$1"
WM_CLASS_NAME="$2"
DESKTOP_SAFE_NAME="$3"
ICON_PATH="$4"

if [ -z "$WINDOW_TITLE" ] || [ -z "$WM_CLASS_NAME" ] || [ -z "$DESKTOP_SAFE_NAME" ]; then
    echo "Usage: $0 <window_title_pattern> <wm_class_name> <desktop_safe_name> [icon_path]"
    exit 1
fi

# Ensure we have an X11 display (RemoteApp surfaces appear through XWayland on Wayland sessions)
if [ -z "$DISPLAY" ]; then
    echo "Warning: DISPLAY is not set. Skipping window metadata update."
    exit 0
fi

DESKTOP_ENV="${XDG_CURRENT_DESKTOP:-}"

# Wait for window to appear (max 10 seconds)
MAX_WAIT=10
COUNT=0

while [ $COUNT -lt $MAX_WAIT ]; do
    # Find window ID by title
    WINDOW_ID=$(xdotool search --name "$WINDOW_TITLE" 2>/dev/null | tail -1)
    
    if [ -n "$WINDOW_ID" ]; then
        echo "Found window: $WINDOW_ID with title matching: $WINDOW_TITLE"

        # Hint WM_CLASS (best effort - some WMs cache early values)
        if command -v xdotool &> /dev/null; then
            xdotool set_window --class "$WM_CLASS_NAME" "$WINDOW_ID" 2>/dev/null
        fi

        # Provide KDE with the desktop file the window belongs to
        DESKTOP_ENTRY="winboat-apps/${DESKTOP_SAFE_NAME}.desktop"
        DESKTOP_ENTRY_PATH="$HOME/.local/share/applications/$DESKTOP_ENTRY"
        if [ -f "$DESKTOP_ENTRY_PATH" ] && echo "$DESKTOP_ENV" | grep -qi "kde\|plasma"; then
            xprop -id "$WINDOW_ID" -f _KDE_NET_WM_DESKTOP_FILE 8u -set _KDE_NET_WM_DESKTOP_FILE "$DESKTOP_ENTRY" 2>/dev/null
            echo "Set _KDE_NET_WM_DESKTOP_FILE to: $DESKTOP_ENTRY"
        elif [ ! -f "$DESKTOP_ENTRY_PATH" ]; then
            echo "Warning: desktop entry not found at $DESKTOP_ENTRY_PATH"
        fi

        # Set icon name hint so that Plasma falls back to the desktop entry icon
        xprop -id "$WINDOW_ID" -f _NET_WM_ICON_NAME 8u -set _NET_WM_ICON_NAME "$WM_CLASS_NAME" 2>/dev/null

        # Legacy property used by some toolkits
        xprop -id "$WINDOW_ID" -f WM_ICON_NAME 8u -set WM_ICON_NAME "$WM_CLASS_NAME" 2>/dev/null

        # Spotlight the icon on X11 if we have a file path (optional)
        if [ -n "$ICON_PATH" ] && [ -f "$ICON_PATH" ] && command -v xseticon &> /dev/null; then
            xseticon -id "$WINDOW_ID" "$ICON_PATH" 2>/dev/null
        fi
        
        exit 0
    fi
    
    sleep 1
    COUNT=$((COUNT + 1))
done

echo "Window not found after $MAX_WAIT seconds"
exit 1

    
    sleep 1
    COUNT=$((COUNT + 1))
done

echo "Window not found after $MAX_WAIT seconds"
exit 1
