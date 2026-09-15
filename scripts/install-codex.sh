#!/usr/bin/env bash
# Install the borumi skills for Codex CLI (and optionally as plain Claude Code skills).
#
#   scripts/install-codex.sh                 use this clone as the root (the repo this script lives in)
#   scripts/install-codex.sh --clone         clone github.com/Samin12/opencutagent-borumi into ~/.codex/skills/borumi first
#   scripts/install-codex.sh --mcp           also register the Borumi MCP server with `codex mcp add borumi`
#   scripts/install-codex.sh --claude-skills also symlink the skills into ~/.claude/skills (for use without the plugin system)
#   scripts/install-codex.sh --check         report only
#
# Every line is [ok] / [did] / [fix] / [note]. Idempotent: run it again after `git pull`.
set -u
REPO_URL="https://github.com/Samin12/opencutagent-borumi.git"
CODEX_SKILLS="$HOME/.codex/skills"
CLAUDE_SKILLS="$HOME/.claude/skills"
AGENT_HOME="${BORUMI_AGENT_HOME:-$HOME/.borumi-agent}"
BORUMI_BIN="${BORUMI_BIN:-/Applications/Borumi.app/Contents/MacOS/borumi}"
CHECK=0; CLONE=0; MCP=0; CLAUDE=0
for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;; --clone) CLONE=1 ;; --mcp) MCP=1 ;; --claude-skills) CLAUDE=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done
MISSING=0
ok()   { printf '[ok]   %s\n' "$*"; }
did()  { printf '[did]  %s\n' "$*"; }
note() { printf '[note] %s\n' "$*"; }
fix()  { printf '[fix]  %s\n' "$*"; MISSING=$((MISSING + 1)); }

# ---------------------------------------------------------------- root
if [ "$CLONE" = 1 ]; then
  ROOT="$CODEX_SKILLS/borumi"
  if [ -d "$ROOT/.git" ]; then
    [ "$CHECK" = 1 ] && ok "Repo at $ROOT" || { (cd "$ROOT" && git pull --ff-only -q) && did "Updated $ROOT" || note "Could not git pull in $ROOT; continuing with what is there"; }
  elif [ "$CHECK" = 1 ]; then
    fix "No clone at $ROOT. Run without --check to clone it."
  else
    mkdir -p "$CODEX_SKILLS" && git clone -q "$REPO_URL" "$ROOT" && did "Cloned into $ROOT" || { fix "git clone failed"; exit 1; }
  fi
else
  ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
fi
[ -f "$ROOT/scripts/job.mjs" ] && ok "Plugin root: $ROOT" || fix "$ROOT does not look like the borumi plugin (scripts/job.mjs missing)"

# ---------------------------------------------------------------- skills -> ~/.codex/skills/borumi-<name>
link_skill() { # $1 = target skills dir, $2 = skill name
  local dest="$1/borumi-$2" src="$ROOT/skills/$2"
  [ "$2" = "borumi-editing" ] && dest="$1/borumi-editing"
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then ok "$dest -> skills/$2"
  elif [ "$CHECK" = 1 ]; then fix "Link missing: ln -sfn \"$src\" \"$dest\""
  else
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then mv "$dest" "$dest.bak-$(date +%Y%m%d%H%M%S)" && note "Moved an old copy of $dest aside"; fi
    ln -sfn "$src" "$dest" && did "Linked $dest -> skills/$2" || fix "Could not link $dest"
  fi
}
mkdir -p "$CODEX_SKILLS"
for d in "$ROOT"/skills/*/; do
  n="$(basename "$d")"; [ -f "$d/SKILL.md" ] || continue
  link_skill "$CODEX_SKILLS" "$n"
  [ "$CLAUDE" = 1 ] && { mkdir -p "$CLAUDE_SKILLS"; link_skill "$CLAUDE_SKILLS" "$n"; }
done

# ---------------------------------------------------------------- ~/.borumi-agent/config.json (how scripts find the root)
mkdir -p "$AGENT_HOME"
CFG="$AGENT_HOME/config.json"
if [ -f "$CFG" ] && grep -q "\"root\": *\"$ROOT\"" "$CFG"; then ok "$CFG points at this root"
elif [ "$CHECK" = 1 ]; then fix "Write $CFG with {\"root\": \"$ROOT\"}"
else
  python3 - "$CFG" "$ROOT" "$AGENT_HOME" <<'PY'
import json, sys
p, root, home = sys.argv[1:4]
try: cfg = json.load(open(p))
except Exception: cfg = {}
cfg["root"] = root
cfg.setdefault("home", home)
json.dump(cfg, open(p, "w"), indent=1)
PY
  did "Wrote $CFG (root, home)"
fi

# ---------------------------------------------------------------- prerequisites
command -v node >/dev/null 2>&1 && ok "Node $(node -v)" || fix "Node.js 18+ is missing: brew install node"
command -v ffmpeg >/dev/null 2>&1 && ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | sed -E 's/^ffmpeg version ([^ ]+).*/\1/')" || fix "ffmpeg is missing: brew install ffmpeg"
[ -x "$BORUMI_BIN" ] && ok "Borumi at $BORUMI_BIN" || fix "Borumi.app not found at $BORUMI_BIN (install Borumi 0.30.5 or newer, or set BORUMI_BIN)"
command -v codex >/dev/null 2>&1 && ok "Codex CLI $(codex --version 2>/dev/null | head -1)" || note "Codex CLI not on PATH (skills are linked anyway)"

# ---------------------------------------------------------------- Borumi MCP server for Codex
if command -v codex >/dev/null 2>&1; then
  if codex mcp list 2>/dev/null | grep -q "^borumi\b\|\"borumi\"\|borumi "; then ok "Codex MCP server 'borumi' registered"
  elif [ "$MCP" = 1 ] && [ "$CHECK" = 0 ]; then
    codex mcp add borumi -- "$BORUMI_BIN" mcp >/dev/null 2>&1 && did "Registered Codex MCP server 'borumi'" || fix "codex mcp add failed; add [mcp_servers.borumi] command=\"$BORUMI_BIN\" args=[\"mcp\"] to ~/.codex/config.toml by hand"
  else
    note "Codex MCP server 'borumi' not registered. Run: codex mcp add borumi -- \"$BORUMI_BIN\" mcp   (or re-run with --mcp). Without it the skills fall back to scripts/borumi_mcp.py."
  fi
fi

# ---------------------------------------------------------------- summary
echo
if [ "$MISSING" -gt 0 ]; then echo "$MISSING thing(s) to fix (the [fix] lines above)."; exit 1; fi
cat <<TXT
All set. In Codex, open Borumi with your project, then type:
  \$borumi-visualize scene 3
  \$borumi-setup --install      (first run: installs the Remotion kit workspace)
Deliverables land next to your .bmprojbundle in "<project name> Agent/". Kit workspace: $AGENT_HOME/animation-kit
TXT
