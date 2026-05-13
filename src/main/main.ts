import { app, BrowserWindow, ipcMain, session, dialog, Notification, Tray, Menu, nativeImage } from 'electron';
import { join } from 'path';
import { initialize, enable } from '@electron/remote/main/index.js';
import Store from 'electron-store';
import * as fs from 'fs';
import * as os from 'os';

// Suppress EPIPE errors BEFORE anything else (must be first!)
process.on('uncaughtException', (err) => {
    if ((err as any).code === 'EPIPE') {
        // Silently ignore EPIPE errors (no terminal attached)
        return;
    }
    // Re-throw other errors
    console.error('Uncaught exception:', err);
    throw err;
});

process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') return;
});

process.stderr.on('error', (err) => {
    if (err.code === 'EPIPE') return;
});

initialize();

// Window Constants
const WINDOW_MIN_WIDTH = 1280;
const WINDOW_MIN_HEIGHT = 800;

// For electron-store Type-Safety
type SchemaType = {
    dimensions: {
        width: number,
        height: number
    },
    position: {
        x: number,
        y: number
    }
};

const windowStore = new Store<SchemaType>({ schema: {
    dimensions: {
        type: 'object',
        properties: {
            width: {
                type: 'number',
                minimum: WINDOW_MIN_WIDTH,
                default: WINDOW_MIN_WIDTH
            },
            height: {
                type: 'number',
                minimum: WINDOW_MIN_HEIGHT,
                default: WINDOW_MIN_HEIGHT
            },
        },
        required: ['width', 'height']
    },
    position: {
        type: 'object',
        properties: {
            x: {
                type: 'number'
            },
            y: {
                type: 'number'
            }
        },
        required: ['x', 'y']
    }
}});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Check for --launch-app argument early (needed in multiple places)
const launchAppIndex = process.argv.findIndex(arg => arg === '--launch-app');
const hasLaunchAppArg = launchAppIndex !== -1 && !!process.argv[launchAppIndex + 1];
console.log('[WinBoat] Startup check - launchAppIndex:', launchAppIndex, 'hasLaunchAppArg:', hasLaunchAppArg);

/**
 * Creates a system tray icon for WinBoat
 */
function createTray() {
    // Create tray icon
    const iconPath = join(app.getAppPath(), 'icons', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show WinBoat GPU Plus',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                }
            }
        },
        {
            label: 'Hide WinBoat GPU Plus',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit WinBoat GPU Plus',
            click: () => {
                console.log('[WinBoat] Quit requested from tray menu');
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setContextMenu(contextMenu);
    tray.setToolTip('WinBoat GPU Plus - Windows App Integration');
    
    // Double-click to show window
    tray.on('double-click', () => {
        if (mainWindow) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
            }
        }
    });
}

/**
 * Searches for WinBoat AppImage in common locations
 */
function findWinBoatAppImage(): string | null {
    const homeDir = os.homedir();
    const searchPaths = [
        join(homeDir, 'AppImages'),
        join(homeDir, 'Applications'),
        join(homeDir, '.local', 'bin'),
        join(homeDir, 'Downloads'),
        join(homeDir, 'Desktop')
    ];
    
    for (const searchPath of searchPaths) {
        if (!fs.existsSync(searchPath)) continue;
        
        try {
            const files = fs.readdirSync(searchPath);
            for (const file of files) {
                if (file.toLowerCase().startsWith('winboat') && file.endsWith('.AppImage')) {
                    const fullPath = join(searchPath, file);
                    // Verify it's executable
                    try {
                        fs.accessSync(fullPath, fs.constants.X_OK);
                        return fullPath;
                    } catch {
                        continue;
                    }
                }
            }
        } catch (error) {
            console.warn('[WinBoat] Could not read directory:', searchPath);
        }
    }
    
    return null;
}

/**
 * Install the launcher wrapper script to ~/.local/bin
 * This script dynamically finds WinBoat, so shortcuts never break
 */
