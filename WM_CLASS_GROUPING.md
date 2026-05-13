# WinBoat Task Manager Grouping - Technical Explanation

## The Problem
Previously, all WinBoat RemoteApp windows appeared as the same entry in the task manager because they shared the same WM_CLASS.

## The Solution
Each app now gets a **unique WM_CLASS** based on its executable name:

### How It Works

**1. Executable Name Extraction**
```typescript
// From path: "C:\Windows\System32\notepad.exe"
// Extract: "notepad.exe"
const exeName = app.Path.split('\\').pop()?.replace('.exe', '') || cleanAppName;
```

**2. WM_CLASS Generation**
```typescript
// Convert to: "WinBoat-notepad"
const wmClass = `WinBoat-${exeName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
```

**3. FreeRDP Command**
```bash
xfreerdp3 ... /wm-class:"WinBoat-notepad" /app:program:"C:\Windows\System32\notepad.exe" &
```

**4. Desktop File**
```ini
[Desktop Entry]
Name=Notepad
StartupWMClass=WinBoat-notepad
...
```

## Examples

| App Path | WM_CLASS | Task Manager Entry |
|----------|----------|-------------------|
| `C:\Windows\System32\notepad.exe` | `WinBoat-notepad` | Notepad (unique) |
| `C:\Windows\System32\calc.exe` | `WinBoat-calc` | Calculator (unique) |
| `C:\Program Files\app.exe` | `WinBoat-app` | App (unique) |

## Expected Behavior

✅ **Different apps**: Show as separate entries with unique icons
- Notepad, Calculator, Paint each get their own task manager entry
- Each has its own window grouping

✅ **Multiple instances of SAME app**: Group together
- 3 Notepad windows → grouped under "Notepad" with count badge
- Click the entry to see all instances

✅ **KDE Integration**: StartupWMClass allows KDE to:
- Match running windows to desktop shortcuts
- Show "running" indicator on shortcuts
- Group related windows properly

## Testing

### 1. Different Apps Test
```bash
# Create shortcuts for 3 different apps
# Launch all 3
# Expected: 3 separate task manager entries
```

### 2. Same App Test
```bash
# Launch Calculator shortcut 3 times
# Expected: 1 task manager entry showing "3" badge
```

### 3. Verification
Check the WM_CLASS of a running window:
```bash
xprop WM_CLASS
# Click on a WinBoat RemoteApp window
# Output should show: WM_CLASS(STRING) = "WinBoat-notepad", "WinBoat-notepad"
```

Check the desktop file:
```bash
cat ~/.local/share/applications/winboat-notepad.desktop | grep StartupWMClass
# Output: StartupWMClass=WinBoat-notepad
```

## Troubleshooting

### Apps still grouping together?
1. **Clear existing shortcuts**: Delete all WinBoat shortcuts and recreate them
   ```bash
   rm ~/.local/share/applications/winboat-*.desktop
   ```
2. **Restart WinBoat**: Close and reopen to regenerate shortcuts
3. **Refresh desktop database**: 
   ```bash
   update-desktop-database ~/.local/share/applications
   kbuildsycoca6  # KDE only
   ```

### WM_CLASS not showing correctly?
Check the logs:
```bash
tail -20 ~/.winboat/winboat.log | grep "WM_CLASS"
# Should show: "Using WM_CLASS: WinBoat-notepad for app: Notepad"
```

### KDE not matching windows to shortcuts?
Ensure StartupWMClass matches the FreeRDP /wm-class:
```bash
# Check desktop file
grep StartupWMClass ~/.local/share/applications/winboat-*.desktop

# Check running window
xprop WM_CLASS  # Click window, compare values
```

## Technical Notes

- **WM_CLASS format**: Always lowercase, alphanumeric only
- **StartupWMClass**: Must match exactly for KDE integration
- **Icon inheritance**: Windows use desktop file icon when matched
- **Grouping logic**: Window manager groups by first WM_CLASS component

## Compatibility

✅ **KDE Plasma**: Full support with StartupWMClass
✅ **GNOME**: Groups by WM_CLASS automatically
✅ **XFCE**: Basic grouping support
✅ **Other DEs**: May vary, but unique WM_CLASS always works
