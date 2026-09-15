#!/usr/bin/env bash
# Doctor for the borumi Claude Code plugin (macOS only; Borumi is a Mac app). Idempotent.
#
#   bash scripts/doctor.sh            same as --check
#   bash scripts/doctor.sh --check    report what is installed and what is missing, change nothing
#   bash scripts/doctor.sh --install  also install the animation kit workspace (npm deps + headless Chrome)
#
# Works from any cwd (it locates the plugin root from its own path). Every line of the report
# starts with [ok], [did], [fix] or [note] so a person or the /borumi:setup skill can read it and
# act on the [fix] lines; each [fix] names the exact command that resolves it. Exit 1 when
# anything needs fixing, else 0. It never installs system software itself (it prints the brew
# command) and never touches Borumi projects.
#
# Environment: BORUMI_APP (default /Applications/Borumi.app), BORUMI_BIN, FFMPEG_BIN,
# BORUMI_AGENT_HOME (default ~/.borumi-agent), DOCTOR_INSTALL_WAIT_SECS (default 480).
set -u

CHECK=1
INSTALL=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (use --check or --install)" >&2; exit 2 ;;
  esac
done

MISSING=0
ok()   { printf '[ok]   %s\n' "$*"; }
did()  { printf '[did]  %s\n' "$*"; }
note() { printf '[note] %s\n' "$*"; }
fix()  { printf '[fix]  %s\n' "$*"; MISSING=$((MISSING + 1)); }

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This plugin drives Borumi, a macOS app; run the doctor on the Mac where Borumi is installed." >&2
  exit 1
fi

# Tools installed by Homebrew or the Node installers often live outside the PATH of a fresh shell
# (and of Claude Code's Bash tool); look there too.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
for d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$d" ] && export PATH="$PATH:$d"; done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
TOOLS_MJS="$ROOT/scripts/lib/tools.mjs"
KIT_MJS="$ROOT/scripts/kit.mjs"
APP="${BORUMI_APP:-/Applications/Borumi.app}"
BIN="${BORUMI_BIN:-$APP/Contents/MacOS/borumi}"
MIN_BORUMI="0.30.5"
AGENT_HOME="${BORUMI_AGENT_HOME:-$HOME/.borumi-agent}"
KIT="$AGENT_HOME/animation-kit"
SETTINGS_DB="$HOME/Library/Application Support/borumi/settings.db"

echo "borumi plugin at: $ROOT"
[ "$INSTALL" = 1 ] && echo "(install mode: the animation kit will be installed if it is missing)" || echo "(check only, nothing will be changed)"
echo

# ---------------------------------------------------------------- Node >= 18 and npm
HAVE_NODE=0
if command -v node >/dev/null 2>&1; then
  major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
  if [ -n "$major" ] && [ "$major" -ge 18 ] 2>/dev/null; then
    ok "Node.js $(node -v) at $(command -v node)"
    HAVE_NODE=1
  else
    fix "Node.js 18+ is required (found $(node -v 2>/dev/null || echo unknown)). Install it with: brew install node   (or from https://nodejs.org), then re-run this script."
  fi
else
  fix "Node.js 18+ is missing. Install it with: brew install node   (or from https://nodejs.org), then re-run this script."
fi
if command -v npm >/dev/null 2>&1; then
  ok "npm $(npm -v 2>/dev/null)"
else
  fix "npm is missing (it ships with Node.js). Install Node.js with: brew install node   then re-run this script."
fi

# ---------------------------------------------------------------- ffmpeg and ffprobe (absolute paths)
FFMPEG="${FFMPEG_BIN:-}"
[ -z "$FFMPEG" ] && FFMPEG="$(command -v ffmpeg 2>/dev/null || true)"
if [ -n "$FFMPEG" ] && [ -x "$FFMPEG" ]; then
  case "$FFMPEG" in
    /*) ;;
    *) FFMPEG="$(cd "$(dirname "$FFMPEG")" && pwd -P)/$(basename "$FFMPEG")" ;;
  esac
  ffver="$("$FFMPEG" -version 2>/dev/null | head -1 | sed -E 's/^ffmpeg version ([^ ]+).*/\1/')"
  ok "ffmpeg ${ffver:-?} at $FFMPEG"
  FFPROBE="$(dirname "$FFMPEG")/ffprobe"
  if [ -x "$FFPROBE" ] || command -v ffprobe >/dev/null 2>&1; then
    ok "ffprobe at $([ -x "$FFPROBE" ] && echo "$FFPROBE" || command -v ffprobe)"
  else
    fix "ffprobe is missing next to ffmpeg. Reinstall with: brew reinstall ffmpeg"
  fi
