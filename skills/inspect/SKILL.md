---
name: inspect
description: "Borumi: read the open Borumi project without changing it: the scenes table with layers per edit span, one scene's segments and transcript blocks, the transcript for a range, or saved frames and a contact sheet to look at. Triggers: /borumi:inspect, show me the scenes, what is on the timeline, what do I say in scene 3, show the transcript, look at 1:02-1:14, what layers are active, where is the playhead."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_ui_state mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:inspect

Read-only. No transaction, nothing written to the project. Raw responses go to `<dirname(project.path)>/<project name> Agent/receipts/inspect-<stamp>/` so the next command (cut, visualize, chapters) can reuse them.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:inspect                                   the scenes table
/borumi:inspect scene 3                           one scene: edit spans, segments per layer, transcript, contact sheet
/borumi:inspect transcript [scene 3 | 1:02-4:20]  transcript blocks as [m:ss] text
/borumi:inspect frames 1:02-1:14 [--n 6] [--quality low|medium|high|max] [--layer screen_1]
/borumi:inspect layers 1:02-1:14                  segments per layer for a range
/borumi:inspect silences scene 3                  detected silences (no cutting)
/borumi:inspect ui                                what Borumi shows: project, tool, playhead, selection
```

## Guides to fetch first

`get_guides` with no arguments once per session, then `editing` (timeline and inspect reads) and `editing_transcripts` (transcript reads); `ui_navigation` for `ui`.

## Procedure

1. Project. `list_open_projects` -> the active project `{id, name, path}` (several open and none active: ask which, stop; none open: say so and suggest `/borumi:open`). `get_project_overview {project_id, slices:["project","scenes","canvas","transcripts"]}` -> `<receipts>/overview.json` (write `index.md` first).
2. Default, the scenes table. `get_scenes {project_id}` -> `<receipts>/scenes.json`; per scene `get_timeline {project_id, range:{start_ms, end_ms}, detail:"summary"}` -> `<receipts>/timeline-scene<position>.json` (a scene longer than 10 minutes: read it in two ranges). Print:
   ```
   Astra launch  12:04  1920x1080 landscape  transcript ready (3 media)
   #  Scene                Start-End      Length  Takes  Layers (per span)
   1  Cold open            0:00-0:41      41s     1      camera+mic | screen_1 | layout
   2  Why this matters     0:41-4:20      3:39    2      camera+mic ; camera+mic | screen_1 | 2 overlays
   3  The build            4:20-12:04     7:44    1      camera+mic | screen_1
   ```
   Layers come from `scenes[].edit_spans[].edit_sets`: list each distinct set once, `;` between spans that differ. Transcript state from the overview (`ready`, `pending N`, `failed N`).
3. `scene N`: `get_timeline {project_id, range:<scene>, detail:"segments", segment_fields:["all"]}` -> `<receipts>/timeline.json`. Print the edit spans (`start-end  sets`) and per layer the segments (`layer  start-end  type  media/text`), then `get_transcript {project_id, range:<scene>, mode:"blocks"}` -> `<receipts>/blocks.json` printed as `[m:ss] text` (over 60 blocks: the first and last 30 plus a count; the file has all of them). Then one look: `inspect_timeline {project_id, range:<scene>, view:{type:"render"}, presentation:"contact_sheet", quality:"low", save:true, include_images:false}` -> Read every `path` in the reply and describe what the scene looks like in two sentences (what fills the frame, where the camera sits, any cards or overlays).
4. `transcript`: `get_transcript` mode `blocks` for the range (project time, at most 10 minutes per read; longer ranges in chunks) printed as `[m:ss] text`. `--words` prints words with their times for a range under 2 minutes.
5. `frames`: `inspect_timeline {project_id, range, view:{type:"render"} or {type:"layer_source", layer_id:"screen_1"} with --layer, presentation:"frames", quality:<--quality, default medium>, sampling:{type:"uniform", max_frames:<--n, default 6, max 255>}, save:true, include_images:false}` -> `<receipts>/inspect.json`; Read each frame; print the frame paths with their times and a one-line description each. One exact moment: `range {start_ms:t, end_ms:t+34}` with `max_frames 1`.
6. `layers`: the segments read of step 3 for the given range, printed per layer.
7. `silences`: `get_timeline` summary for the microphone ids, then `detect_speech {project_id, range, activity:"silence", target:{type:"layers", layer_ids:[<microphone ids>]}}` -> `<receipts>/silences.json`; print the count, total, longest five, and the `/borumi:silences` line that would cut them.
8. `ui`: `get_ui_state` (after `ui_navigation`). `active_project` null: say which projects are open and that none is focused. Otherwise print the screen, project, tool, playhead (`m:ss`) and selection; if a range is selected, print it in both frames (scene-relative and project).
9. Report ends with the receipts folder path (the one path that is allowed here, since the next command reads from it) and the next action (`/borumi:visualize scene 3`, `/borumi:cut ...`).

## Rules

- Cheap reads first: summary before segments, blocks before words, a low contact sheet before frames. Never pull more than the target scene plus its two neighbours into the chat; bigger reads go to the receipts folder through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call ... > <file>` and only the needed lines come back.
- Durations as `41s` / `3:39`; positions as `m:ss`; the resolved-range line in both frames for scene-relative input.
- Ids are session aliases; never print them for the user. Layer ids (`screen_1`, `media_overlay_1`) are fine to print.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`; frames and sheets are viewed with the Read tool.
- Codex or any host without the plugin MCP: `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once); view saved frames with the host's image viewer.
