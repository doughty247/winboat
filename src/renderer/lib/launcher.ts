import { GUEST_API_PORT, GUEST_RDP_PORT } from "./constants";
import type { WinApp } from "../../types";
import type { Winboat } from "./winboat";
import { getFreeRDP } from "../utils/getFreeRDP";

const nodeFetch: typeof import('node-fetch').default = require('node-fetch');
const fs: typeof import('fs') = require('fs');
const path: typeof import('path') = require('path');
const os: typeof import('os') = require('os');
const { exec }: typeof import('child_process') = require('child_process');
const { promisify }: typeof import('util') = require('util');
const execAsync = promisify(exec);

/**
 * Simple manager for creating Linux desktop launchers for Windows apps
 * 
 * ⚠️ EXPERIMENTAL FEATURE
 * This feature creates system-level desktop files and scripts.
 * Use at your own risk.
 */
export class DesktopLauncherManager {
    private winboat: Winboat;
    private readonly REGISTRY_FILE: string;

    constructor(winboat: Winboat) {
        this.winboat = winboat;
        const homeDir = os.homedir();
        this.REGISTRY_FILE = path.join(homeDir, '.local', 'share', 'winboat', 'launchers.json');
        
        // Ensure WinBoat category exists in desktop directories
        this.ensureWinBoatCategory();
    }

    /**
     * Creates the WinBoat.directory file and menu entry so KDE recognizes our custom category
     */
    private async ensureWinBoatCategory(): Promise<void> {
        try {
            const homeDir = os.homedir();
            // Create directory file with correct icon
            const directoriesDir = path.join(homeDir, '.local', 'share', 'desktop-directories');
            await fs.promises.mkdir(directoriesDir, { recursive: true });
            const directoryFile = path.join(directoriesDir, 'WinBoat.directory');
            const iconPath = path.join(homeDir, 'Documents', 'winboat', 'winboat-clean', 'icons', 'icon.png');
            const content = `[Desktop Entry]\nName=WinBoat\nIcon=${iconPath}\nType=Directory\n`;
            await fs.promises.writeFile(directoryFile, content, { mode: 0o644 });
            console.log('[Launcher] Created WinBoat.directory file with winboat icon');

            // Create menu file for KDE/freedesktop menu integration
            const menusDir = path.join(homeDir, '.config', 'menus', 'applications-merged');
            await fs.promises.mkdir(menusDir, { recursive: true });
            const menuFile = path.join(menusDir, 'winboat.menu');
            const menuContent = `<!DOCTYPE Menu PUBLIC "-//freedesktop//DTD Menu 1.0//EN"\n "http://www.freedesktop.org/standards/menu-spec/1.0/menu.dtd">\n\n<Menu>\n  <Name>Applications</Name>\n  <Menu>\n    <Name>WinBoat</Name>\n    <Directory>WinBoat.directory</Directory>\n    <Include>\n      <Category>X-WinBoat-App</Category>\n    </Include>\n  </Menu>\n</Menu>`;
            await fs.promises.writeFile(menuFile, menuContent, { mode: 0o644 });
            console.log('[Launcher] Created WinBoat.menu file for KDE menu integration');
        } catch (error) {
            console.warn('[Launcher] Failed to create WinBoat category files:', error);
        }
    }

    /**
     * Creates a desktop launcher for a Windows app
     * @param app The Windows app to create launcher for
     * @param customName Optional custom name (defaults to app.name)
     */
    async createLauncher(app: WinApp, customName?: string): Promise<void> {
        const appName = customName || app.Name;
        const safeFileName = appName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
        
        // Setup paths
        const homeDir = os.homedir();
        const appsDir = path.join(homeDir, '.local', 'share', 'applications');
        const iconDir = path.join(homeDir, '.local', 'share', 'icons', 'winboat');
        
        // Create directories
        await fs.promises.mkdir(appsDir, { recursive: true });
        await fs.promises.mkdir(iconDir, { recursive: true });

        // Extract icon (robust: auto-start API if needed, fallback gracefully)
        let iconPath = 'utilities-terminal'; // fallback
        if (app.Path) {
            try {
                const iconFile = path.join(iconDir, `${safeFileName}.png`);
                await this.extractIcon(app.Path, iconFile);
                iconPath = iconFile;
            } catch (error) {
                console.warn('[Launcher] Icon extraction failed, using default:', error);
            }
        }

        // Generate .desktop file that calls WinBoat with --launch-app argument
        const desktopPath = path.join(appsDir, `${safeFileName}.desktop`);
        const desktopContent = this.generateDesktopEntry(appName, app.Path, iconPath);
        await fs.promises.writeFile(desktopPath, desktopContent, { mode: 0o644 });

        // Update registry (scriptPath is empty as we no longer use standalone scripts)
        await this.addOrUpdateRegistry(appName, '', desktopPath, iconPath.startsWith('/') ? iconPath : '');

        // Update desktop database (ignore errors)
        try {
            await execAsync(`update-desktop-database "${appsDir}"`);
        } catch (e) {
            // Not critical if this fails
        }
    }

