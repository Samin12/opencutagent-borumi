---
name: captions
description: "Borumi: add speech-synced captions to a scene or the whole open Borumi project with one of Borumi's caption templates (boxed, highlight, accent, impact, card, outline), after making sure the transcript is ready. Triggers: /borumi:captions, add captions, add subtitles to scene 3, caption the whole video, burn in captions, word highlight captions."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__update_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:captions

Captions in Borumi are one `captions` segment over a range; Borumi times the words from its own transcript. The command checks that the transcript is ready, copies a template's fields into the segment, places it, looks at one frame, then commits. Nothing changes before the preview gets a yes and the commit prompt is accepted.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:captions                              the whole project
/borumi:captions scene 3
/borumi:captions scene 3 --template highlight
/borumi:captions all --template boxed --position top
/borumi:captions scene 3 --replace             replace captions already covering the range
```

Templates (Borumi's built-ins, fields in `editing_segment_captions_templates` and the base skill's `references/segment-schemas.md`): `boxed` (default: DM Sans on a translucent box, dimmed upcoming words), `highlight` (bold, active word on a blue box), `accent` (bold uppercase, active word yellow), `impact` (single word, 120 px, black outline), `card` (uppercase on a white card, blue accent), `outline` (white with a black outline). `--position bottom|top|center` (default: the template's own, which is bottom).

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `editing_transcripts`, `editing_segment_captions_add`, `editing_segment_captions_templates`; `editing_segment_captions_update` only when restyling existing captions.

## Procedure

1. Project and range. `list_open_projects` -> the active project (several open and none active: ask, stop). `get_project_overview {project_id, slices:["project","scenes","transcripts"]}`; `get_scenes {project_id}`. Range `[A, B]` = the scene, or `[0, duration_ms]`. Receipts: `<dirname(project.path)>/<project name> Agent/receipts/captions-<stamp>/` (write `index.md` first).
2. Transcript readiness: `transcripts.pending_media_count == 0` and `ready_media_count >= 1`. Not ready or missing: `request_transcriptions {project_id}` once, wait `poll_after_ms` (`python3 -c "import time; time.sleep(3)"`), poll `get_project_overview {project_id, slices:["transcripts"]}` until `pending_media_count == 0`; `failed_media_count > 0` or `unavailable_media_count > 0` afterwards is reported once and stops the command (captions need words). Say how long it took.
3. Existing captions: `get_timeline {project_id, range:{start_ms:A, end_ms:B}, detail:"segments", segment_fields:["all"], layers:["captions"]}` (on `timeline_layer_not_found` read without the filter). Any `captions` segment overlapping the range: with `--replace` they will be deleted; without it, ask `Replace the captions already on 0:00-4:20, or stop?` (one question, stop).
4. Properties: copy the chosen template's fields verbatim from the templates guide into `properties` (every field, including the `null` ones; they clear conflicting styling). Apply `--position` by setting `position` to `"top"`, `"bottom"` or `"center"`. Never send empty `properties`. A word-level check of what the captions will say: `get_transcript {project_id, range:{start_ms:A, end_ms:min(B, A+20000)}, mode:"blocks"}` and print the first three blocks so the user sees the transcript quality (mis-heard names are fixed in Borumi's transcript editor, not here).
5. Preview, then STOP and wait for a yes:
   ```
   Add boxed captions to Scene 3 (0:00-4:20, 58 blocks). Position: bottom. Replaces 1 existing captions segment.
   First words: "In this scene, I am going to show you the three pieces of the pipeline."
   ```
6. Transaction:
   1. `begin_project_edit {project_id}` -> `tx_id`; re-read the range with `tx_id` for the fresh hash. Confirm readiness again against the transaction (`get_project_overview {tx_id, slices:["transcripts"]}`); pending means abort, wait, begin again.
   2. Replace: `delete_segments {tx_id, timeline_hash, segment_ids:[<overlapping captions ids from the tx read>], expand_groups:false, ripple:false}`; re-read.
   3. `add_segments {tx_id, timeline_hash, additions:[{"type":"captions","placement":{"range":[A,B]},"properties":{<template fields>, "position": "<bottom|top|center or omitted>"}}]}`. Re-read: exactly one `captions` segment covers `[A, B]`.
   4. Look: pick the middle of a spoken block (`t` = its midpoint), `inspect_timeline {tx_id, range:{start_ms:t, end_ms:t+34}, view:{type:"render"}, presentation:"frames", quality:"medium", sampling:{type:"uniform", max_frames:1}, save:true, include_images:false}` and Read the JPG: words visible, readable size, not covering the camera window (bottom captions sit centered; the camera is bottom-right, so long single-word `impact` captions can reach it: switch to `--position top` and say so).
   5. `commit_project_edit {tx_id, change_summary:"Add boxed captions to Scene 3 from 0:00 to 4:20."}`. Declined means abort and stop.
7. Verify after the commit: `get_timeline {project_id, range:{start_ms:A, end_ms:B}, detail:"summary"}` shows `captions` active across the range.
8. Report: `Boxed captions added to Scene 3 (0:00-4:20).` plus the frame path. Restyling later is one `update_segments` of type `captions` with the new template's fields (fetch `editing_segment_captions_update` first). End with the next action.

## Failure handling

Every error goes to `<receipts>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`. `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate.
- Codex or any host without the plugin MCP: run the same calls through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once), and ask for a yes in chat before `commit_project_edit`.
