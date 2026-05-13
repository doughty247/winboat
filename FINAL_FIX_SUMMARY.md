# WinBoat Desktop Launcher - Final Fix Summary

## What Was Fixed

### Issue: App Shortcuts Broken ("App not found: C:\WINDOWS\explorer.exe")

**Root Cause**: Desktop shortcuts passed exact paths from guest server (like `%windir%\explorer.exe`), but the lookup was failing because:
1. Environment variables like `%windir%` were not being expanded
2. Normalization was too aggressive
3. No fallback matching by executable name

**Solution**: Implemented 3-tier matching strategy:

```typescript
// 1. Exact match (fastest)
app = apps.find(a => a.Path === appPath);

// 2. Normalized match (case-insensitive, slash normalization)
app = apps.find(a => normalize(a.Path) === normalize(appPath));

// 3. Executable name match (fallback for environment variable paths)
app = apps.find(a => {
    const appExe = a.Path.split('\\').pop()?.toLowerCase();
    const requestedExe = appPath.split('\\').pop()?.toLowerCase();
    return appExe === requestedExe;
});
```

### Issue: "Open with WinBoat" Not Working

**Solution**: Detect Linux paths (starting with `/`) and handle them separately:
- Linux paths are already converted to UNC by wrapper
- Create temporary app object and launch directly without looking up in apps list
- This allows launching arbitrary .exe files from shared folder

## How It Works Now

### Desktop Shortcuts (Windows Apps)
```
User clicks shortcut
  ↓
Wrapper passes: "%windir%\explorer.exe" or "C:\WINDOWS\explorer.exe"
  ↓
App.vue tries 3 matches:
  1. Exact: "%windir%\explorer.exe" === "%windir%\explorer.exe" ✅
  2. Normalized: "c:\windows\explorer.exe" === "c:\windows\explorer.exe" ✅
  3. Executable: "explorer.exe" === "explorer.exe" ✅
  ↓
Launch found app via FreeRDP
```

### Open with WinBoat (Linux Files)
```
User opens: /home/user/Downloads/app.exe
  ↓
Wrapper converts: \\host.lan\Downloads\app.exe
  ↓
App.vue detects Linux path (starts with \)
  ↓
Create temporary app object with UNC path
  ↓
Launch via FreeRDP without apps list lookup
```

## Testing

### 1. Test Desktop Shortcuts
```bash
# Install new build
cp ~/Documents/winboat/winboat-clean/dist/winboat-0.8.7-x86_64.AppImage ~/AppImages/winboat.appimage

# Launch WinBoat
~/AppImages/winboat.appimage

# Create shortcuts for Windows Explorer, Notepad, Calculator
# Click shortcuts → Should launch successfully
```

### 2. Test "Open with WinBoat"
```bash
# Enable "Shared Home Folder" in WinBoat settings first!

# Test with wrapper
~/.local/bin/winboat-launcher ~/Downloads/some-app.exe

# Or right-click .exe in file manager → Open With → WinBoat Launcher
```

### 3. Test Multiple Apps
```bash
# Click 3 different app shortcuts rapidly
# Expected:
#   - All 3 launch successfully
#   - Each appears in task manager with unique icon/name
#   - No error dialogs
#   - WinBoat stays hidden/in tray
```

## Expected Behavior

✅ **Desktop shortcuts work**: Match apps by executable name even if paths differ
✅ **"Open with WinBoat" works**: Launch arbitrary .exe from shared folder
✅ **No error dialogs**: Second-instance lock allows shortcuts through
✅ **Parallel launches**: All shortcuts launch immediately without queueing
✅ **Unique task manager entries**: Each app gets own WM_CLASS
✅ **Same app grouping**: Multiple instances of same app group together

## Troubleshooting

### "App not found" error
Check logs for matching attempts:
```bash
tail -50 ~/.winboat/winboat.log | grep -A5 "Looking for app"
```

You should see:
```
[WinBoat] Looking for app with path: C:\WINDOWS\explorer.exe
[WinBoat] Available apps: [...]
[WinBoat] Exact match failed, trying normalized: c:\windows\explorer.exe
[WinBoat] Trying to match by executable name: explorer.exe
[WinBoat] ✅ Matched by executable name: Windows Explorer at %windir%\explorer.exe
```

### "Open with" not working
1. **Enable Shared Home Folder**: Settings → Enable
2. **File must be in $HOME**: Only files under /home/user/ work
3. **Check conversion**:
   ```bash
   ~/.local/bin/winboat-launcher ~/Downloads/app.exe 2>&1 | grep "Converted"
   # Should show: [WinBoat Launcher] Converted Linux path to Windows UNC: \\host.lan\Downloads\app.exe
   ```

### Shortcuts show wrong app name
This happens if executable name matching is used. The app will launch correctly but show the guest server's name. To fix:
```bash
# Recreate shortcuts to get latest paths
rm ~/.local/share/applications/winboat-*.desktop
# Open WinBoat UI → Apps tab → Auto-sync or manually create shortcuts
```

## Technical Details

### Matching Priority
1. **Exact match**: Fastest, works when paths are identical
2. **Normalized match**: Handles case differences and slash variations
3. **Executable name match**: Handles environment variable expansion differences

### Linux Path Detection
```typescript
const isLinuxPath = appPath.startsWith('/');
// OR after wrapper conversion:
const isLinuxPath = appPath.startsWith('\\\\');
```

### WM_CLASS Generation
```typescript
const exeName = app.Path.split('\\').pop()?.replace('.exe', '');
const wmClass = `WinBoat-${exeName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
```

## Files Changed

- **src/renderer/App.vue**: 3-tier matching + Linux path handling
- **src/renderer/lib/launcher.ts**: Added StartupWMClass to desktop files
- **src/renderer/lib/winboat.ts**: Unique WM_CLASS per executable
- **src/main/main.ts**: Fixed single-instance lock timing

## New AppImage

- **Location**: `~/Documents/winboat/winboat-clean/dist/winboat-0.8.7-x86_64.AppImage`
- **Size**: 272 MB
- **Built**: October 14, 2025 @ 19:15
- **Changes**: Robust app matching + Linux path support + WM_CLASS fixes
