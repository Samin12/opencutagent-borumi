#!/usr/bin/env bash
# OpenCutAgent installer for macOS. Idempotent: run it again after a `git pull`
# and it only redoes what changed, so it doubles as the updater.
#
#   ./install.sh            install or update everything
#   ./install.sh --check    report what is installed and what is missing, change nothing
#
# One-line install (clones into ~/OpenCutAgent, or $OPENCUTAGENT_DIR):
#   curl -fsSL https://raw.githubusercontent.com/leonardogrig/opencutagent/main/install.sh | bash
#
# Every line of the report starts with [ok], [did], [fix] or [note] so a person
# or a Claude Code session (the /setup skill) can read it and act on the [fix] lines.
set -u

REPO_URL="https://github.com/leonardogrig/opencutagent.git"
EXT_ID="com.opencutagent.panel"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions"
CHECK=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done

MISSING=0
ok()   { printf '[ok]   %s\n' "$*"; }
did()  { printf '[did]  %s\n' "$*"; }
note() { printf '[note] %s\n' "$*"; }
fix()  { printf '[fix]  %s\n' "$*"; MISSING=$((MISSING + 1)); }

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows run install.ps1 (PowerShell). Premiere Pro does not run on Linux." >&2
  exit 1
fi

# Tools installed by Homebrew or the Node installers often live outside the
# PATH of a fresh shell; look there too, the same way the panel does.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
for d in "$HOME"/.nvm/versions/node/*/bin; do [ -d "$d" ] && export PATH="$PATH:$d"; done

# ---------------------------------------------------------------- repo root
# Run from inside a clone: use it. Run via curl: clone (or update) ~/OpenCutAgent.
ROOT=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  cand="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  [ -f "$cand/server/index.js" ] && ROOT="$cand"
fi
if [ -z "$ROOT" ]; then
  ROOT="${OPENCUTAGENT_DIR:-$HOME/OpenCutAgent}"
  if [ -f "$ROOT/server/index.js" ]; then
    if [ "$CHECK" = 1 ]; then ok "Repo at $ROOT"
    else (cd "$ROOT" && git pull --ff-only -q) && did "Updated the repo at $ROOT" || note "Could not git pull in $ROOT (local changes?). Continuing with what is there."
    fi
  elif [ "$CHECK" = 1 ]; then
    fix "No OpenCutAgent clone at $ROOT. Run without --check to clone it, or run this script from inside a clone."
    echo; echo "$MISSING thing(s) to fix."; exit 1
  else
    if ! command -v git >/dev/null 2>&1; then fix "git is missing. Install the Xcode command line tools: xcode-select --install"; echo; exit 1; fi
    git clone -q "$REPO_URL" "$ROOT" && did "Cloned OpenCutAgent into $ROOT" || { fix "git clone failed (network?)"; exit 1; }
  fi
fi
echo "OpenCutAgent at: $ROOT"
[ "$CHECK" = 1 ] && echo "(check only, nothing will be changed)"
echo

# ---------------------------------------------------------------- Homebrew
HAVE_BREW=0
command -v brew >/dev/null 2>&1 && HAVE_BREW=1

# ---------------------------------------------------------------- Node >= 18
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 18 ] 2>/dev/null; then
  ok "Node.js $(node -v)"
else
  if [ "$CHECK" = 0 ] && [ "$HAVE_BREW" = 1 ]; then
    echo "Installing Node.js with Homebrew (this can take a minute)..."
    brew install node >/dev/null 2>&1 && did "Installed Node.js $(node -v)" || fix "Node.js 18+ is missing and brew install node failed. Install it from https://nodejs.org and re-run."
  else
    fix "Node.js 18+ is missing. Install it with: brew install node   (or from https://nodejs.org), then re-run this script."
  fi
fi

# ---------------------------------------------------------------- ffmpeg
if command -v ffmpeg >/dev/null 2>&1; then
  ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | sed -E 's/^ffmpeg version ([^ ]+).*/\1/')"
else
  if [ "$CHECK" = 0 ] && [ "$HAVE_BREW" = 1 ]; then
    echo "Installing ffmpeg with Homebrew (this can take a few minutes)..."
    brew install ffmpeg >/dev/null 2>&1 && did "Installed ffmpeg" || fix "ffmpeg is missing and brew install ffmpeg failed. Install it by hand, then re-run."
  else
    fix "ffmpeg is missing. Install it with: brew install ffmpeg   (Homebrew: https://brew.sh), then re-run this script."
  fi
fi