else
  fix "ffmpeg is missing. Install it with: brew install ffmpeg   (Homebrew: https://brew.sh), or set FFMPEG_BIN to its full path, then re-run this script."
fi

# ---------------------------------------------------------------- Borumi.app and its version
HAVE_BORUMI=0
if [ -x "$BIN" ]; then
  bver="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "")"
  if [ -z "$bver" ]; then
    note "Borumi found at $APP but its version could not be read from Info.plist."
    HAVE_BORUMI=1
  elif [ "$HAVE_NODE" = 1 ] && node "$TOOLS_MJS" version-ge "$bver" "$MIN_BORUMI"; then
    ok "Borumi $bver at $APP"
    HAVE_BORUMI=1
  elif [ "$HAVE_NODE" = 1 ]; then
    fix "Borumi $bver is older than $MIN_BORUMI (the version the plugin was verified against). Update it: open Borumi and check for updates, then re-run this script."
  else
    note "Borumi $bver at $APP (version check skipped until Node.js is installed)."
    HAVE_BORUMI=1
  fi
else
  fix "Borumi.app is missing at $APP (or BORUMI_APP points elsewhere). Install Borumi, then re-run this script."
fi

# ---------------------------------------------------------------- MCP switch in Borumi's settings
if [ -f "$SETTINGS_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  mcp_on="$(sqlite3 "$SETTINGS_DB" "select value from settings where key='mcp_enabled'" 2>/dev/null || echo "")"
  case "$mcp_on" in
    true) ok "Borumi MCP is enabled (Settings > AI)" ;;
    "") note "Borumi has no mcp_enabled setting yet. If project tools fail, turn it on: Borumi > Settings > AI > Enable MCP." ;;
    *) fix "Borumi's MCP is turned off. Turn it on: Borumi > Settings > AI > Enable MCP, then re-run this script." ;;
  esac
else
  note "Could not read Borumi's settings.db (sqlite3 or the file is missing); the live probe below is the real test."
fi

# ---------------------------------------------------------------- borumi mcp over stdio: tool list + app status
if [ "$HAVE_BORUMI" = 1 ] && [ "$HAVE_NODE" = 1 ]; then
  probe="$(node "$TOOLS_MJS" probe --lines --bin "$BIN" 2>/dev/null || true)"
  get() { printf '%s\n' "$probe" | grep "^$1=" | head -1 | cut -d= -f2-; }
  perr="$(get probe_error)"
  if [ -n "$perr" ] || [ -z "$probe" ]; then
    fix "borumi mcp did not answer over stdio (${perr:-no output}). Quit and reopen Borumi, make sure Settings > AI > Enable MCP is on, then re-run this script."
  else
    tool_count="$(get tool_count)"
    missing="$(get missing)"
    bad="$(get bad_schema)"
    expected_count="$(node "$TOOLS_MJS" list | wc -l | tr -d ' ')"
    if [ -z "$missing" ] && [ -z "$bad" ]; then
      ok "borumi mcp answers tools/list ($tool_count tools; all $expected_count the plugin uses are present with object schemas)"
    elif [ -n "$missing" ]; then
      fix "Borumi's MCP is missing tools the plugin calls: $missing. Update Borumi to $MIN_BORUMI or newer, then re-run this script."
    else
      fix "Borumi advertises tools without an object input schema: $bad. Update Borumi, then re-run this script."
    fi
    case "$(get app_status)" in
      ok)
        n="$(get open_projects)"
        names="$(get project_names)"
        if [ "${n:-0}" -gt 0 ] 2>/dev/null; then ok "Borumi is running with $n project(s) open: $names"
        else ok "Borumi is running (no project open yet: open one in Borumi, or run /borumi:open <name>)"; fi
        ;;
      app_not_running)
        fix "Borumi is not running (project tools return app_not_running). Open it: open -a Borumi   then re-run this script."
        ;;
      *)
        fix "list_open_projects failed: $(get app_message). Quit and reopen Borumi, then re-run this script."
        ;;
    esac
  fi
elif [ "$HAVE_BORUMI" = 1 ]; then
  note "MCP probe skipped until Node.js is installed."
fi

