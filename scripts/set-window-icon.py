#!/usr/bin/python3
"""
Set the _NET_WM_ICON property for an X11 window.
Usage: set-window-icon.py <window_id> <icon_path>
"""

import sys
import struct
from PIL import Image
import Xlib
from Xlib import X, display

def set_window_icon(window_id, icon_path):
    """Set the icon for a window using the _NET_WM_ICON property."""
    try:
        # Open display
        d = display.Display()
        
        # Get window
        win = d.create_resource_object('window', window_id)
        
        # Load and resize icon
        img = Image.open(icon_path)
        img = img.convert('RGBA')
        img = img.resize((48, 48), Image.Resampling.LANCZOS)
        
        # Convert to _NET_WM_ICON format: width, height, ARGB data
        width, height = img.size
        data = [width, height]
        
        for y in range(height):
            for x in range(width):
                r, g, b, a = img.getpixel((x, y))
                # Pack as ARGB in native byte order
                data.append((a << 24) | (r << 16) | (g << 8) | b)
        
        # Get _NET_WM_ICON atom
        _NET_WM_ICON = d.intern_atom('_NET_WM_ICON')
        CARDINAL = d.intern_atom('CARDINAL')
        
        # Set property
        win.change_property(_NET_WM_ICON, CARDINAL, 32, data)
        d.flush()
        
        print(f"Successfully set icon for window {window_id}")
        return True
        
    except Exception as e:
        print(f"Error setting icon: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: set-window-icon.py <window_id> <icon_path>", file=sys.stderr)
        sys.exit(1)
    
    try:
        window_id = int(sys.argv[1], 0)  # Support both decimal and hex
    except ValueError:
        print(f"Invalid window ID: {sys.argv[1]}", file=sys.stderr)
        sys.exit(1)
    
    icon_path = sys.argv[2]
    
    success = set_window_icon(window_id, icon_path)
    sys.exit(0 if success else 1)
