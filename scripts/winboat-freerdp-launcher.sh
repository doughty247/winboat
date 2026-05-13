#!/bin/bash
# WinBoat FreeRDP Direct Launcher
# Launches Windows apps via FreeRDP without spawning WinBoat instances

APP_PATH="$1"

if [ -z "$APP_PATH" ]; then
    zenity --error --text="No app path provided" --width=300 2>/dev/null
    exit 1
fi

# Configuration
CONTAINER_NAME="WinBoat"
RDP_HOST="127.0.0.1"
RDP_PORT="3394"
GUEST_API_PORT="7154"
MAX_WAIT=30

# Function to check if container is running
check_container() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"
}

# Function to check if guest API is ready
check_guest_api() {
    curl -s "http://127.0.0.1:${GUEST_API_PORT}/api/health" >/dev/null 2>&1
}

# Function to find WinBoat binary
find_winboat() {
    if [ -f "$HOME/.winboat/binary_path" ]; then
        BINARY_PATH=$(cat "$HOME/.winboat/binary_path")
        if [ -f "$BINARY_PATH" ] && [ -x "$BINARY_PATH" ]; then
            echo "$BINARY_PATH"
            return 0
        fi
    fi
    
    for DIR in "$HOME/AppImages" "$HOME/Applications" "$HOME/.local/bin" "$HOME/Downloads" "$HOME/Desktop"; do
        if [ -d "$DIR" ]; then
            APPIMAGE=$(find "$DIR" -maxdepth 1 -name "winboat*.AppImage" -o -name "WinBoat*.AppImage" 2>/dev/null | head -1)
            if [ -n "$APPIMAGE" ] && [ -x "$APPIMAGE" ]; then
                echo "$APPIMAGE"
                return 0
            fi
        fi
    done
    
    if command -v winboat &> /dev/null; then
        echo "winboat"
        return 0
    fi
    
    return 1
}

# Check if container is running
if ! check_container; then
    echo "[WinBoat Launcher] Container not running, starting WinBoat..."
    WINBOAT_BIN=$(find_winboat)
    
    if [ -z "$WINBOAT_BIN" ]; then
        zenity --error --title="WinBoat Not Found" \
               --text="Could not find WinBoat binary.\nPlease install WinBoat or check ~/.winboat/binary_path" \
               --width=400 2>/dev/null
        notify-send "WinBoat Error" "Could not find WinBoat binary" 2>/dev/null
        exit 1
    fi
    
    # Start WinBoat in background
    "$WINBOAT_BIN" &
    
    # Wait for container to start
    echo "[WinBoat Launcher] Waiting for container to start..."
    WAIT_COUNT=0
    while ! check_container; do
        sleep 1
        WAIT_COUNT=$((WAIT_COUNT + 1))
        if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
            zenity --error --text="Container failed to start within ${MAX_WAIT} seconds" --width=300 2>/dev/null
            exit 1
        fi
    done
    echo "[WinBoat Launcher] Container started!"
fi

# Wait for guest API to be ready
echo "[WinBoat Launcher] Waiting for guest API..."
WAIT_COUNT=0
while ! check_guest_api; do
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    if [ $WAIT_COUNT -ge $MAX_WAIT ]; then
        zenity --error --text="Guest API failed to start within ${MAX_WAIT} seconds" --width=300 2>/dev/null
        exit 1
    fi
done
echo "[WinBoat Launcher] Guest API ready!"

# Get RDP credentials from docker-compose.yml
COMPOSE_FILE="$HOME/.winboat/docker-compose.yml"
if [ -f "$COMPOSE_FILE" ]; then
    RDP_USER=$(grep "USERNAME:" "$COMPOSE_FILE" | awk '{print $2}' | tr -d '"' | head -1)
    RDP_PASS=$(grep "PASSWORD:" "$COMPOSE_FILE" | awk '{print $2}' | tr -d '"' | head -1)
else
    RDP_USER="bazzite"
    RDP_PASS=""
fi

# Extract just the filename from the Windows path
# Split by backslash and get the last part
FILE_NAME=$(echo "$APP_PATH" | awk -F'\\' '{print $NF}')

# Generate WM_CLASS from executable name (matching winboat.ts logic)
EXE_NAME=$(echo "$FILE_NAME" | sed 's/\.exe$//' | tr '[:upper:]' '[:lower:]' | tr -cd '[:alnum:]')
WM_CLASS="WinBoat-${EXE_NAME}"

# Get clean app name for display
APP_NAME=$(echo "$FILE_NAME" | sed 's/\.exe$//')

echo "[WinBoat Launcher] Launching $APP_NAME with WM_CLASS: $WM_CLASS"

# Launch FreeRDP directly
xfreerdp \
    /u:"${RDP_USER}" \
    /p:"${RDP_PASS}" \
    /v:"${RDP_HOST}" \
    /port:"${RDP_PORT}" \
    /cert:ignore \
    +span \
    +clipboard \
    -wallpaper \
    /sound:sys:pulse \
    /microphone:sys:pulse \
    /floatbar \
    +grab-keyboard \
    /compression \
    /dynamic-resolution \
    /scale-desktop:100 \
    /wm-class:"${WM_CLASS}" \
    /app:program:"${APP_PATH}",name:"${APP_NAME}" \
    &

echo "[WinBoat Launcher] FreeRDP launched for $APP_NAME (PID: $!)"