# ---------------------------------------------------------------- Claude Code
if command -v claude >/dev/null 2>&1; then
  ok "Claude Code $(claude --version 2>/dev/null | head -1 | sed -E "s/ *\(Claude Code\)//")"
  note "Make sure it is signed in: run 'claude' once in a terminal (AI features run on your Claude subscription)."
  # Optional: Claude in Chrome lets the Animation agent browse in the user's own
  # browser. The CLI's one-time onboarding writes chrome/chrome-native-host* into
  # the login's config dir (the same dir the engine spawns with; see health.js).
  CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  if [ -f "$ROOT/.env" ]; then
    envdir="$(grep -E '^EDITAGENT_CLAUDE_CONFIG_DIR=' "$ROOT/.env" | tail -1 | cut -d= -f2- | tr -d '"'"'"'"')"
    [ -n "$envdir" ] && CFG="$envdir"
  fi
  if ls "$CFG"/chrome/chrome-native-host* >/dev/null 2>&1; then ok "Claude in Chrome connected (optional: the Animation agent can browse in your Chrome)"
  else note "Claude in Chrome is not connected (optional). To let the Animation agent look at pages in your own browser: install the Claude in Chrome extension, then run 'claude --chrome' once and press Enter at the intro."; fi
else
  fix "Claude Code is missing (needed for every AI feature). Install: curl -fsSL https://claude.ai/install.sh | bash   then run 'claude' once to sign in, and re-run this script."
fi

# ---------------------------------------------------------------- engine dependencies
if [ "$CHECK" = 1 ]; then
  if [ -d "$ROOT/server/node_modules/ws" ] && [ -d "$ROOT/server/node_modules/@modelcontextprotocol" ]; then ok "Engine dependencies installed (server/node_modules)"
  else fix "Engine dependencies are not installed. Run: cd \"$ROOT/server\" && npm install"; fi
elif command -v npm >/dev/null 2>&1; then
  if (cd "$ROOT/server" && npm install --no-audit --no-fund --loglevel=error >/dev/null); then did "Engine dependencies installed (server/node_modules)"
  else fix "npm install failed in $ROOT/server. Run it by hand to see the error."; fi
else
  fix "npm is missing (it comes with Node.js). Install Node.js, then run: cd \"$ROOT/server\" && npm install"
fi

# ---------------------------------------------------------------- CEP developer mode
# Premiere only loads unsigned panels with PlayerDebugMode on. CSXS.11 = Premiere 2024, CSXS.12 = 2025/2026.
for v in 11 12; do
  cur="$(defaults read "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null || true)"
  if [ "$cur" = "1" ]; then ok "Premiere developer mode on (CSXS.$v)"
  elif [ "$CHECK" = 1 ]; then fix "Premiere developer mode is off for CSXS.$v. Run: defaults write com.adobe.CSXS.$v PlayerDebugMode 1"
  else defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 && did "Turned on Premiere developer mode (CSXS.$v)" || fix "Could not write com.adobe.CSXS.$v PlayerDebugMode"; fi
done

# ---------------------------------------------------------------- panel link
# A LINK, never a copy: the panel finds the engine by walking up from its own real path.
LINK="$EXT_DIR/$EXT_ID"
TARGET="$ROOT/cep-panel"
if [ -L "$LINK" ] && [ "$(cd "$LINK" 2>/dev/null && pwd -P)" = "$(cd "$TARGET" && pwd -P)" ]; then
  ok "Panel linked into Premiere ($LINK)"
elif [ "$CHECK" = 1 ]; then
  fix "Panel is not linked into Premiere. Run: mkdir -p \"$EXT_DIR\" && ln -sfn \"$TARGET\" \"$LINK\""
else
  mkdir -p "$EXT_DIR"
  if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
    bak="$LINK.bak-$(date +%Y%m%d%H%M%S)"
    mv "$LINK" "$bak" && note "Moved an old copy of the panel aside to $bak"
  fi
  ln -sfn "$TARGET" "$LINK" && did "Linked the panel into Premiere ($LINK)" || fix "Could not create the link at $LINK"
fi

# ---------------------------------------------------------------- .mcp.json (chat control from Claude Code)
MCP="$ROOT/.mcp.json"
if [ -f "$MCP" ]; then
  if grep -q "$ROOT/server/index.js" "$MCP" 2>/dev/null; then ok ".mcp.json points at this clone"
  else note ".mcp.json exists but does not point at $ROOT/server/index.js (fine if you moved things on purpose)."; fi
elif [ "$CHECK" = 1 ]; then
  note "No .mcp.json yet (only needed to drive the panel from a Claude Code chat)."
else
  cat > "$MCP" <<JSON
{
  "mcpServers": {
    "premiere": {
      "type": "stdio",
      "command": "node",
      "args": ["$ROOT/server/index.js"],
      "timeout": 600000
    }
  }
}
JSON
  did "Wrote .mcp.json so a Claude Code chat opened in $ROOT can drive the panel"
fi

# ---------------------------------------------------------------- summary
echo
if [ "$MISSING" -gt 0 ]; then
  echo "$MISSING thing(s) to fix (the [fix] lines above). Fix them and run this script again."
  exit 1
fi
if pgrep -xq "Adobe Premiere Pro"; then note "Premiere Pro is running: quit and reopen it so it picks up the panel."; fi
cat <<TXT
All set. Next:
  1. Start (or restart) Premiere Pro and open a project.
  2. Window > Extensions > OpenCutAgent. The panel starts its own engine.
  3. Click the pulse icon in the panel header: every item should have a green dot.
  4. Retakes tab needs an ElevenLabs key: add it from the gear icon. Remove Silences needs nothing.
TXT
