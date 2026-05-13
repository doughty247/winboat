<template>
    <main class="overflow-hidden relative w-screen h-screen">
        <!-- Decoration -->
        <div class="gradient-ball absolute -z-10 left-0 bottom-0 translate-x-[-50%] translate-y-[50%] w-[90vw] aspect-square opacity-15 blob-anim"></div>
        <div class="gradient-ball absolute -z-10 right-0 top-0 translate-x-[50%] translate-y-[-50%] w-[90vw] aspect-square opacity-15 blob-anim"></div>
        
        <!-- Stripes for experimental -->
        <div
            v-show="wbConfig?.config.experimentalFeatures"
            :key="rerenderCounter"
            class="experimental-stripes absolute top-0 left-0 w-full h-[3rem] pointer-events-none z-[10] opacity-15 grayscale"
        ></div>
            
        <!-- Titlebar -->
        <x-titlebar @minimize="handleMinimize()" @buttonclick="handleTitleBarEvent" class="backdrop-blur-xl bg-neutral-900/50">
            <x-label>WinBoat</x-label>
        </x-titlebar>

        <!-- Updater -->
        <dialog ref="updateDialog">
            <Icon class="text-indigo-400 size-12" icon="mdi:cloud-upload"></Icon>
            <template v-if="manualUpdateRequired">
                <h3 class="mt-2">Manual Guest Server Update Required</h3>
                <div class="max-w-[60vw]">
                    <strong>WinBoat has encountered an issue while trying to update the Guest Server automatically. Please follow the steps below to manually update it:</strong>
                    <ol class="mt-2 list-decimal list-inside">
                        <li>
                            Use VNC over at 
                            <a @click="openAnchorLink" :href="novncURL" target="_blank" rel="noopener noreferrer">{{ novncURL }}</a>
                            to access Windows
                        </li>
                        <li>Press Win + R or search for <code>Run</code>, type in <code>services.msc</code></li>
                        <li>Stop the <code>WinBoatGuestServer</code> service by right clicking and pressing "Stop"</li>
                        <li>
                            Download the new Guest Server from
                            <a @click="openAnchorLink" href="https://github.com/TibixDev/winboat/releases" target="_blank" rel="noopener noreferrer">https://github.com/TibixDev/winboat/releases</a>,
                            you should pick version <strong>{{ appVer }}</strong>
                        </li>
                        <li>Navigate to <code>C:\Program Files\WinBoat</code> and delete the contents</li>
                        <li>Extract the freshly downloaded zip into the same folder</li>
                        <li>Start the <code>WinBoatGuestServer</code> service by right clicking and pressing "Start"</li>
                        <li>If you were using VNC, log out of Windows and close it</li>
                        <li>Restart WinBoat</li>
                    </ol>
                    <p>
                        We're sorry for the inconvenience. 😟
                    </p>
                </div>
            </template>

            <template v-else>
                <h3 class="mt-2" v-if="winboat?.isUpdatingGuestServer.value">Updating Guest Server</h3>
                <h3 class="mt-2" v-else>Guest Server update successful!</h3>
                <p v-if="winboat?.isUpdatingGuestServer.value" class="max-w-[40vw]">
                    The guest is currently running an outdated version of the WinBoat Guest Server. Please wait while we update it to the current version.
                </p>
                <p v-else class="max-w-[40vw]">
                    The WinBoat Guest Server has been updated successfully! You can now close this dialog and continue using the application.
                </p>
            </template>
            <footer v-if="!manualUpdateRequired">
                <x-progressbar v-if="winboat?.isUpdatingGuestServer.value" class="my-4"></x-progressbar>
                <x-button v-else id="close-button" @click="updateDialog!.close()" toggled>
                    <x-label>Close</x-label>
                </x-button>
            </footer>
        </dialog>

        <!-- UI / SetupUI -->
        <div v-if="useRoute().name !== 'SetupUI'" class="flex flex-row h-[calc(100vh-2rem)]">
            <x-nav class="flex flex-col flex-none gap-0.5 w-72 backdrop-blur-xl bg-gray-500/10 backdrop-contrast-90">
                <div
                    v-if="winboat?.rdpConnected.value"
                    class="w-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-blue-500 text-white
                    !mt-0 py-1 shadow-md shadow-indigo-500/50 transition-all duration-300 hover:brightness-105 flex flex-row items-center justify-center gap-2"
                >
                    <Icon class="size-5" icon="mdi:remote-desktop"></Icon>
                    <span class="font-semibold text-center">
                        RDP Session Active
                    </span>
                </div>
                <div class="flex flex-row gap-4 items-center p-4">
                    <img class="w-16 rounded-full"
                        src="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/Windows_10_Default_Profile_Picture.svg/2048px-Windows_10_Default_Profile_Picture.svg.png"
                        alt="Profile Picture">
                    <div>
                        <x-label class="text-lg font-semibold">{{ os.userInfo().username }}</x-label>
                        <x-label class="text-[0.8rem]">Local Account</x-label>
                    </div>
                </div>
                <RouterLink v-for="route of routes.filter(r => !['SetupUI', 'Loading'].includes(String(r.name)))" :to="route.path" :key="route.path">
                    <x-navitem>
                        <Icon class="mr-4 w-5 h-5" :icon="(route.meta!.icon as string)"></Icon>
                        <x-label>{{ route.name }}</x-label>
                    </x-navitem>
                </RouterLink>
                <div class="flex flex-col justify-end items-center p-4 h-full">
                    <p class="text-xs text-neutral-500">WinBoat Beta v{{ appVer }} {{ isDev ? 'Dev' : 'Prod' }}</p>
                </div>
            </x-nav>
            <div class="px-5 flex-grow max-h-[calc(100vh-2rem)] overflow-y-auto py-4">
                <div class="flex flex-row gap-2 items-center my-6">
                    <Icon class="w-6 h-6 opacity-60" icon="icon-park-solid:toolkit"></Icon>
                    <h1 class="my-0 text-2xl font-semibold opacity-60">
                        WinBoat
                    </h1>
                    <Icon class="w-6 h-6" icon="bitcoin-icons:caret-right-filled"></Icon>
                    <Icon class="w-6 h-6" :icon="(useRoute().meta.icon as string)"></Icon>
                    <h1 class="my-0 text-2xl font-semibold">
                        {{ useRoute().name }}
                    </h1>
                </div>
                <router-view v-slot="{ Component }" @rerender="rerenderCounter++">
                    <transition mode="out-in" name="fade">
                        <component :is="Component" />
                    </transition>
                </router-view>
            </div>
        </div>

        <div v-else class="w-full h-[calc(100vh-2rem)]">
            <RouterView />
        </div>
    </main>
