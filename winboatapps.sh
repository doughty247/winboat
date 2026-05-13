#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════════
#  WinBoat Apps Installer (with icon extraction & API auto-start)
#  ---------------------------------------------
#  • Scans winboat.log for xfreerdp commands (if available)
#  • Presents a de-duplicated list of App Names (latest occurrence wins)
#  • Lets you pick one or paste manually
#  • Generates:
#      ~/.local/bin/<APPNAME>.sh                     (0755)
#      ~/.local/share/applications/<APPNAME>.desktop (0644)
#  • Stores the user command Base64-encoded in the launcher (safe quoting)
#  • Extracts a PNG icon via WinBoat Guest API /get-icon and sets it in .desktop
#  • For both icon extraction and app launching:
#      if Guest API is down, offers to start container "WinBoat" and waits for /health
# ════════════════════════════════════════════════════════════════════════════

# -----------------------------
# CLI flags / environment
# -----------------------------
VERBOSE=${VERBOSE:-false}
if [[ "${1:-}" == "--verbose" ]]; then VERBOSE=true; fi

# -----------------------------
# Settings (adjust if needed)
# -----------------------------
CONTAINER_NAME="WinBoat"
GUEST_API_HOST="127.0.0.1"
GUEST_API_PORT="7148"
GUEST_API_URL="http://${GUEST_API_HOST}:${GUEST_API_PORT}"
HEALTH_URL="${GUEST_API_URL}/health"

API_TIMEOUT=60          # seconds to wait for /health
API_INTERVAL=1          # seconds between health polls
EXTRA_DELAY_AFTER_READY=5  # seconds after API turns healthy

# -----------------------------
# Helpers (logging, prompts)
# -----------------------------
logv(){ $VERBOSE && echo "[verbose] $*" >&2 || true; }
have(){ command -v "$1" >/dev/null 2>&1; }
ask_yes_no(){
  local msg="${1:-Proceed?}"
  read -rp "$msg [y]: " ans
  [[ "${ans:-}" =~ ^[yY]$ ]]
}

# -----------------------------
# API health helpers
# -----------------------------
guest_api_ready(){
  local code=""
  if have curl; then
    code="$(curl -fsS -m 2 -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo "")"
  elif have wget; then
    code="$(wget -q --server-response --timeout=2 --tries=1 "$HEALTH_URL" -O /dev/null 2>&1 | awk '/^  HTTP/{c=$2} END{print c}')"
  fi
  [[ "$code" == "200" ]]
}

wait_for_api(){
  local start ts
  start=$(date +%s)
  while ! guest_api_ready; do
    ts=$(date +%s)
    local elapsed=$(( ts - start ))
    logv "API not ready yet (elapsed ${elapsed}s)…"
    if (( elapsed >= API_TIMEOUT )); then
      return 1
    fi
    sleep "$API_INTERVAL"
  done
  return 0
}

container_running(){
  docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -qi true
}

ensure_guest_api(){
  # If API up -> ok
  if guest_api_ready; then
    logv "Guest API already healthy."
    return 0
  fi

  # If container is not running, offer to start it
  if ! container_running; then
    if ask_yes_no "WinBoat Guest API is offline. Start container \"$CONTAINER_NAME\" now?"; then
      echo "Starting container \"$CONTAINER_NAME\"…"
      if ! docker start "$CONTAINER_NAME" >/dev/null 2>&1; then
        echo "❌ Failed to start container \"$CONTAINER_NAME\"." >&2
        return 1
      fi
    else
      echo "ℹ  Skipping icon extraction (API is offline and start was declined)."
      return 1
    fi
  fi

  # Poll /health
  echo "Waiting for Guest API at ${HEALTH_URL}…"
  if wait_for_api; then
    echo "✅ Guest API is healthy."
    # Small warmup delay (same behavior as generated launcher)
    sleep "$EXTRA_DELAY_AFTER_READY"
    return 0
  else
    echo "❌ Guest API did not become healthy within ${API_TIMEOUT}s." >&2
    return 1
  fi
}

# -----------------------------
# Locate winboat.log (heuristic)
# -----------------------------
WINBOAT_LOG_DIRS=(
  "$HOME/.winboat"
)
WINBOAT_LOG=""
for d in "${WINBOAT_LOG_DIRS[@]}"; do
  if [[ -f "$d/winboat.log" ]]; then
    WINBOAT_LOG="$d/winboat.log"; break
  fi
done

