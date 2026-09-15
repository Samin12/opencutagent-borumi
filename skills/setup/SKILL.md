---
name: setup
description: "Borumi: check this Mac for everything the borumi plugin needs (Borumi 0.30.5+ with MCP on, Node 18+, ffmpeg, the animation kit workspace with Remotion and headless Chrome, the Claude CLI) by running scripts/doctor.sh, fix what it reports, and install the kit. Triggers: /borumi:setup, set this up, install the animation kit, make it work, something says app_not_running, the plugin is not working, doctor."
allowed-tools: Bash(bash:*) Bash(node:*) Bash(python3:*) Read Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:setup

A deterministic script does the checking; your job is to run it, act on the `[fix]` lines it prints, run it again, and explain the result in plain words. Never improvise system changes the script would print a command for.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). The doctor is `bash $BORUMI_PLUGIN_ROOT/scripts/doctor.sh`. Tool names are Borumi's own (see Host notes).

## What "installed" means

1. macOS with Borumi.app 0.30.5 or newer, and Settings > AI > Enable MCP turned on (the plugin talks to `borumi mcp` over stdio; with the app closed only tool listing works, every project tool returns `app_not_running`).
2. Node 18+ and npm; ffmpeg and ffprobe on an absolute path (`brew install ffmpeg`).
3. The animation kit workspace at `~/.borumi-agent/animation-kit` (`BORUMI_AGENT_HOME` overrides): the Remotion template copied there, `npm install` done, and the headless Chrome shell downloaded, so the first `/borumi:visualize` renders instead of installing.
4. The Claude Code CLI, signed in (the skills run inside the session; no API key is used).
5. The plugin's `.mcp.json` registering Borumi's binary.

## The report contract

Every doctor line starts with `[ok]`, `[did]`, `[fix]` or `[note]`. `[ok]` needs nothing. `[fix]` names the exact command that resolves it. `[did]` is something the script just did (only in `--install` mode). `[note]` is context. The run ends with `N thing(s) to fix` (exit 1) or `All set. Next:` (exit 0).

## Steps

1. Run the report: `bash $BORUMI_PLUGIN_ROOT/scripts/doctor.sh --check`. Read every line.
2. Act on each `[fix]`:
   - Borumi not running: tell the user to open it (`open -a Borumi`), then re-run the check. Do not loop.
   - MCP off: the user turns it on in Borumi > Settings > AI > Enable MCP.
   - Node, ffmpeg, the Claude CLI: the line prints the `brew` or installer command. Ask before running anything that installs software system-wide (one question, stop); run it when told to, from the command as printed.
   - Animation kit missing or headless Chrome missing: run `bash $BORUMI_PLUGIN_ROOT/scripts/doctor.sh --install`. When the user ran `/borumi:setup` without `--install`, ask first: `Install the animation kit now (a few hundred MB into ~/.borumi-agent, takes a few minutes)?` (one question, stop). The install runs detached; the doctor waits up to 8 minutes and then prints a `[note]` if it is still going: wait (`python3 -c "import time; time.sleep(60)"`) and run `--check` again, at most ten times, before reporting a stuck install with the log path the note gives.
   - Borumi older than 0.30.5: the user updates the app; the plugin's verified behaviour starts there.
3. Run `--check` again until it prints `All set.`
4. Live check through the session's own connection: `get_guides` (no arguments), then `list_open_projects`. Working: report the open projects. The tools are not available in this session: the plugin's MCP server is not connected; in Claude Code run `/mcp` and reconnect `borumi`, or restart the session (nothing hot-reloads). `app_not_running` here while the doctor said Borumi runs: the session's connection predates the app launch; reconnect.
5. Report in a few sentences: what is installed, what changed, what is still missing and the exact next click. Then the next action (`/borumi:open <name>` or `/borumi:inspect`).

## Troubleshooting map (symptom to cause)

- `app_not_running` on every project tool: Borumi is closed, or MCP is off in Settings > AI. Open it, turn it on, retry once.
- `guide_required`: fetch the named guide with `get_guides` (one id) and retry once; every new connection starts gated.
- `unknown_id_alias`: the id came from another connection or an earlier session. Re-list and match structurally.
- The `/borumi:*` commands exist but no Borumi tools: the plugin MCP server failed to start. `bash scripts/doctor.sh --check` shows whether `borumi mcp` answers; then `/mcp` in Claude Code.
- A render fails with a browser download or "chrome-headless-shell" message: the kit's headless Chrome is missing; `--install` (it runs `remotion browser ensure`).
- `npm install` fails inside the kit: read `~/.borumi-agent/kit-install.log`; usually network or a Node older than 18.
- "mount the drive first": the project bundle sits on an external drive that is not mounted; mount it, retry.
- Bash killed a long step at 600 s: renders and kit installs are detached by design (`job.mjs render` + `wait`, doctor `--install`); anything else that ran that long is a bug worth reporting.

## Rules

- Never delete the user's Borumi projects, the `~/.borumi-agent` workspace or its jobs as part of setup.
- Do not install system software without asking; the doctor prints the command and waits for a person.
- Updating the plugin: `git pull` in the plugin folder (or the marketplace update command), then `--check` again; that is the whole update path.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`; `/mcp` shows the plugin server's connection state.
- Codex or any host without the plugin MCP: `scripts/install-codex.sh` installs the skills and can register the MCP server; the live check is `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call list_open_projects '{}'` after `start`.