# ---------------------------------------------------------------- animation kit workspace
kit_ready() {
  [ -f "$KIT/node_modules/remotion/package.json" ] && [ -n "$(find "$KIT/node_modules/.remotion/chrome-headless-shell" -type f -name chrome-headless-shell 2>/dev/null | head -1)" ]
}
report_kit() {
  if [ -f "$KIT/node_modules/remotion/package.json" ]; then
    rv=""
    [ "$HAVE_NODE" = 1 ] && rv="$(node -p "require(require('node:path').resolve(process.argv[1])).version" "$KIT/node_modules/remotion/package.json" 2>/dev/null || true)"
    ok "Animation kit installed at $KIT (remotion ${rv:-version unknown})"
    KIT_DEPS=1
  else
    KIT_DEPS=0
  fi
  shell="$(find "$KIT/node_modules/.remotion/chrome-headless-shell" -type f -name chrome-headless-shell 2>/dev/null | head -1)"
  if [ -n "$shell" ]; then ok "Headless Chrome for renders present ($(echo "$shell" | sed -E 's#.*/chrome-headless-shell/##' | cut -d/ -f1))"; KIT_CHROME=1; else KIT_CHROME=0; fi
}
KIT_DEPS=0; KIT_CHROME=0
report_kit
if [ "$KIT_DEPS" = 1 ] && [ "$KIT_CHROME" = 1 ]; then
  :
elif [ ! -f "$KIT_MJS" ]; then
  fix "scripts/kit.mjs is missing from this checkout, so the animation kit cannot be installed. Update the plugin (git pull in $ROOT), then run: bash \"$ROOT/scripts/doctor.sh\" --install"
elif [ "$INSTALL" = 1 ] && [ "$HAVE_NODE" = 1 ]; then
  LOG="$AGENT_HOME/kit-install.log"
  mkdir -p "$AGENT_HOME"
  echo "Installing the animation kit into $KIT (npm dependencies + headless Chrome; first run takes a few minutes, log: $LOG)..."
  # Detached so Claude Code's Bash limit cannot kill npm halfway; we poll for the result below.
  pid="$(node -e '
    const { spawn } = require("node:child_process"); const fs = require("node:fs");
    const [kit, log] = process.argv.slice(1);
    const fd = fs.openSync(log, "a");
    const c = spawn(process.execPath, [kit, "ensure"], { detached: true, stdio: ["ignore", fd, fd], env: process.env });
    c.unref(); console.log(c.pid);
  ' "$KIT_MJS" "$LOG" 2>/dev/null || echo "")"
  waited=0
  MAX="${DOCTOR_INSTALL_WAIT_SECS:-480}"
  while [ "$waited" -lt "$MAX" ]; do
    kit_ready && break
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 5; waited=$((waited + 5))
  done
  if kit_ready; then
    did "Animation kit installed at $KIT"
    report_kit
  elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    note "The kit install is still running in the background (pid $pid, log $LOG). Run again in a few minutes: bash \"$ROOT/scripts/doctor.sh\" --check"
  else
    fix "The kit install did not complete. Read $LOG, then run it by hand: node \"$KIT_MJS\" ensure"
  fi
else
  if [ "$KIT_DEPS" = 0 ]; then
    fix "Animation kit is not installed (no remotion in $KIT). Run: bash \"$ROOT/scripts/doctor.sh\" --install   (or: node \"$KIT_MJS\" ensure)"
  else
    fix "Headless Chrome for renders is missing. Run: node \"$KIT_MJS\" ensure   (it runs remotion browser ensure)"
  fi
fi

# ---------------------------------------------------------------- Claude Code CLI
if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1 | sed -E 's/ *\(Claude Code\)//') at $(command -v claude)"
  note "Make sure it is signed in (run 'claude' once); the plugin's skills run inside your Claude Code session."
else
  fix "Claude Code CLI is missing. Install: curl -fsSL https://claude.ai/install.sh | bash   then run 'claude' once to sign in, and re-run this script."
fi

# ---------------------------------------------------------------- plugin wiring
if [ -f "$ROOT/.mcp.json" ] && grep -q '/Contents/MacOS/borumi' "$ROOT/.mcp.json" 2>/dev/null; then
  ok ".mcp.json registers the borumi MCP server"
else
  fix ".mcp.json is missing or does not point at Borumi. Restore it: git -C \"$ROOT\" checkout .mcp.json"
fi
if [ -f "$ROOT/.claude-plugin/plugin.json" ] && grep -q '"name": *"borumi"' "$ROOT/.claude-plugin/plugin.json" 2>/dev/null; then
  ok "plugin manifest present (.claude-plugin/plugin.json)"
else
  note "No .claude-plugin/plugin.json with name borumi at $ROOT; fine when running from a marketplace install, otherwise git pull."
fi

# ---------------------------------------------------------------- summary
echo
if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING thing(s) to fix (the [fix] lines above). Fix them and run this script again."
  exit 1
fi
cat <<TXT
All set. Next:
  1. Open your project in Borumi (or run /borumi:open <name> from Claude Code).
  2. In Claude Code: /borumi:inspect to see the scenes, then /borumi:visualize scene 1.
  3. Cuts, silences, retakes, inserts, chapters, captions and exports are /borumi:<command>; each previews before it commits.
TXT
