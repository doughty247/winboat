#!/bin/bash
# WinBoat System Integration Installer
# This script installs the "Open with WinBoat" file manager integration
# Run this once after installing WinBoat

set -e

echo "Installing WinBoat System Integration..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Directories
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICONS_DIR="$HOME/.local/share/icons/winboat"

# Create directories
mkdir -p "$BIN_DIR"
mkdir -p "$DESKTOP_DIR"
mkdir -p "$ICONS_DIR"

# 1. Create the winboat-open wrapper script
echo -e "${BLUE}Installing winboat-open wrapper...${NC}"
cat > "$BIN_DIR/winboat-open" << 'WRAPPER_EOF'
#!/bin/bash
# WinBoat File Opener - System Integration
# This script handles "Open with WinBoat" from file managers

FILE_PATH="$1"

if [ -z "$FILE_PATH" ]; then
    zenity --error --text="No file specified" --width=300 2>/dev/null
    exit 1
fi

# Convert Linux paths to Windows UNC paths (for Shared Home Folder)
if [[ "$FILE_PATH" == /* ]]; then
    if [[ "$FILE_PATH" == "$HOME"* ]]; then
        # Remove home directory prefix and convert to UNC
        RELATIVE_PATH="${FILE_PATH#$HOME}"
        RELATIVE_PATH="${RELATIVE_PATH#/}"
        # Convert to Windows UNC: \\host.lan\Data\path
        # CRITICAL: dockur/windows exposes /shared as Samba share named "Data"
        WIN_PATH="\\\\host.lan\\Data\\${RELATIVE_PATH//\//\\}"
    else
        zenity --error --title="WinBoat" \
               --text="File must be in your home folder.\nPath: $FILE_PATH" \
               --width=400 2>/dev/null
        exit 1
    fi
else
    # Already a Windows path, use as-is
    WIN_PATH="$FILE_PATH"
fi

# Find WinBoat binary
find_winboat() {
    # Check cache
    if [ -f "$HOME/.winboat/binary_path" ]; then
        CACHED=$(cat "$HOME/.winboat/binary_path")
        if [ -f "$CACHED" ] && [ -x "$CACHED" ]; then
            echo "$CACHED"
            return 0
        fi
    fi
    
    # Search common locations
    for DIR in "$HOME/AppImages" "$HOME/Applications" "$HOME/.local/bin"; do
        if [ -d "$DIR" ]; then
            FOUND=$(find "$DIR" -maxdepth 1 -iname "winboat*.AppImage" 2>/dev/null | head -1)
            if [ -n "$FOUND" ] && [ -x "$FOUND" ]; then
                echo "$FOUND"
                return 0
            fi
        fi
    done
    
    # System binary
    if command -v winboat &> /dev/null; then
        echo "winboat"
        return 0
    fi
    
    return 1
}

WINBOAT_BIN=$(find_winboat)

if [ -z "$WINBOAT_BIN" ]; then
    zenity --error --title="WinBoat Not Found" \
           --text="Could not find WinBoat.\nPlease install WinBoat first." \
           --width=400 2>/dev/null
    notify-send "WinBoat Error" "WinBoat not found" 2>/dev/null
    exit 1
fi

# Launch WinBoat with the file
exec "$WINBOAT_BIN" --launch-app "$WIN_PATH"
WRAPPER_EOF

chmod +x "$BIN_DIR/winboat-open"
echo -e "${GREEN}✓ Installed winboat-open to $BIN_DIR${NC}"

# 2. Create .desktop file for "Open with WinBoat"
echo -e "${BLUE}Creating desktop file...${NC}"
cat > "$DESKTOP_DIR/winboat-open.desktop" << 'DESKTOP_EOF'
[Desktop Entry]
Type=Application
Name=Open with WinBoat
Comment=Run Windows applications with WinBoat
Exec=winboat-open %f
Icon=winboat
Terminal=false
MimeType=application/x-msdownload;application/x-msdos-program;application/x-exe;application/x-winexe;
Categories=System;Utility;
NoDisplay=true
DESKTOP_EOF

echo -e "${GREEN}✓ Created desktop file${NC}"

# 3. Update desktop database
if command -v update-desktop-database &> /dev/null; then
    echo -e "${BLUE}Updating desktop database...${NC}"
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
    echo -e "${GREEN}✓ Desktop database updated${NC}"
fi

# 4. Add to PATH if not already there
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo ""
    echo -e "${BLUE}Note:${NC} $BIN_DIR is not in your PATH."
    echo "Add this line to your ~/.bashrc or ~/.zshrc:"
    echo ""
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

echo ""
echo -e "${GREEN}WinBoat System Integration installed successfully.${NC}"
echo ""
echo "You can now:"
echo "  - Right-click .exe files -> Open With -> WinBoat"
echo "  - Run: winboat-open /path/to/file.exe"
echo ""
echo "To uninstall, run:"
echo "  rm ~/.local/bin/winboat-open ~/.local/share/applications/winboat-open.desktop"
