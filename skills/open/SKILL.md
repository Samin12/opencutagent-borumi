---
name: open
description: "Borumi: list the recent and open Borumi projects, open one by name or path, and bring it to the front in the app. Triggers: /borumi:open, open my Astra project, open the last project, which projects are open, switch to the launch video, show project X in Borumi."
allowed-tools: Bash(node:*) Read Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__list_recent_projects mcp__plugin_borumi_borumi__open_project mcp__plugin_borumi_borumi__focus_project mcp__plugin_borumi_borumi__get_ui_state mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:open

Project navigation only. No transaction, no content change. Opening a project does not show it; `focus_project` does, and only for a project that is already open.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:open                                  list open and recent projects
/borumi:open Astra                            open by name (case-insensitive, substring) and show it
/borumi:open last                             the most recently modified project
/borumi:open /Volumes/Drive/Borumi Projects/Astra launch.bmprojbundle
/borumi:open Astra --background               open without bringing it to the front
```

## Guides to fetch first

`get_guides` with no arguments once per session, then `ui_navigation` (it gates `open_project` and `focus_project`).

## Procedure

1. `list_open_projects` -> `{active_project_id, projects:[{id, is_active, name, path}]}`. `app_not_running`: Borumi is closed; say so (`open -a Borumi`), stop.
2. No argument: also `list_recent_projects` -> `{projects:[{id, name, path, last_modified_at}]}`. Print one table, newest first:
   ```
   Project                 Last edited        Open   Front
   Astra launch            today 14:31        yes    yes
   jarvis-visualize-test   yesterday 18:49    yes
   Fable hook              Sep 1              no
   ```
   Then ask which one to open, or stop if the user only asked what is open.
3. A name: match the open projects first (case-insensitive substring of `name`). One match and it is open: `focus_project {project_id}` unless `--background` or the user only asked whether it is open; report. Not open: `list_recent_projects`, match the same way. Exactly one: `open_project {project_id}`. `last`: the first recent project. Several matches: print them and ask which (one question, stop). None: say so and print the five most recent names.
4. A path: it must be absolute and end in `.bmprojbundle` (`invalid_project_path` otherwise). Check it exists first: `node --input-type=module -e "import { assertProjectBundle } from '$BORUMI_PLUGIN_ROOT/scripts/lib/paths.mjs'; console.log(assertProjectBundle(process.argv[1]))" "<path>"`; a "mount the drive first" or "does not exist" message is reported as is and stops the command. Then `open_project {path}`.
5. After `open_project`: `list_open_projects` again to confirm it is open (the reply's id is the one to use from now on). Then `focus_project {project_id}` unless `--background`. Never retry focus while Borumi is recording or counting down; say so and stop.
6. One line about the project: `get_project_overview {project_id, slices:["project","scenes","transcripts"]}` -> `Astra launch: 3 scenes, 12:04, transcript ready.` (`get_scenes` only when the user asks what the scenes are).
7. Report: `Opened "Astra launch" (last edited today) and brought it to the front. 3 scenes, 12:04, transcript ready.` End with the next action (`/borumi:inspect`, `/borumi:visualize scene 1`).

## Rules

- Never focus a project the user did not ask to see; background work stays in the background.
- Creating, duplicating, renaming, closing and deleting projects are not this command (closing and deleting are not available through the MCP at all; do not fake them with file operations).
- Ids are session aliases: always re-list before using one, and never print them.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`.
- Codex or any host without the plugin MCP: `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call list_recent_projects '{}'` then `call open_project '{"project_id":"..."}'` on one daemon connection (`start` once).
