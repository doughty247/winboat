# WinBoat Desktop Launcher Architecture

## Overview
WinBoat provides two experimental desktop integration features:
1. **App Shortcuts** - Native Linux shortcuts for Windows applications
2. **Open with WinBoat** - Right-click .exe files in file managers to launch them

## Architecture

### 1. App Shortcuts Feature

**Flow:**
```
Desktop Shortcut → winboat-launcher → WinBoat --launch-app "C:\Path\To\App.exe"
```

**Components:**
- **Desktop Files**: `~/.local/share/applications/<app>.desktop`
  - Contains: `Exec=/home/user/.local/bin/winboat-launcher "C:\\WINDOWS\\explorer.exe"`
  - Uses Windows paths (e.g., `C:\`, `D:\`) from guest system
  - Created by: `DesktopLauncherManager` in `src/renderer/lib/launcher.ts`

- **Wrapper Script**: `~/.local/bin/winboat-launcher`
  - Purpose: Find WinBoat binary dynamically (survives AppImage updates)
  - Input: Windows path from desktop file
  - Output: Calls `winboat --launch-app "<windows_path>"`
  - Created by: `installLauncherWrapper()` in `src/main/main.ts`
  - **No path conversion** - passes Windows paths straight through

- **Binary Path Cache**: `~/.winboat/binary_path`
  - Stores current WinBoat executable path
  - Updated on every app start
  - Used by wrapper scripts for fast binary lookup

### 2. Open with WinBoat Feature

**Flow:**
```
File Manager → winboat-open → Convert Linux→UNC → WinBoat --launch-app "\\host.lan\Data\file.exe"
```

**Components:**
- **Desktop File**: `~/.local/share/applications/winboat-open.desktop`
  - Contains: `Exec=/home/user/.local/bin/winboat-open %f`
  - Receives Linux file paths from file manager
  - MIME types: `.exe`, `.msi`, etc.
  - Created by: `OpenWithManager` in `src/renderer/lib/launcher.ts`

- **Handler Script**: `~/.local/bin/winboat-open`
  - Purpose: Convert Linux paths to Windows UNC paths
  - Input: Linux path (e.g., `/home/user/Downloads/app.exe`)
  - **Path Conversion**:
    ```bash
    /home/user/Downloads/app.exe
    → Strip $HOME: Downloads/app.exe
    → Add UNC prefix: \\host.lan\Data\Downloads\app.exe
    ```
  - Output: Calls `winboat --launch-app "\\host.lan\Data\..."`
  - Created by: `OpenWithManager.createHandlerScript()` in `src/renderer/lib/launcher.ts`

### Path Formats

| Feature | Input Path Format | Conversion | Final Path |
|---------|------------------|------------|------------|
| App Shortcuts | `C:\WINDOWS\explorer.exe` | None | `C:\WINDOWS\explorer.exe` |
| Open with WinBoat | `/home/user/file.exe` | Linux → UNC | `\\host.lan\Data\file.exe` |

### Key Implementation Details

**Why two separate scripts?**
- `winboat-launcher`: Generic wrapper for Windows paths (App Shortcuts)
- `winboat-open`: Specialized handler for Linux paths (Open with WinBoat)
- Separation ensures correct path handling for each use case

**UNC Path Format (`\\host.lan\Data\`)**
- Docker container mounts host `$HOME` as `/shared` internally
- Samba exposes `/shared` as network share named "Data"
- Full UNC path: `\\host.lan\Data\<relative_to_home>`
- **Critical**: Must include `\Data\` share name (not just `\\host.lan\`)

**Binary Discovery**
Both scripts use identical `find_winboat()` function:
1. Check `~/.winboat/binary_path` (fastest, always up-to-date)
2. Search common AppImage locations
3. Check system PATH
4. Fail gracefully with user notification

**WM_CLASS for Window Matching**
- Desktop shortcuts set `StartupWMClass=WinBoat-<exename>`
- Matches the WM_CLASS set by FreeRDP RemoteApp
- Allows KDE/GNOME to properly associate windows with launchers

## Code Locations

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| App Shortcuts Manager | `src/renderer/lib/launcher.ts` | 1-428 | Creates desktop files and icons |
| Open with WinBoat Manager | `src/renderer/lib/launcher.ts` | 429-618 | Creates file association handler |
| Wrapper Script Installer | `src/main/main.ts` | 174-251 | Creates `winboat-launcher` script |
| Binary Path Writer | `src/main/main.ts` | 253-267 | Updates `~/.winboat/binary_path` |
| Launch Request Handler | `src/renderer/App.vue` | 190-344 | Processes `--launch-app` IPC events |
| IPC Second Instance | `src/main/main.ts` | 467-491 | Forwards args to running instance |

## User-Facing Files

### Created by WinBoat
```
~/.winboat/
  └── binary_path              # Current WinBoat executable path

~/.local/bin/
  └── winboat-launcher         # App Shortcuts wrapper (Windows paths)
  └── winboat-open             # Open with WinBoat handler (Linux paths)

~/.local/share/applications/
  ├── <App>_<Name>.desktop     # Individual app shortcuts
  └── winboat-open.desktop     # File association handler

~/.local/share/icons/winboat/
  └── <app>.png                # Extracted app icons

~/.local/share/winboat/
  └── launchers.json           # Registry of created launchers

~/.local/share/desktop-directories/
  └── WinBoat.directory        # KDE application menu category

~/.config/menus/applications-merged/
  └── winboat.menu             # KDE menu integration
```

## Testing

### App Shortcuts
```bash
# Create shortcuts (in WinBoat UI: Config → App Shortcuts → Enable)
# Verify desktop files created
ls ~/.local/share/applications/*.desktop | grep -v winboat-open

# Check wrapper exists
cat ~/.local/bin/winboat-launcher

# Test manually
~/.local/bin/winboat-launcher "C:\\WINDOWS\\explorer.exe"
```

### Open with WinBoat
```bash
# Enable feature (in WinBoat UI: Config → Open with WinBoat → Enable)
# Verify handler created
cat ~/.local/bin/winboat-open

# Test manually with Linux path
~/.local/bin/winboat-open ~/Downloads/setup.exe
```

## Troubleshooting

### Desktop shortcuts don't work
1. Check if `winboat-launcher` exists and is executable
2. Verify `~/.winboat/binary_path` points to correct WinBoat binary
3. Check desktop file Exec line uses Windows path format

### "Open with WinBoat" opens wrong folder
1. Verify handler script has UNC conversion code
2. Check that `\Data\` is included in UNC path
3. Ensure Shared Home Folder is enabled in WinBoat

### WinBoat binary not found
1. Update `~/.winboat/binary_path` manually
2. Or delete it to force search in common locations
3. Ensure WinBoat AppImage is in `~/AppImages/`

## Future Improvements
- [ ] Automatic wrapper regeneration on binary path change
- [ ] System tray notification when shortcuts become outdated
- [ ] Support for portable WinBoat installations (non-AppImage)
- [ ] Better error handling with user-friendly dialogs
