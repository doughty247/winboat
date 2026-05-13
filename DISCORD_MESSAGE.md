Hey Tibix, I want to discuss the desktop launcher architecture. I think my feat/desktop-launcher approach is better than the per-app script approach from #346.

The core difference:
- My approach: 1 wrapper script + N desktop files
- #346 approach: N bash scripts + N desktop files

With my approach you get one script (winboat-launcher) that takes the app path as an argument. With #346 you get a separate 150-line bash script for every single app.

Main issues with per-app scripts:

1. Code duplication
Every bash script duplicates the same logic: container management, health checks, config parsing, FreeRDP arg building. This same logic already exists in WinBoat's TypeScript. Bug fixes now require changes in 2 places, 2 languages.

2. Config staleness
When a user changes their password, all shortcuts break until regenerated. With my approach the password change works immediately since WinBoat reads fresh config every time.

3. Filesystem clutter
50 apps means 100 extra files in ~/.local/bin/ (50 scripts, 7500 lines of duplicate code). My approach is 1 wrapper, 50 lines total.

4. Maintenance burden
With per-app scripts you have to fix bugs in TypeScript, then fix them in the bash generator, then regenerate all shortcuts, then deploy. With my approach you fix it once in TypeScript and you're done.

5. Not how native Linux apps work
Native apps use arguments (firefox "url", code "path"). Nobody creates per-target bash scripts (firefox-github.sh, code-project.sh). That's an antipattern.

6. Feature loss
Per-app scripts lose: usage tracking, system tray integration, launch queue, live config updates, and "Open with WinBoat" compatibility.

Your requirements:
- Sync with settings: my wrapper calls WinBoat which reads fresh config every time
- Auto-start container: WinBoat handles this in App.vue, no duplication needed
- Work with any install: my wrapper searches paths dynamically
- Right-click UI: already implemented in my branch

If shortcuts absolutely need to work without WinBoat running, we can add a fallback to the single wrapper:

if winboat_is_running; then
    winboat --launch-app "$APP_PATH"
else
    standalone_launch "$APP_PATH"
fi

This keeps the logic in one place instead of duplicating it N times.

I think we should keep the wrapper approach. It's more maintainable, cleaner, follows Linux conventions, and all the features already work. Full technical writeup is in LAUNCHER_ARCHITECTURE_ARGUMENT.md if you want details.