# -----------------------------
# xfreerdp command parsing helpers
# -----------------------------
# Extract the /app:program:"PATH" (path) from an xfreerdp command line
extract_app_path(){
  local line="$1"
  if [[ "$line" =~ /app:program:\"([^\"]+)\" ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Extract the ,name:"APPNAME" from an xfreerdp command line; if missing, derive from PATH
extract_app_name(){
  local line="$1"
  local name=""
  if [[ "$line" =~ ,name:\"([^\"]+)\" ]]; then
    name="${BASH_REMATCH[1]}"
  else
    # Fallback: derive from program path basename (without extension)
    local p; p="$(extract_app_path "$line")"
    if [[ -n "$p" ]]; then
      # take basename, strip .exe if present
      name="$(basename "$p")"
      name="${name%.exe}"
    fi
  fi
  printf '%s' "$name"
}

# Resolve common Windows env vars to absolute paths (best-effort)
resolve_win_vars() {
  local p="$1"
  p="${p//%windir%/C:\\Windows}"
  p="${p//%WINDIR%/C:\\Windows}"
  p="${p//%systemroot%/C:\\Windows}"
  p="${p//%SYSTEMROOT%/C:\\Windows}"
  p="${p//%system32%/C:\\Windows\\System32}"
  p="${p//%SYSTEM32%/C:\\Windows\\System32}"
  p="${p//%programfiles%/C:\\Program Files}"
  p="${p//%PROGRAMFILES%/C:\\Program Files}"
  p="${p//%programfiles(x86)%/C:\\Program Files (x86)}"
  p="${p//%PROGRAMFILES(X86)%/C:\\Program Files (x86)}"
  printf '%s' "$p"
}

# -----------------------------
# Intro
# -----------------------------
echo "══════════════════════════════════════════════════════"
echo "🪟  WinBoat App Creator v0.2"
echo "══════════════════════════════════════════════════════"
echo
echo "Please choose the app from the list below. You must have"
echo "opened the app at least once from WinBoat for it to appear here."
echo
echo "If you don't find your app, you can paste the custom command from 'winboat.log'."
echo "Example:"
echo "  xfreerdp /u:[username] /p:[password] /v:127.0.0.1 /port:3389 \\"
echo "           /app:program:\"%windir%\\\\notepad.exe\",name:\"Notepad\" &"
echo

# -----------------------------
# Collect command (DEDUP by App Name, keep LATEST occurrence)
# -----------------------------
COMMAND=""

if [[ -n "$WINBOAT_LOG" ]]; then
  echo "Found log file: $WINBOAT_LOG"

  # Build a de-duplicated list by App Name, keeping the MOST RECENT occurrence.
  # We iterate the log in reverse (tac): first time we see a given name = latest entry.
  declare -A CMD_BY_NAME=()
  declare -a NAMES_IN_ORDER=()

  while IFS= read -r line; do
    [[ "$line" =~ ^xfreerdp ]] || continue
    local_name="$(extract_app_name "$line")"
    # Skip entries with no detectable name
    if [[ -z "$local_name" ]]; then
      continue
    fi
    if [[ -z "${CMD_BY_NAME[$local_name]+x}" ]]; then
      CMD_BY_NAME["$local_name"]="$line"
      NAMES_IN_ORDER+=("$local_name")
    fi
  done < <(tac "$WINBOAT_LOG")

  if ((${#NAMES_IN_ORDER[@]} > 0)); then
    echo
    echo "Detected apps:"
    for i in "${!NAMES_IN_ORDER[@]}"; do
      printf "  [%2d] %s\n" "$((i+1))" "${NAMES_IN_ORDER[$i]}"
    done
    echo
    read -rp "Select an app by number (or press Enter to paste a command manually): " CHOICE
    if [[ -n "${CHOICE:-}" && "$CHOICE" =~ ^[0-9]+$ && "$CHOICE" -ge 1 && "$CHOICE" -le "${#NAMES_IN_ORDER[@]}" ]]; then
      SELECTED_NAME="${NAMES_IN_ORDER[$((CHOICE-1))]}"
      COMMAND="${CMD_BY_NAME[$SELECTED_NAME]}"
      echo "Selected app: $SELECTED_NAME"
    fi
  else
    echo "No xfreerdp commands with recognizable names found in winboat.log."
  fi
else
  echo "No winboat.log file found in common locations."
fi

# If still empty, manual paste
if [[ -z "$COMMAND" ]]; then
  echo
  read -rp "Paste the full xfreerdp command here: " COMMAND
  echo
fi

# -----------------------------
# Ask for app name (prefill with detected name if any)
# -----------------------------
DEFAULT_NAME="$(extract_app_name "$COMMAND")"
if [[ -n "$DEFAULT_NAME" ]]; then
  read -rp "Enter the application name [${DEFAULT_NAME}]: " APPNAME_INPUT
  APPNAME="${APPNAME_INPUT:-$DEFAULT_NAME}"
else
  read -rp "Enter the application name (e.g. 'Notepad' or 'Microsoft Word'): " APPNAME
fi
echo

# -----------------------------
# Sanitize command (&, spaces)
# -----------------------------
sanitize_command() {
  printf '%s' "$1" | sed -E 's/[[:space:]]*&[[:space:]]*$//' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g'
}
SANITIZED_COMMAND="$(sanitize_command "$COMMAND")"
logv "SANITIZED_COMMAND=$SANITIZED_COMMAND"

# -----------------------------
# Extract Windows app path from xfreerdp command (for icon)
# -----------------------------
APP_PATH=""
if [[ "$SANITIZED_COMMAND" =~ /app:program:\"([^\"]+)\" ]]; then
  APP_PATH="${BASH_REMATCH[1]}"
fi
if [[ -n "$APP_PATH" ]]; then
  APP_PATH="$(resolve_win_vars "$APP_PATH")"
  echo "Detected app path: $APP_PATH"
else
  echo "⚠  Could not detect /app:program path from command."
fi

# -----------------------------
# Base64-encode command for launcher
# -----------------------------
if base64 --help 2>&1 | grep -q -- '-w'; then
  CMD_B64="$(printf '%s' "$SANITIZED_COMMAND" | base64 -w0)"
else
  CMD_B64="$(printf '%s' "$SANITIZED_COMMAND" | base64 | tr -d '\n')"
fi

# -----------------------------
# Paths
# -----------------------------
APPFILE="${APPNAME// /_}"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/winboat"
SCRIPT_PATH="$BIN_DIR/${APPFILE}.sh"
DESKTOP_PATH="$APP_DIR/${APPFILE}.desktop"
ICON_PATH="$ICON_DIR/${APPFILE}.png"
mkdir -p "$BIN_DIR" "$APP_DIR" "$ICON_DIR"

# -----------------------------
# Icon extraction (robust)
# -----------------------------
get_app_icon() {
  local app_path="$1"    # e.g., C:\Windows\explorer.exe
  local output_file="$2" # target PNG

  if ! guest_api_ready; then
    echo "ℹ  WinBoat Guest API appears offline."
    if ! ensure_guest_api; then
      echo "⚠  Could not get API healthy; skipping icon extraction." >&2
      return 1
    fi
  fi

  if ! have curl; then
    echo "⚠  curl not found, skipping icon extraction" >&2
    return 1
  fi

  logv "POST ${GUEST_API_URL}/get-icon path=${app_path}"
  local tmp_body resp
  tmp_body="$(mktemp)"
  if ! curl -fsS -m 10 -X POST "${GUEST_API_URL}/get-icon" \
        --data-urlencode "path=${app_path}" \
        -o "$tmp_body" 2>/dev/null; then
    echo "⚠  /get-icon request failed" >&2
    rm -f "$tmp_body"
    return 1
  fi

  # Normalize to raw base64 (handle JSON, quoted strings, data URLs)
  if have jq; then
    resp="$(jq -r '.icon // empty' "$tmp_body" 2>/dev/null || true)"
  else
    resp=""
  fi
  [[ -z "$resp" ]] && resp="$(cat "$tmp_body")"
  resp="$(printf '%s' "$resp" \
        | sed -E 's/^"|"$/\n/g;1q' \
        | sed 's,^data:image/[^;]*;base64,,; s/\r//g')"

  # Decode base64 tolerantly
  if printf '%s' "$resp" | base64 -di > "$output_file" 2>/dev/null; then
    if [[ -s "$output_file" ]]; then
      rm -f "$tmp_body"
      return 0
    fi
  fi

  rm -f "$tmp_body" "$output_file" 2>/dev/null || true
  return 1
}

ICON_VALUE="utilities-terminal"
if [[ -n "$APP_PATH" ]]; then
  echo "Attempting icon extraction for: $APP_PATH"
  if get_app_icon "$APP_PATH" "$ICON_PATH"; then
    echo "✅ Icon extracted: $ICON_PATH"
    ICON_VALUE="$ICON_PATH"
  else
    echo "⚠  Icon extraction failed, using default icon."
  fi
else
  echo "⚠  No app path detected; using default icon."
fi

# -----------------------------
# Generate launcher script
# -----------------------------
cat > "$SCRIPT_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

# ════════════════════════════════════════════════════════════════════════════
#  WinBoat ${APPNAME} Launcher (auto-generated)
# ════════════════════════════════════════════════════════════════════════════

CONTAINER="WinBoat" # DON'T TOUCH!
CMD_B64="${CMD_B64}"                 # Base64-encoded user command (no trailing '&')
WAIT_TIMEOUT=60                      # Max seconds to wait for /health endpoint
EXTRA_DELAY_AFTER_READY=5            # Seconds to wait after /health=OK
HEALTH_URL="http://${GUEST_API_HOST}:${GUEST_API_PORT}/health"
HEALTH_INTERVAL=1
STRICT_HEALTH_CHECK=true

LOG_DIR="\${XDG_CACHE_HOME:-\$HOME/.cache}/winboat"
LOG_FILE="\$LOG_DIR/${APPFILE}.log"

mkdir -p "\$LOG_DIR"

timestamp(){ date "+%F %T"; }
log(){ printf '[%s] %s\n' "\$(timestamp)" "\$*" | tee -a "\$LOG_FILE" >/dev/null; }
have(){ command -v "\$1" >/dev/null 2>&1; }

notify(){
  local title="WinBoat"
  local message="\$1"
  log "\$message"
  if have notify-send; then
    notify-send -u normal -a "\$title" "\$title" "\$message" || true
  elif have kdialog; then
    kdialog --passivepopup "\$message" 5 --title "\$title" || true
  else
    log "(notification skipped: no notify-send/kdialog)"
  fi
}

is_running(){ docker inspect -f '{{.State.Running}}' "\$CONTAINER" 2>/dev/null | grep -qi true; }

health_ok(){
  local code
  if have curl; then
    code="\$(curl -fsS -m 2 -o /dev/null -w '%{http_code}' "\$HEALTH_URL" || echo "")"
  elif have wget; then
    code="\$(wget -q --server-response --timeout=2 --tries=1 "\$HEALTH_URL" -O /dev/null 2>&1 | awk '/^  HTTP/{c=\$2} END{print c}')"
  fi
  [[ "\$code" == "200" ]]
}

wait_for_health(){
  local start=\$(date +%s) try=0
  while true; do
    try=\$((try+1))
    if health_ok; then
      log "Health OK (HTTP 200) after \$(( \$(date +%s) - start ))s [try #\$try]"
      return 0
    fi
    local elapsed=\$(( \$(date +%s) - start ))
    log "Health NOT READY (elapsed \${elapsed}s, try #\$try)"
    (( elapsed >= WAIT_TIMEOUT )) && return 1
    sleep "\$HEALTH_INTERVAL"
  done
}

# Reconstruct the original command safely from Base64
if base64 --help 2>&1 | grep -q -- '-d'; then
  RUN_CMD_STR="\$(printf '%s' "\$CMD_B64" | base64 -d)"
else
  RUN_CMD_STR="\$(printf '%s' "\$CMD_B64" | base64 -D 2>/dev/null || printf '%s' "\$CMD_B64" | base64 -d)"
fi

STARTED_NOW=false
log "──────────────────────────────"
log "Launch requested for '${APPNAME}'"
log "Logs: \$LOG_FILE"

if is_running; then
  log "Container is already RUNNING"
  wait_for_health || true
else
  log "Container is STOPPED → starting..."
  notify "Starting WinBoat..."
  docker start "\$CONTAINER" >/dev/null 2>&1 || { notify "Failed to start container"; exit 1; }
  STARTED_NOW=true
  wait_for_health || true
fi

if \$STARTED_NOW; then
  log "Waiting \${EXTRA_DELAY_AFTER_READY}s for API warm-up"
  sleep "\$EXTRA_DELAY_AFTER_READY"
fi

log "Running command (decoded): \$RUN_CMD_STR"
(
  echo "[xfreerdp start at \$(timestamp)]"
  bash -lc "\$RUN_CMD_STR"
  ec=\$?
  echo "[xfreerdp exit at \$(timestamp)] exit code: \$ec"
) >>"\$LOG_FILE" 2>&1 &
APP_PID=\$!
log "App started (PID \$APP_PID)"
notify "WinBoat ${APPNAME} started (PID \$APP_PID)"
EOF

chmod 0755 "$SCRIPT_PATH"
echo "✅ Created launcher script: $SCRIPT_PATH (mode 0755)"

# -----------------------------
# Generate .desktop (0644) with icon
# -----------------------------
cat > "$DESKTOP_PATH" <<EOF
[Desktop Entry]
Type=Application
Name=WinBoat ${APPNAME}
Exec=/usr/bin/env bash -lc '~/.local/bin/${APPFILE}.sh'
Icon=${ICON_VALUE}
Terminal=false
Categories=Utility;
EOF

chmod 0644 "$DESKTOP_PATH"
echo "✅ Created desktop entry: $DESKTOP_PATH (mode 0644)"
echo
echo "🎉  WinBoat app '${APPNAME}' created successfully!"
echo "• Script: $SCRIPT_PATH"
echo "• Desktop entry: $DESKTOP_PATH"
echo "• Icon: ${ICON_VALUE}"
echo "• Log file (runtime): ~/.cache/winboat/${APPFILE}.log"
echo
echo "Tip: refresh menu with:"
echo "  update-desktop-database \"$HOME/.local/share/applications\" 2>/dev/null || true"

while true; do
  read -rp "Would you like to install another app? [y]: " again
  if [[ "$again" =~ ^[Yy]$ ]]; then
    exec "$0" # Restart the script
  else
    echo "Exiting installer. Have a great day!"
    break
  fi
done