    /**
     * Removes all WinBoat launchers from the system
     */
    async removeAllLaunchers(): Promise<number> {
        let removedCount = 0;

        try {
            // Read registry
            const launchers = await this.getRegistry();
            
            // Delete each launcher's files
            for (const launcher of launchers) {
                try {
                    // Delete script file
                    if (launcher.scriptPath && await this.fileExists(launcher.scriptPath)) {
                        await fs.promises.unlink(launcher.scriptPath);
                    }
                    
                    // Delete desktop file
                    if (launcher.desktopPath && await this.fileExists(launcher.desktopPath)) {
                        await fs.promises.unlink(launcher.desktopPath);
                    }
                    
                    // Delete icon file
                    if (launcher.iconPath && await this.fileExists(launcher.iconPath)) {
                        await fs.promises.unlink(launcher.iconPath);
                    }
                    
                    removedCount++;
                } catch (error) {
                    console.warn(`Failed to remove launcher ${launcher.name}:`, error);
                }
            }

            // Clear registry
            await this.clearRegistry();

            // Update desktop database
            const homeDir = os.homedir();
            const appsDir = path.join(homeDir, '.local', 'share', 'applications');
            try {
                await execAsync(`update-desktop-database "${appsDir}"`);
            } catch (e) {
                // Not critical
            }

        } catch (error) {
            console.error('Failed to remove launchers:', error);
        }

        return removedCount;
    }

    /**
     * Synchronize system launchers with the provided app list.
     * - Creates/updates launchers for all eligible apps
     * - Removes launchers that no longer exist in the app list
     */
    async syncAll(apps: WinApp[]): Promise<{ created: number; removed: number }> {
        
        const eligible = apps.filter(a => {
            // Skip NOVNC/browse-only placeholders
            const p = (a.Path || '').toLowerCase();
            if (!p) return false;
            if (p.includes('novnc')) return false;
            // Heuristic: only Windows executables or internal desktop/explorer
            return p.endsWith('.exe') || p.includes('explorer.exe') || a.Name.toLowerCase().includes('windows desktop');
        });

        let created = 0;
        for (const app of eligible) {
            try {
                await this.createLauncher(app);
                created++;
            } catch (e) {
                console.error(`[Launcher] Failed to create launcher for ${app.Name}:`, e);
            }
        }

        // Remove launchers that aren't in current app set
        const existing = await this.getRegistry();
        const desiredNames = new Set(eligible.map(a => a.Name));
        let removed = 0;
        for (const entry of existing) {
            if (!desiredNames.has(entry.name)) {
                try {
                    if (entry.scriptPath && await this.fileExists(entry.scriptPath)) await fs.promises.unlink(entry.scriptPath);
                    if (entry.desktopPath && await this.fileExists(entry.desktopPath)) await fs.promises.unlink(entry.desktopPath);
                    if (entry.iconPath && await this.fileExists(entry.iconPath)) await fs.promises.unlink(entry.iconPath);
                    removed++;
                } catch (e) {
                    console.warn(`[Launcher] Failed to remove obsolete launcher ${entry.name}:`, e);
                }
            }
        }
        // Rewrite registry to only desired
        const newRegistry: LauncherEntry[] = (await this.getRegistry()).filter(e => desiredNames.has(e.name));
        await this.writeRegistry(newRegistry);

        // Refresh desktop database
        const homeDir = os.homedir();
        const appsDir = path.join(homeDir, '.local', 'share', 'applications');
        try { await execAsync(`update-desktop-database "${appsDir}"`); } catch {}

        return { created, removed };
    }

    /**
     * Gets list of all created launchers
     */
    async getCreatedLaunchers(): Promise<string[]> {
        const launchers = await this.getRegistry();
        return launchers.map(l => l.name);
    }