</template>

<script setup lang="ts">
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { routes } from './router';
import { Icon } from '@iconify/vue';
import { onMounted, ref, useTemplateRef, watch } from 'vue';
import { isInstalled } from './lib/install';
import { Winboat } from './lib/winboat';
import { openAnchorLink } from './utils/openLink';
import { WinboatConfig } from './lib/config';
import { USBManager } from './lib/usbmanager';
import { DesktopLauncherManager } from './lib/launcher';
import { GUEST_NOVNC_PORT } from './lib/constants';
import { createLogger } from './utils/log';
const { BrowserWindow }: typeof import('@electron/remote') = require('@electron/remote')
const os: typeof import('os') = require('os')
const path: typeof import('path') = require('path')
const remote: typeof import('@electron/remote') = require('@electron/remote');

// Create logger for IPC debugging
const logPath = path.join(os.homedir(), '.winboat', 'winboat.log');
const logger = createLogger(logPath);

const $router = useRouter();
const appVer = import.meta.env.VITE_APP_VERSION;
const isDev = import.meta.env.DEV;
let winboat: Winboat | null;
let wbConfig: WinboatConfig | null;

let updateTimeout: NodeJS.Timeout | null = null;
const manualUpdateRequired = ref(false);
const MANUAL_UPDATE_TIMEOUT = 60000; // 60 seconds
const updateDialog = useTemplateRef('updateDialog');
const rerenderCounter = ref(0); // TODO: Hack for non-reactive data
const novncURL = ref("");

