---
name: setup
description: Install, update, verify or troubleshoot OpenCutAgent on this machine (macOS or Windows) so the Premiere Pro panel opens and every prerequisite shows green. Use when the user says "set this up", "install", "make it work", "the panel is not showing", "something is red in Health", or just opened Claude Code in this repo for the first time. Runs the repo's install script, fixes what it reports missing, and verifies.
---

# Set up OpenCutAgent on this machine

You are helping a video editor get the OpenCutAgent panel working inside Adobe Premiere Pro. Most of the work is done by a deterministic script that reports every check on its own line; your job is to run it, act on the `[fix]` lines it prints, run it again, and explain the result in plain words. Never improvise registry edits, `defaults write` commands or symlinks by hand while the script can do them.

## What "installed" means

1. `server/node_modules` exists (the engine's two npm dependencies).
2. Premiere's developer mode is on (CSXS.11 and CSXS.12 `PlayerDebugMode=1`), so an unsigned panel loads.
3. The `cep-panel` folder is LINKED (symlink on macOS, junction on Windows, never a copy) into Premiere's extensions folder as `com.opencutagent.panel`. The panel finds the engine by walking up from its own real path, so a copy breaks auto-start.
4. Node 18+ and ffmpeg are installed. Claude Code is installed and signed in (every AI feature runs on the user's Claude subscription; the default mode is Self-hosted).
5. Optional: `.mcp.json` with the absolute path of this clone's `server/index.js`, only for driving the panel from a Claude Code chat.
6. Optional: Claude in Chrome, so the Animation agent can look at pages in the user's own browser (the "Your Chrome" toggle beside the animation chat). The script prints a `[note]` when it is not connected; it is never a `[fix]`. To connect: install the Claude in Chrome extension from the Chrome Web Store, then run `claude --chrome` once with the same login the panel uses and press Enter at the intro. It needs a Pro/Max/Team/Enterprise `/login`, not an API key.

Nothing is compiled. Opening the panel in Premiere starts the engine (`node server/index.js`) automatically and stops it when the panel closes.

## Steps

1. **Run the report first.** From the repo root:
   - macOS: `./install.sh --check`
   - Windows: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Check`
   Read every line. `[ok]` needs nothing. `[fix]` names the exact command that resolves it. `[note]` is context.
2. **Run the real install** (same script without `--check` / `-Check`). It installs Node and ffmpeg through Homebrew or winget when they are missing, runs `npm install`, turns developer mode on, creates the link and writes `.mcp.json`. It never installs Claude Code by itself.
3. **Act on what is still `[fix]`.** Run the command the line gives (ask first for anything that installs software system-wide). If Claude Code is missing, tell the user to install it and sign in; do not guess an install method beyond what the script prints. Run the script again until it prints "All set".
4. **Verify.** `cd server && npm run check && npm test` must pass (no Premiere or keys needed). Then tell the user: quit and reopen Premiere, open Window > Extensions > OpenCutAgent, and click the pulse icon in the panel header. Every row in that Health dropdown should show a green dot; a red row shows what to fix.
5. **Report** in a few sentences: what was installed, what you could not do, and the next click.

## Troubleshooting map (panel symptoms to causes)

- Health button keeps pulsing, or its Engine row says "Starting server" / "Waiting for server": the engine crashes at boot, almost always missing `npm install` in `server/`. Run `node server/index.js` in a terminal to see the error.
- "Server not found. Run: node server/index.js": the panel folder was copied, not linked. Re-run the script; it moves the copy aside and links.
- "Node not found": install Node, reopen the panel.
- Panel absent from the Extensions menu: developer mode off or the link missing. Re-run the script, restart Premiere.
- Health row "Claude Code" red: not installed, or installed in a location the engine does not search. `EDITAGENT_CLAUDE_BIN` in the panel's Advanced settings takes a full path.
- Health row "ffmpeg" red though it is installed: `FFMPEG_BIN` in the panel's Advanced settings takes a full path.
- "OAuth session expired" on an AI button: the engine uses a different Claude login folder. Run `claude` and `/login`, or set `EDITAGENT_CLAUDE_CONFIG_DIR`.
- Health row "Claude in Chrome" grey ("not set up") though the user ran `claude --chrome`: the onboarding was done for a different login folder than the engine spawns with. Run it again with `CLAUDE_CONFIG_DIR` set to the folder in `EDITAGENT_CLAUDE_CONFIG_DIR` (or unset both). Grey is optional, not an error.
- "Unknown RPC method" after updating: an old engine still owns port 3001 (`lsof -nP -iTCP:3001 -sTCP:LISTEN`, or `netstat -ano | findstr :3001`). Kill it, reopen the panel.

## Rules

- Never delete the user's Premiere projects, sequences or the `.cache/` folder as part of setup.
- No em dashes in anything you write for the user.
- If the user only wants to update, `git pull` then run the script again; that is the whole update path.