    /**
     * Extracts icon from Windows app via Guest API
     */
    private async extractIcon(windowsPath: string, outputFile: string): Promise<void> {
        // Ensure API is healthy; auto-start the container as needed (parity with legacy script)
        const waitMs = 60_000;
        const intervalMs = 1_000;
        if (!(await this.winboat.getHealth())) {
            try { await this.winboat.startContainer(); } catch {}
            const start = Date.now();
            while (!(await this.winboat.getHealth()) && (Date.now() - start) < waitMs) {
                await new Promise(r => setTimeout(r, intervalMs));
            }
            if (!(await this.winboat.getHealth())) {
                // Fallback: skip icon extraction
                throw new Error('Guest API is not available');
            }
            // small warm-up
            await new Promise(r => setTimeout(r, 3_000));
        }

        // Call /get-icon endpoint
        const apiPort = this.winboat.getHostPort(GUEST_API_PORT);
        const apiUrl = `http://127.0.0.1:${apiPort}`;
        
        const formData = new URLSearchParams();
        formData.append('path', windowsPath);
        
        const response = await nodeFetch(`${apiUrl}/get-icon`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Icon extraction failed: ${response.statusText}`);
        }

        // Get base64 response and decode
        const base64Data = (await response.text()).trim().replace(/^data:image\/[^;]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        await fs.promises.writeFile(outputFile, imageBuffer);
    }

    /**
     * Generates the launcher bash script
     * Creates a standalone script that mimics WinBoat's launchApp() behavior
     */
    private generateScript(username: string, password: string, rdpPort: number, appPath: string, appName: string): string {
        return `#!/usr/bin/env bash
# WinBoat ${appName} Launcher (auto-generated)
# Mimics Winboat.launchApp() behavior - just launch xfreerdp directly

# Credentials and connection info
USERNAME="${username}"
PASSWORD="${password}"
RDP_PORT="${rdpPort}"
APP_PATH="${appPath}"
APP_NAME="${appName}"

# Find FreeRDP 3.x binary (same detection as WinBoat)
find_freerdp() {
    for cmd in "xfreerdp3" "xfreerdp" "flatpak run --command=xfreerdp com.freerdp.FreeRDP"; do
        if $cmd --version 2>/dev/null | grep -q "version 3\\."; then
            echo "$cmd"
            return 0
        fi
    done
    return 1
}

FREERDP_BIN=$(find_freerdp)
if [ -z "$FREERDP_BIN" ]; then
    notify-send -u critical "WinBoat" "FreeRDP 3.x not found!" 2>/dev/null || true
    echo "Error: FreeRDP 3.x not found on system" >&2
    exit 1
fi

# Build xfreerdp command exactly like WinBoat does
# See: src/renderer/lib/winboat.ts launchApp() method
$FREERDP_BIN \\
    /u:"$USERNAME" \\
    /p:"$PASSWORD" \\
    /v:127.0.0.1 \\
    /port:$RDP_PORT \\
    /cert:ignore \\
    +clipboard \\
    -wallpaper \\
    /sound:sys:pulse \\
    /microphone:sys:pulse \\
    /floatbar \\
    /compression \\
    /scale-desktop:100 \\
    /wm-class:"$APP_NAME" \\
    /app:program:"$APP_PATH",name:"$APP_NAME" &
`;
    }

    /**
     * Generates the .desktop file that calls WinBoat with --launch-app
     */
    private generateDesktopEntry(appName: string, appPath: string, iconPath: string): string {
        // Use a stable wrapper script that dynamically finds WinBoat
        // This way shortcuts never break even if the binary path changes
        const homeDir = os.homedir();
        const wrapperScript = path.join(homeDir, '.local', 'bin', 'winboat-launcher');
        
        // Escape backslashes in the Windows path for proper shell handling
        // Each backslash needs to be doubled for desktop file format
        const escapedAppPath = appPath.replace(/\\/g, '\\\\');
        
        // Don't set StartupWMClass since FreeRDP uses a shared WM_CLASS for all RemoteApp windows
        // This allows the desktop launcher icon to be preserved instead of being overridden by FreeRDP
        
        return `[Desktop Entry]
Type=Application
Name=${appName}
Comment=Launch ${appName} via WinBoat
Exec="${wrapperScript}" "${escapedAppPath}"
Icon=${iconPath.startsWith('/') ? iconPath : '/home/bazzite/Documents/winboat/winboat-clean/icons/icon.png'}
Terminal=false
Categories=X-WinBoat-App;
StartupNotify=true
`;
    }

    /**
     * Registry helpers - track created launchers
     */
    private async getRegistry(): Promise<LauncherEntry[]> {
        try {
            if (await this.fileExists(this.REGISTRY_FILE)) {
                const data = await fs.promises.readFile(this.REGISTRY_FILE, 'utf-8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.warn('Failed to read launcher registry:', error);
        }
        return [];
    }

    /**
     * Build launcher data for script generation
     * Returns all info needed to create a standalone launcher script
     */
    async buildLauncherData(app: WinApp): Promise<{username: string, password: string, rdpPort: number, appPath: string, appName: string}> {
        const { username, password } = this.winboat.getCredentials();
        const rdpPort = this.winboat.getHostPort(GUEST_RDP_PORT);
        const cleanAppName = app.Name.replace(/[,.'"]/g, "");
        
        return {
            username,
            password,
            rdpPort,
            appPath: app.Path,
            appName: cleanAppName
        };
    }

    private async addOrUpdateRegistry(name: string, scriptPath: string, desktopPath: string, iconPath: string): Promise<void> {
        const launchers = await this.getRegistry();
        const idx = launchers.findIndex(l => l.name === name);
        const entry: LauncherEntry = { name, scriptPath, desktopPath, iconPath };
        if (idx >= 0) launchers[idx] = entry; else launchers.push(entry);
        await this.writeRegistry(launchers);
    }

    private async clearRegistry(): Promise<void> {
        try {
            if (await this.fileExists(this.REGISTRY_FILE)) {
                await fs.promises.unlink(this.REGISTRY_FILE);
            }
        } catch (error) {
            console.warn('Failed to clear registry:', error);
        }
    }

    private async writeRegistry(content: LauncherEntry[]): Promise<void> {
        const registryDir = path.dirname(this.REGISTRY_FILE);
        await fs.promises.mkdir(registryDir, { recursive: true });
        await fs.promises.writeFile(this.REGISTRY_FILE, JSON.stringify(content, null, 2));
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Registry entry for tracking created launchers
 */
interface LauncherEntry {
    name: string;
    scriptPath: string;
    desktopPath: string;
    iconPath: string;
}

/**
 * Manager for "Open with WinBoat" file association
 * Creates a .desktop file that allows right-clicking .exe files in file managers
 * 
 * ⚠️ EXPERIMENTAL FEATURE - Requires Shared Home Folder to be enabled
 */
export class OpenWithManager {
    private winboat: Winboat;
    private readonly SCRIPT_PATH: string;
    private readonly DESKTOP_PATH: string;

    constructor(winboat: Winboat) {
        this.winboat = winboat;
        const homeDir = os.homedir();
        this.SCRIPT_PATH = path.join(homeDir, '.local', 'bin', 'winboat-open');
        this.DESKTOP_PATH = path.join(homeDir, '.local', 'share', 'applications', 'winboat-open.desktop');
    }

    /**
     * Enables "Open with WinBoat" by creating the handler script and .desktop file
     */
    async enable(): Promise<void> {
        console.log('[OpenWith] Enabling "Open with WinBoat" feature');
        
        // Get launcher data for xfreerdp command building
        const { username, password, rdpPort } = await this.getLauncherData();
        
        // Create the handler script
        await this.createHandlerScript(username, password, rdpPort);
        
        // Create the .desktop file
        await this.createDesktopFile();
        
        // Update desktop database
        try {
            await execAsync(`update-desktop-database "${path.dirname(this.DESKTOP_PATH)}"`);
        } catch (e) {
            console.warn('[OpenWith] Failed to update desktop database:', e);
        }
        
        console.log('[OpenWith] Successfully enabled "Open with WinBoat"');
    }

    /**
     * Disables "Open with WinBoat" by removing the files
     */
    async disable(): Promise<void> {
        console.log('[OpenWith] Disabling "Open with WinBoat" feature');
        
        try {
            if (await this.fileExists(this.SCRIPT_PATH)) {
                await fs.promises.unlink(this.SCRIPT_PATH);
            }
            if (await this.fileExists(this.DESKTOP_PATH)) {
                await fs.promises.unlink(this.DESKTOP_PATH);
            }
            
            // Update desktop database
            await execAsync(`update-desktop-database "${path.dirname(this.DESKTOP_PATH)}"`);
        } catch (error) {
            console.error('[OpenWith] Failed to disable:', error);
            throw error;
        }
        
        console.log('[OpenWith] Successfully disabled "Open with WinBoat"');
    }

    /**
     * Creates the bash script that handles launching .exe files
     * Directly calls WinBoat with --launch-app argument
     */
    private async createHandlerScript(username: string, password: string, rdpPort: number): Promise<void> {
        const scriptContent = `#!/usr/bin/env bash
# WinBoat "Open With" Handler (auto-generated)
# Launches Windows .exe files via WinBoat

FILE_PATH="$1"

if [ -z "$FILE_PATH" ]; then
    notify-send -u critical "WinBoat" "No file specified" 2>/dev/null || true
    exit 1
fi

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    notify-send -u critical "WinBoat" "File not found: $FILE_PATH" 2>/dev/null || true
    exit 1
fi

# Get user's home directory
HOME_DIR="$HOME"

# Check if file is under home directory
if [[ "$FILE_PATH" != "$HOME_DIR"* ]]; then
    notify-send -u critical "WinBoat" "File must be in your home folder to work with Shared Home Folder" 2>/dev/null || true
    exit 1
fi

# Convert Linux path to Windows UNC path using Shared Home Folder
# The Shared Home Folder mounts Linux $HOME as /shared in container, exposed as \\\\host.lan\\Data via Samba
RELATIVE_PATH="\${FILE_PATH#$HOME_DIR}"
RELATIVE_PATH="\${RELATIVE_PATH#/}"  # Remove leading slash if present
WIN_PATH="\\\\\\\\host.lan\\\\Data\\\\\${RELATIVE_PATH//\\//\\\\\\\\}"

notify-send "WinBoat" "Launching $(basename "$FILE_PATH")..." 2>/dev/null || true

# Find WinBoat binary
find_winboat() {
    # Check ~/.winboat/binary_path first (set by main WinBoat app)
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

WINBOAT_BIN=$(find_winboat)

if [ -z "$WINBOAT_BIN" ]; then
    notify-send -u critical "WinBoat" "WinBoat binary not found. Please install WinBoat first." 2>/dev/null || true
    exit 1
fi

# Launch WinBoat with --launch-app argument (background process)
exec "$WINBOAT_BIN" --launch-app "$WIN_PATH" >/dev/null 2>&1 &
`;

        const binDir = path.dirname(this.SCRIPT_PATH);
        await fs.promises.mkdir(binDir, { recursive: true });
        await fs.promises.writeFile(this.SCRIPT_PATH, scriptContent, { mode: 0o755 });
        await fs.promises.chmod(this.SCRIPT_PATH, 0o755);
        
        console.log('[OpenWith] Created handler script at', this.SCRIPT_PATH);
    }

    /**
     * Creates the .desktop file for file association
     */
    private async createDesktopFile(): Promise<void> {
        const desktopContent = `[Desktop Entry]
Type=Application
Name=Open with WinBoat
Comment=Launch Windows executables with WinBoat
Exec=${this.SCRIPT_PATH} %f
Icon=winboat
Terminal=false
NoDisplay=true
MimeType=application/x-ms-dos-executable;application/x-wine-extension-msp;application/x-msi-shortcut;application/x-msdownload;
Categories=Utility;
StartupNotify=true
`;

        const desktopDir = path.dirname(this.DESKTOP_PATH);
        await fs.promises.mkdir(desktopDir, { recursive: true });
        await fs.promises.writeFile(this.DESKTOP_PATH, desktopContent, { mode: 0o644 });
        
        console.log('[OpenWith] Created .desktop file at', this.DESKTOP_PATH);
    }

    /**
     * Get launcher data from WinBoat (credentials, port)
     */
    private async getLauncherData(): Promise<{username: string, password: string, rdpPort: number}> {
        const { username, password } = this.winboat.getCredentials();
        const rdpPort = this.winboat.getHostPort(GUEST_RDP_PORT);
        
        return { username, password, rdpPort };
    }

    /**
     * Check if files exist
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if the feature is currently enabled (files exist)
     */
    async isEnabled(): Promise<boolean> {
        return (await this.fileExists(this.SCRIPT_PATH)) && (await this.fileExists(this.DESKTOP_PATH));
    }
}