onMounted(async () => {
    new USBManager(); // Instantiate singleton class
    const winboatInstalled = await isInstalled();
    if (!winboatInstalled) {
        console.log("Not installed, redirecting to setup...")
        $router.push('/setup');
    } else {
        winboat = new Winboat(); // Instantiate singleton class
        wbConfig = new WinboatConfig(); // Instantiate singleton class
        $router.push('/home');

        // Check if app was launched with --launch-app argument
        const { ipcRenderer } = require('electron');
        
        async function handleLaunchRequest(appPath: string) {
            logger.info('[WinBoat] Launch requested via CLI for:', appPath);
            console.log('[WinBoat] Launch requested via CLI for:', appPath);
            
            if (!winboat) {
                logger.error('[WinBoat] Winboat not initialized');
                console.error('[WinBoat] Winboat not initialized');
                return;
            }
            
            // Show notification for user feedback
            const notification = new Notification('WinBoat', {
                body: 'Preparing to launch app...',
                icon: 'icons/icon.png'
            });
            
            // Optimized container readiness check
            const containerStatus = await winboat.getContainerStatus();
            logger.info('[WinBoat] Container status:', containerStatus, '| API online:', winboat.isOnline.value);
            console.log('[WinBoat] Container status:', containerStatus, '| API online:', winboat.isOnline.value);
            
            // Start container if it's not running
            if (containerStatus !== 'running') {
                console.log('[WinBoat] Container not running, starting...');
                try {
                    await winboat.startContainer();
                    console.log('[WinBoat] Container start command sent');
                } catch (error) {
                    console.error('[WinBoat] Failed to start container:', error);
                    return;
                }
            }
            
            // Wait for guest API to be ready (with aggressive polling)
            if (!winboat.isOnline.value) {
                console.log('[WinBoat] Waiting for guest API to be ready...');
                const startTime = Date.now();
                const maxWait = 45000; // 45 seconds max
                const pollInterval = 500; // Check every 500ms
                
                while (!winboat.isOnline.value && (Date.now() - startTime) < maxWait) {
                    // Manually check health instead of waiting for the interval
                    const isHealthy = await winboat.getHealth();
                    if (isHealthy) {
                        winboat.isOnline.value = true;
                        console.log('[WinBoat] Guest API is now ready!');
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                }
                
                if (!winboat.isOnline.value) {
                    console.error('[WinBoat] Guest API failed to start within timeout');
                    return;
                }
            } else {
                console.log('[WinBoat] Guest API already ready, launching immediately');
            }
            
            // Find and launch the app
            try {
                const apps = await winboat.appMgr!.getApps(`http://127.0.0.1:${winboat.getHostPort(7148)}`);
                console.log('[WinBoat] ===== APP MATCHING DEBUG =====');
                console.log('[WinBoat] Requested path:', appPath);
                console.log('[WinBoat] Available apps:', apps.map((a: any) => ({ name: a.Name, path: a.Path })));
                
                // Always try to match against existing apps first (3-tier matching)
                // Try exact match first
                let app: any = apps.find((a: any) => a.Path === appPath);
                console.log('[WinBoat] Exact match result:', app ? `${app.Name} (${app.Path})` : 'NONE');
                    
                if (!app) {
                    // Try normalized comparison (case-insensitive, backslash normalization)
                    const normalize = (p: string) => p.replace(/\\+/g, '\\').replace(/\//g, '\\').toLowerCase();
                    const requested = normalize(appPath);
                    console.log('[WinBoat] Exact match failed. Trying normalized match...');
                    console.log('[WinBoat] Normalized requested:', requested);
                    
                    app = apps.find((a: any) => {
                        const normalized = normalize(a.Path);
                        const matches = normalized === requested;
                        console.log(`[WinBoat] Compare "${a.Name}": "${normalized}" === "${requested}" = ${matches}`);
                        return matches;
                    });
                    console.log('[WinBoat] Normalized match result:', app ? `${app.Name} (${app.Path})` : 'NONE');
                }
                
                // Try matching by executable name if still not found
                if (!app) {
                    const requestedExe = appPath.split(/[\\/]/).pop()?.toLowerCase() || '';
                    console.log('[WinBoat] Normalized match failed. Trying executable name match...');
                    console.log('[WinBoat] Requested executable:', requestedExe);
                    
                    app = apps.find((a: any) => {
                        const appExe = a.Path.split(/[\\/]/).pop()?.toLowerCase() || '';
                        const matches = appExe === requestedExe;
                        console.log(`[WinBoat] Compare "${a.Name}": "${appExe}" === "${requestedExe}" = ${matches}`);
                        return matches;
                    });
                    
                    console.log('[WinBoat] Executable match result:', app ? `${app.Name} (${app.Path})` : 'NONE');
                    
                    if (!app) {
                        // Last resort: if path starts with \\host.lan or /, create temp app to launch it
                        const isUNCPath = appPath.startsWith('\\\\host.lan') || appPath.startsWith('//host.lan');
                        const isLinuxPath = appPath.startsWith('/');
                        
                        if (isUNCPath || isLinuxPath) {
                            let finalPath = appPath;
                            
                            // Convert Linux path to Windows UNC path
                            if (isLinuxPath) {
                                const homeDir = await ipcRenderer.invoke('get-home-dir');
                                if (appPath.startsWith(homeDir)) {
                                    // Remove home directory prefix and convert to UNC
                                    const relativePath = appPath.substring(homeDir.length).replace(/^\//, '');
                                    finalPath = `\\\\host.lan\\Data\\${relativePath.replace(/\//g, '\\')}`;
                                    console.log('[WinBoat] Converted Linux path to UNC:', appPath, '->', finalPath);
                                } else {
                                    logger.error('[WinBoat] File not in home directory:', appPath);
                                    notification.close();
                                    new Notification('WinBoat Error', {
                                        body: 'File must be in your home folder to use Shared Home Folder',
                                        icon: 'icons/icon.png'
                                    });
                                    return;
                                }
                            }
                            
                            console.log('[WinBoat] Creating temp app for external path:', finalPath);
                            const fileName = finalPath.split(/[\\/]/).pop() || 'Application';
                            app = {
                                Name: fileName.replace('.exe', ''),
                                Path: finalPath,
                                Icon: '',
                                Source: 'external',
                                Usage: 0
                            };
                        }
                    }
                }
                
                if (app) {
                    console.log('[WinBoat] ===== FINAL MATCH =====');
                    logger.info('[WinBoat] Found/created app:', app.Name, 'with path', app.Path);
                    console.log('[WinBoat] Final matched app:', app.Name);
                    console.log('[WinBoat] App path:', app.Path);
                    console.log('[WinBoat] ===========================');
                    
                    notification.close();
                    new Notification('WinBoat', {
                        body: `Launching ${app.Name}...`,
                        icon: 'icons/icon.png'
                    });
                    logger.info('[WinBoat] Launching app via winboat.launchApp()');
                    // Launch app in background, do not await
                    winboat.launchApp(app);
                    console.log('[WinBoat] App launch command sent:', app.Name);
                    
                    // For launch-only instances, close after a delay to let FreeRDP start
                    setTimeout(() => {
                        logger.info('[WinBoat] Closing launch-only instance after app launch');
                        window.close();
                    }, 2000);
                } else {
                    logger.error('[WinBoat] App not found with path:', appPath);
                    console.error('[WinBoat] App not found with path:', appPath);
                    console.log('[WinBoat] Available paths:', apps.map((a: any) => `${a.Name}: ${a.Path}`).join(', '));
                    notification.close();
                    new Notification('WinBoat Error', {
                        body: `App not found: ${appPath}`,
                        icon: 'icons/icon.png'
                    });
                }
            } catch (error) {
                logger.error('[WinBoat] Error launching app:', error);
                console.error('[WinBoat] Error launching app:', error);
                notification.close();
                new Notification('WinBoat Error', {
                    body: `Failed to launch app: ${error}`,
                    icon: 'icons/icon.png'
                });
            }
        }
        
        // Check if launched with --launch-app argument
        ipcRenderer.send('get-launch-app-request');
        ipcRenderer.once('launch-app-startup', (_event: any, appPath: string) => {
            if (appPath) {
                logger.info('[WinBoat] Instance launched for app:', appPath);
                console.log('[WinBoat] Instance launched for app:', appPath);
                handleLaunchRequest(appPath);
            }
        });

        // Listen for launch requests from secondary instances (single-instance mode)
        ipcRenderer.on('launch-app-request', (_event: any, appPath: string) => {
            if (appPath) {
                logger.info('[WinBoat] Received launch request from secondary instance:', appPath);
                console.log('[WinBoat] Received launch request from secondary instance:', appPath);
                handleLaunchRequest(appPath);
            }
        });

        // Auto-sync desktop launchers on app startup when container comes online
        // Only runs if "Automatic" setting is enabled
        watch(() => winboat?.isOnline.value, async (isOnline) => {
            console.log('[Launcher] Watch triggered - isOnline:', isOnline);
            if (isOnline && wbConfig?.config.desktopLauncherAutoSync) {
                try {
                    console.log('[Launcher] Starting auto-sync on app startup...');
                    const launcherMgr = new DesktopLauncherManager(winboat!);
                    console.log('[Launcher] Created launcher manager');
                    const apps = await winboat!.appMgr!.getApps(`http://127.0.0.1:${winboat!.getHostPort(7148)}`);
                    console.log('[Launcher] Got apps:', apps?.length, 'apps found');
                    const result = await launcherMgr.syncAll(apps);
                    console.log(`[Launcher] Startup sync completed: +${result.created} / -${result.removed}`);
                } catch (e) {
                    console.error('[Launcher] Startup auto-sync failed:', e);
                }
            } else if (isOnline) {
                console.log('[Launcher] Auto-sync disabled (manual mode)');
            }
        });
    }

    // Watch for guest server updates and show dialog
    watch(() => winboat?.isUpdatingGuestServer.value, (isUpdating) => {
        if (isUpdating === true) {
            novncURL.value = `http://127.0.0.1:${winboat?.getHostPort(GUEST_NOVNC_PORT)}`;
            updateDialog.value!.showModal();
            // Prepare the timeout to show manual update required after 45 seconds
            updateTimeout = setTimeout(() => {
                manualUpdateRequired.value = true;
            }, MANUAL_UPDATE_TIMEOUT);
        } else {
            // Clear the timeout if the update finished before the timeout
            if (updateTimeout) {
                clearTimeout(updateTimeout);
                updateTimeout = null;
            }
            manualUpdateRequired.value = false;
        }
    })
})

function handleMinimize() {
    console.log("Minimize")
    window.electronAPI.minimizeWindow();
}

function handleTitleBarEvent(e: CustomEvent) {
    console.log("TitleBarEvt", e);
    switch (e.detail) {
        case "close":
            BrowserWindow.getFocusedWindow()!.close();
            break;
        case "maximize":
            if (BrowserWindow.getFocusedWindow()!.isMaximized()) {
                BrowserWindow.getFocusedWindow()!.unmaximize();
            } else {
                BrowserWindow.getFocusedWindow()!.maximize();
            }
            break;
        case "minimize":
            BrowserWindow.getFocusedWindow()!.minimize();
            break;
    }
}
</script>

<style>
dialog::backdrop {
    pointer-events: none;
    backdrop-filter: blur(8px);
}

.gradient-ball {
    border-radius: 99999px;
    background: linear-gradient(197.37deg, #7450DB -0.38%, rgba(138, 234, 240, 0) 101.89%), linear-gradient(115.93deg, #3E88F6 4.86%, rgba(62, 180, 246, 0.33) 38.05%, rgba(62, 235, 246, 0) 74.14%), radial-gradient(56.47% 76.87% at 6.92% 7.55%, rgba(62, 136, 246, 0.7) 0%, rgba(62, 158, 246, 0.182) 52.16%, rgba(62, 246, 246, 0) 100%), linear-gradient(306.53deg, #2EE4E3 19.83%, rgba(46, 228, 227, 0) 97.33%);
    background-blend-mode: normal, normal, normal, normal, normal, normal;
    filter: blur(200px);
}

@keyframes blob {
    from {
        filter: hue-rotate(0deg) blur(200px);
    }
    to {
        filter: hue-rotate(45deg) blur(200px);
    }
}

.blob-anim {
    animation: blob 5s linear infinite;
    animation-direction: alternate-reverse;
}

.fade-enter-active,
.fade-leave-active {
    transition: all 0.2s ease;
}

.fade-enter-from {
    opacity: 0;
    /* transform: translateX(20vw); */
}

.fade-leave-to {
    opacity: 0;
    /* transform: translateX(-20vw); */
}

/* Stripes for the top of the window to indicate experimental features enabled */
.experimental-stripes {
    background: repeating-linear-gradient(
    45deg,
    #ffffff00,
    #ffffff00 25px,
    rgb(129 140 248) 25px,
    rgb(129 140 248) 50px
    );
    -webkit-mask-image: -webkit-gradient(linear, left 0%, left bottom, from(rgba(0,0,0,1)), to(rgba(0,0,0,0)));
    mask-image: linear-gradient(to bottom, rgba(0,0,0,1), rgba(0,0,0,0));
}
</style>