function installLauncherWrapper() {
    try {
        const localBinDir = join(os.homedir(), '.local', 'bin');
        const wrapperPath = join(localBinDir, 'winboat-launcher');
        const freerdpLauncherPath = join(localBinDir, 'winboat-freerdp-launcher');
        
        // Create ~/.local/bin if it doesn't exist
        if (!fs.existsSync(localBinDir)) {
            fs.mkdirSync(localBinDir, { recursive: true });
        }
        
        // Install the FreeRDP launcher script
        try {
            const freerdpLauncherSrc = join(process.resourcesPath, 'scripts', 'winboat-freerdp-launcher.sh');
            if (fs.existsSync(freerdpLauncherSrc)) {
                fs.copyFileSync(freerdpLauncherSrc, freerdpLauncherPath);
                fs.chmodSync(freerdpLauncherPath, 0o755);
                console.log('[WinBoat] Installed FreeRDP launcher to:', freerdpLauncherPath);
            } else {
                console.warn('[WinBoat] FreeRDP launcher script not found at:', freerdpLauncherSrc);
            }
        } catch (error) {
            console.error('[WinBoat] Failed to install FreeRDP launcher:', error);
        }
        
        const wrapperScript = `#!/bin/bash
# WinBoat Launcher Wrapper
# This script dynamically finds and launches WinBoat with the provided app path

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
    zenity --error --title="WinBoat Not Found" \\
           --text="Could not find WinBoat binary.\\nPlease install WinBoat or check ~/.winboat/binary_path" \\
           --width=400 2>/dev/null
    notify-send "WinBoat Error" "Could not find WinBoat binary" 2>/dev/null
    exit 1
fi

# Launch WinBoat with the app path
exec "$WINBOAT_BIN" --launch-app "$APP_PATH"
`;
        
        fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 });
        console.log('[WinBoat] Installed launcher wrapper to:', wrapperPath);
    } catch (error) {
        console.error('[WinBoat] Failed to install launcher wrapper:', error);
    }
}

/**
 * Write the WinBoat binary path to ~/.winboat/binary_path
 * This is used by desktop shortcuts to find the WinBoat executable
 */
function writeBinaryPath() {
    try {
        const winboatDir = join(os.homedir(), '.winboat');
        const binaryPathFile = join(winboatDir, 'binary_path');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(winboatDir)) {
            fs.mkdirSync(winboatDir, { recursive: true });
        }
        
        let execPath: string;
        
        // For AppImage, search for it in common locations
        if (process.env.APPIMAGE) {
            const foundAppImage = findWinBoatAppImage();
            if (foundAppImage) {
                execPath = foundAppImage;
                console.log('[WinBoat] Found AppImage at:', foundAppImage);
            } else {
                // Fallback to APPIMAGE env var if search fails
                execPath = process.env.APPIMAGE;
                console.warn('[WinBoat] Could not find AppImage in common locations, using env var');
            }
        } else {
            // For other formats (system install, etc), use process.execPath
            execPath = process.execPath;
        }
        
        fs.writeFileSync(binaryPathFile, execPath, 'utf-8');
        console.log('[WinBoat] Wrote binary path to:', binaryPathFile, '(', execPath, ')');
    } catch (error) {
        console.error('[WinBoat] Failed to write binary path:', error);
    }
}

