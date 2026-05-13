# WinBoat Desktop Launcher Testing Guide

## What Was Fixed

### Issue 1: App shortcuts not launching
**Root cause**: Added `/app-icon` flag that FreeRDP doesn't support + complex detached process spawning
**Fix**: 
- Removed `/app-icon` flag
- Simplified exec to standard callback (shell handles & backgrounding)
- Added comprehensive debug logging

### Issue 2: "Open with WinBoat" not working
**Root cause**: Path validation rejecting Linux absolute paths + path normalization breaking lookup
**Fix**:
- Removed strict Windows-only path validation in main.ts
- Added case-insensitive path normalization in App.vue
- Added verbose comparison logging

### Issue 3: Apps grouping incorrectly in task manager
**Fix**: Each app uses unique `/wm-class` (already implemented, just removed broken /app-icon)

## Testing Steps

### 1. Install New Build
```bash
# Copy to your AppImages folder (adjust path if needed)
cp /home/bazzite/Documents/winboat/winboat-clean/dist/winboat-0.8.7-x86_64.AppImage ~/AppImages/winboat.appimage

# Make executable if needed
chmod +x ~/AppImages/winboat.appimage

# Launch to update wrapper and binary path
~/AppImages/winboat.appimage
```

### 2. Test Desktop Shortcuts (Basic)
1. Open WinBoat app
2. Go to Apps tab
3. Right-click any app (e.g., Notepad)
4. Click "Create Desktop Shortcut"
5. Find shortcut in application menu (KDE: Start → WinBoat category)
6. Click shortcut
7. **Expected**: App launches in Windows guest, WinBoat window stays hidden/in tray

### 3. Test Multiple Shortcuts (Rapid Launch)
1. Create shortcuts for 3 different apps (Notepad, Calculator, Paint)
2. Click all 3 shortcuts quickly (within 2 seconds)
3. **Expected**: 
   - All 3 apps launch successfully
   - Each appears separately in task manager with different icons/names
   - No apps disappear or reappear
   - WinBoat window stays hidden

### 4. Test "Open with WinBoat" (Linux File)
```bash
# Test with a Windows executable in your home folder
# Example: if you have a portable .exe in Downloads
~/.local/bin/winboat-launcher ~/Downloads/some-app.exe

# Or right-click an .exe in file manager → Open With → WinBoat Launcher
```
**Expected**: 
- WinBoat window does NOT open
- App launches in Windows guest
- Path converts to `\\host.lan\Downloads\some-app.exe`
- Requires "Shared Home Folder" enabled in WinBoat settings

### 5. Check Logs if Issues Occur
```bash
# View launch logs
tail -f ~/.winboat/winboat.log

# Check wrapper execution (run in terminal to see output)
~/.local/bin/winboat-launcher "C:\\Windows\\System32\\notepad.exe"

# Look for these log lines:
# "[WinBoat] Looking for app with path: ..."
# "[WinBoat] Available apps: ..."
# "[WinBoat] Normalized requested path: ..."
# "[WinBoat] ✅ Found app: ..." OR "[WinBoat] ❌ App not found..."
# "Launch command: ..." (should show full FreeRDP command)
```

## Expected Behavior Summary

✅ **Working:**
- Desktop shortcuts launch apps in background (WinBoat window hidden)
- Multiple shortcuts launch independently without waiting
- Each app gets unique WM_CLASS for task manager
- "Open with WinBoat" works for .exe files in home folder
- Linux paths auto-convert to Windows UNC paths
- Queue processes requests sequentially with 100ms delay

❌ **Known Limitations:**
- "Open with WinBoat" only works for files under $HOME (Shared Home Folder requirement)
- KDE menu icon may not show until desktop database refreshes (run `kbuildsycoca6` if needed)
- Apps must exist in Windows guest's app list to be launched via shortcuts

## Troubleshooting

### Shortcut doesn't launch anything
1. Check if WinBoat is running (look for tray icon)
2. Check container is running: `docker ps | grep WinBoat`
3. Check logs: `tail -20 ~/.winboat/winboat.log`
4. Verify wrapper can find binary: `cat ~/.winboat/binary_path`

### "Open with WinBoat" does nothing
1. Ensure file is under $HOME: `echo $HOME`
2. Enable "Shared Home Folder" in WinBoat settings
3. Run wrapper manually to see errors: `~/.local/bin/winboat-launcher /path/to/file.exe`
4. Check if Windows path conversion is happening in logs

### App found but doesn't launch
1. Check FreeRDP command in logs (look for "Launch command:")
2. Test FreeRDP manually: Copy command from log and run in terminal
3. Check if FreeRDP is installed: `which xfreerdp` or `which xfreerdp3`
4. Verify Windows guest is responding: Test launching app from WinBoat UI

## Debug Mode

To get maximum verbosity, open browser console in WinBoat (Ctrl+Shift+I if dev tools enabled) and watch for:
- `[WinBoat] 📨 Received IPC launch request for: ...`
- `[WinBoat] Looking for app with path: ...`
- `[WinBoat] Comparing: "..." === "..."` (shows path matching logic)
- `[WinBoat] ✅ Found app:` or `[WinBoat] ❌ App not found`

All console.log output also goes to `~/.winboat/winboat.log`