function createWindow() {
    // Check for headless mode
    const headlessMode = process.argv.includes('--headless');
    
    console.log('[WinBoat] Full process.argv:', process.argv);
    console.log('[WinBoat] --launch-app index:', launchAppIndex);
    
    // If this is the first instance starting with --launch-app, store it for renderer
    if (hasLaunchAppArg) {
        const appPath = process.argv[launchAppIndex + 1];
        console.log('[WinBoat] CLI launch requested for app:', appPath);
        (global as any).launchAppOnStartup = appPath;
    }

    mainWindow = new BrowserWindow({
        width: windowStore.get('dimensions.width'),
        height: windowStore.get('dimensions.height'),
        x: windowStore.get('position.x'),
        y: windowStore.get('position.y'),
        transparent: false,
        frame: false,
        show: !headlessMode && !hasLaunchAppArg,  // Hide if headless mode or launching an app
        icon: join(app.getAppPath(), 'icons', 'icon.png'),
        webPreferences: {
            // preload: join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        }
    });

    // If launched with --launch-app, do not show main window, just process the launch in background
    if (hasLaunchAppArg) {
        mainWindow.hide();
    }

    mainWindow.on('close', (event) => {
        const bounds = mainWindow?.getBounds();

        windowStore.set('dimensions', {
            width: bounds?.width,
            height: bounds?.height
        });

        windowStore.set('position', {
            x: bounds?.x,
            y: bounds?.y
        });
        
        // Prevent window from closing, just hide it instead (run in background)
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });

    enable(mainWindow.webContents);

    if (process.env.NODE_ENV === 'development') {
        const rendererPort = process.argv[2];
        mainWindow.loadURL(`http://localhost:${rendererPort}`);
    }
    else {
        mainWindow.loadFile(join(app.getAppPath(), 'renderer', 'index.html'));
    }
}

// Single instance lock - always enforce it BEFORE app.whenReady()
// Use app name to identify instances (AppImage mounts have different paths)
const gotLock = app.requestSingleInstanceLock({ 'winboat-instance-id': 'winboat' });

if (!gotLock) {
    console.log('[WinBoat] Secondary instance detected - primary instance will handle the request.');
    app.quit();
    // Exit immediately - don't continue with app setup
} else {
    // Listen for secondary instance launches and handle their --launch-app requests
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        console.log('[WinBoat] Second instance attempted to start:', commandLine);
        
        // Extract --launch-app argument from secondary instance
        const launchIndex = commandLine.findIndex(arg => arg === '--launch-app');
        if (launchIndex !== -1 && commandLine[launchIndex + 1]) {
            // Find the app path - skip any Electron flags that might be injected
            let appPath = '';
            for (let i = launchIndex + 1; i < commandLine.length; i++) {
                const arg = commandLine[i];
                // Skip Electron internal flags (start with --)
                if (!arg.startsWith('--')) {
                    appPath = arg;
                    break;
                }
            }
            
            if (appPath) {
                console.log('[WinBoat] Received launch request from second instance:', appPath);
                
                // Send launch request to renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('launch-app-request', appPath);
                    
                    // Show brief notification
                    const notification = new Notification({
                        title: 'WinBoat',
                        body: 'Starting application...',
                        silent: true
                    });
                    notification.show();
                    setTimeout(() => notification.close(), 3000);
                }
            }
        }
        
        // Don't focus/show main window - keep it hidden for headless operation
    });

    app.whenReady().then(() => {
    // Always create system tray icon for the single instance
    createTray();
    
    // Write binary path on every startup
    writeBinaryPath();
    
    // Install the launcher wrapper script
    installLauncherWrapper();
    
    // Check for CLI arguments (e.g., --launch-app "C:\path\to\app.exe")
    // Find --launch-app in the raw argv (don't filter, just find the index)
    console.log('[WinBoat] Full process.argv:', JSON.stringify(process.argv, null, 2));
    const launchAppIndex = process.argv.findIndex(arg => arg === '--launch-app');
    console.log('[WinBoat] --launch-app index:', launchAppIndex);
    
    if (launchAppIndex !== -1 && process.argv[launchAppIndex + 1]) {
        const appPath = process.argv[launchAppIndex + 1];
        console.log('[WinBoat] CLI launch requested for app:', appPath);
        
        // Store the app to launch after window is ready (accept flexible formats)
        (global as any).launchAppOnStartup = appPath;
        
        // Show a minimal loading notification
        const notification = new Notification({
            title: 'WinBoat',
            body: 'Starting application...',
            silent: true
        });
        notification.show();
        
        // Auto-close notification after 5 seconds
        setTimeout(() => notification.close(), 5000);
    }
    
    createWindow();

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                // 'Content-Security-Policy': ['script-src \'self\'']
                'Content-Security-Policy': [
                    "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline'",
                    "worker-src 'self' blob:",
                    "media-src 'self' blob:",
                    "font-src 'self' 'unsafe-inline' https://fonts.gstatic.com;",
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"
                ]
            }
        })
    })

    app.on('activate', function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        } else if (mainWindow) {
            // On Linux/Windows, show the existing window if it's hidden
            mainWindow.show();
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
});

app.on('before-quit', () => {
    isQuitting = true;
    console.log('[WinBoat] Application quitting, cleaning up...');
    
    // Destroy tray icon
    if (tray) {
        tray.destroy();
        tray = null;
    }
    
    // Close main window
    if (mainWindow) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
        mainWindow = null;
    }
});

app.on('window-all-closed', function () {
    // Don't quit on window close - we're running in background with tray
    // Only quit if explicitly requested (via tray menu or app.quit())
});

app.on("second-instance", (event, commandLine, workingDirectory) => {
    console.log('[WinBoat] Second instance detected, focusing main window');
    
    // Focus the main WinBoat UI window
    // Note: --launch-app instances are allowed to run separately now
    if(mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
})

ipcMain.on('message', (event, message) => {
    console.log(message);
})

// Handle getting home directory for path conversion
ipcMain.handle('get-home-dir', () => {
    return os.homedir();
})

// Handle launch app request from renderer (for this instance only)
ipcMain.on('get-launch-app-request', (event) => {
    const appToLaunch = (global as any).launchAppOnStartup;
    if (appToLaunch) {
        event.reply('launch-app-startup', appToLaunch);
        // Clear it so it doesn't launch again
        (global as any).launchAppOnStartup = null;
    }
})

} // End of gotLock else block