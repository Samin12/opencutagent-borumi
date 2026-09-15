---
name: borumi-editing
description: "Borumi: the shared editing base that every /borumi command loads first. Tool map for Borumi's MCP, guide gating, transaction discipline (preview, then commit), time parsing, edit sets, receipts and output rules. Not a command on its own; visualize, cut, silences, retakes, insert, chapters, captions, inspect, export, open and setup all read it before touching a project."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__list_recent_projects mcp__plugin_borumi_borumi__get_ui_state mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__get_media_transcript mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__abort_project_edit mcp__plugin_borumi_borumi__import_media mcp__plugin_borumi_borumi__get_media_import_status mcp__plugin_borumi_borumi__cancel_media_import mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__update_segments mcp__plugin_borumi_borumi__split_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__move_timeline_segments mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__untrim_segments mcp__plugin_borumi_borumi__export_video mcp__plugin_borumi_borumi__get_export_status mcp__plugin_borumi_borumi__cancel_export
user-invocable: false
---

# Borumi editing base

Every `/borumi:*` skill starts with: "Load `borumi-editing` (read `$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md`) if not already loaded this session." This file is that base. It holds the rules that keep a real Borumi project safe while an agent edits it through Borumi's own MCP server.

Borumi (macOS recorder and editor, 0.30.5 or newer) records camera, microphone, screen and system sound as separate layers inside Scenes. Its MCP server exposes 45 tools. Every fact used here was verified live; the exact JSON shapes are in `references/borumi-mcp-cookbook.md`.

## Naming

- Tool names below are Borumi's own (`get_timeline`, `trim_timeline`). Each host exposes them under its own prefix; the Host notes at the end say how (in Claude Code they are the plugin's MCP tools).
- `$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file); resolve it once per session (Host notes). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs ...` and `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py ...`. They print JSON to stdout and logs to stderr.
- Deliverables live next to the project bundle: `<dirname(project.path)>/<project name> Agent/` with `animations/<jobId>/`, `exports/`, `chapters/`, `receipts/`. Nothing the user will look at goes to a temp directory.

## Preconditions (check before the first edit of a session)

1. Borumi is open with the project loaded, and Settings > AI > Enable MCP is on. With the app closed, only `get_guides` and tool listing work; every project tool returns `app_not_running`.
2. `get_guides` with no arguments once per session (it returns the basics guide and unlocks the rest).
3. `list_open_projects` -> `{active_project_id, projects:[{id, is_active, name, path}]}`. Use the active project. Several open and none active: ask which one (one question, then stop).
4. Read the project map before acting: `get_project_overview` (slices `project`, `scenes`, `canvas`, `transcripts`), then `get_scenes` for scene bounds, names and Scripts.

## Tool map

| Group | Tools |
|---|---|
| Read (project_id or tx_id) | `get_project_overview`, `get_scenes`, `get_timeline`, `get_transcript`, `get_media_transcript`, `detect_speech`, `inspect_timeline` |
| Guides | `get_guides` (no args once per session, then one id per call) |
| App and projects | `list_open_projects`, `list_recent_projects`, `get_ui_state`, `focus_project`, `set_active_project_tool`, `create_project`, `open_project`, `duplicate_project`, `rename_project` |
| Transactions | `begin_project_edit`, `commit_project_edit`, `abort_project_edit` |
| Structural edits (tx only, hash-guarded) | `import_media` (+ `get_media_import_status`, `cancel_media_import`), `add_segments`, `split_segments`, `delete_segments`, `move_timeline_segments`, `trim_timeline`, `untrim_segments`, `copy_segments` (+ `get_copy_status`), `create_scenes`, `move_scenes`, `delete_scenes`, `copy_scenes`, `update_canvas` |
| Property edits (tx, hash stays valid) | `update_segments`, `update_scenes`, `correct_media_transcript` |
| Transcription | `request_transcriptions` (project_id, outside a transaction) |
| Export | `export_video`, `export_audio`, `export_transcript`, `get_export_status`, `cancel_export` |

## Guide gating

Guides gate tools per MCP connection. Fetch one guide id per `get_guides` call, before the first use of the tool it gates. On a `guide_required` error, fetch the named guide and retry once.

| Before calling | Fetch |
|---|---|
| any project change | `project_edits` |
| any timeline edit | `editing` |
| `add_segments` of type X | `editing_segment_X_add` (take, media_overlay, text_overlay, layout, captions, screen_zoom, camera_zoom, screen_highlight, screen_blur, music, sound_effect, cursor) |
| `update_segments` of type X | `editing_segment_X_update` (audio, video, overlay, media_overlay, text_overlay, layout, captions, screen_zoom, camera_zoom, screen_highlight, screen_blur, music, sound_effect, cursor). There is no take update: a take becomes `video` and `audio` segments. |
| a layout add or update | `editing_layouts` as well |
| transitions on layouts, video clips, overlays, highlights | `editing_transitions` |
| `import_media` | `importing_media` |
| `trim_timeline`, `untrim_segments` | `editing_trimming`; add `editing_synchronization` when narration and screen sit in separate edit sets |
| transcript reads for editing, `request_transcriptions`, `correct_media_transcript` | `editing_transcripts` |
| `export_video`, `export_audio`, `export_transcript` | `exporting` |
| `get_ui_state`, `open_project`, `focus_project`, `set_active_project_tool` | `ui_navigation` |
| `create_scenes`, `update_scenes`, `move_scenes`, `delete_scenes` | `scripting` |
| `update_canvas` | `editing_canvas` |
| styling a text overlay or captions | `editing_segment_text_overlay_templates`, `editing_segment_captions_templates` |
| cursor and sound effect segments | `editing_cursors`, `editing_sound_effects` |

## Ids and hashes

- Every 4-hex id Borumi returns (project, tx, scene, segment, media, take, clip) is an alias valid only on the MCP connection that received it. Another connection gets `unknown_id_alias`. So: a transaction begins, runs and commits on one connection; never hand a `tx_id` between the session and `borumi_mcp.py`; ids stored in receipts or job records from an earlier session are stale. Re-list (`list_open_projects`, `get_scenes`, `get_timeline`) and match structurally (scene position or name, layer id, `start_ms`/`end_ms`, media name or duration) before acting on anything remembered.
- Layer ids (`camera_1`, `screen_2`, `layout`, `media_overlay_1`) are structural names, not aliases.
- `timeline_hash`: every structural call needs the latest one. Re-read (`get_timeline` for the affected range, or `get_project_overview` on an empty project) after every structural call before the next hash-guarded call. `update_segments` and `update_scenes` do not change the hash.
- Never invent an id or a timestamp. Use the values the tools returned.

## Transactions and the approval gate

1. `begin_project_edit {project_id}` -> `{tx_id, base_commit_id}`. Inside the transaction use `tx_id` for every read and write; never mix in `project_id`.
2. Stage the edit with hash re-reads after every structural call.
3. Verify the staged result: re-read the timeline, and `inspect_timeline` where visuals matter.
4. `commit_project_edit {tx_id, change_summary}` with one concrete sentence that covers the whole transaction ("Place animation v2 behind the camera in Scene 3 from 0:41 to 0:49."). Never generic text.
5. Anything wrong, unverifiable, or a "no" from the user: `abort_project_edit`. A commit conflict closes the transaction too; begin a new one instead of reusing the id. A transaction from a dropped connection is invisible to a new connection; begin fresh.

Keep transactions small: one task, one commit. Coupled changes that would leave the project inconsistent if split stay together (an animation take plus its layout).

The approval gate: `commit_project_edit` is deliberately absent from every allowlist, so Claude Code's permission prompt, which carries the `change_summary`, is where the user approves a placement. Commands that remove or move footage (cut, silences, retakes, insert behind, chapters re-timing) additionally show a plain-English preview with exact times and wait for a yes before `begin_project_edit`. There is no undo through the MCP after a commit; say so once per session, and rely on the preview plus small transactions.

`import_media` copies the file into the bundle; abort removes media imported in that transaction, commit keeps it. The MCP cannot delete media afterwards.

## Time parsing and range semantics

- Accepted forms: `1:23`, `1:23.5`, `01:02:03`, `83`, `83s`, `1m23s`, `1500ms`. `scripts/lib/fmt.mjs parseTimeMs` is the reference parser.
- A bare time or range (`1:02-1:14`, `1m23s`) is project time. Times inside "scene N from A to B" or "scene N +5s" are scene-relative: add the scene's `start_ms`.
- Always print the resolved range in both frames: `Scene 3 0:05-0:12 (project 1:46-1:53, 7.0 s, 24 words)`.
- "the part where I say ..." matches at word level (`get_transcript` mode `words` for the scene), snaps to the enclosing block boundaries (mode `blocks`), prints the matched words, and asks to widen or narrow only when the match is ambiguous.
- Everything sent to Borumi is integer project milliseconds. Ranges are `[start_ms, end_ms]` with `end_ms > start_ms`.
- An empty project has `duration_ms 0`; `get_timeline` refuses every range on it. Take the hash from `get_project_overview`.

## Reading the project (cheap first)

1. `get_timeline` with `detail: "summary"` for structure, then `detail: "segments"` with `segment_fields: ["all"]` only for the range being edited. Per layer it returns `{id, kind, category, segment_count, segments:[{id, type, start_ms, end_ms, group_id, scene_id, media, properties}]}` plus `scenes[].edit_spans[].edit_sets`.
2. `get_transcript` mode `blocks` for review, `words` for exact boundaries. Item times are project ms. Long projects: work scene by scene, ranges of at most 10 minutes.
3. `detect_speech` with `activity: "silence"` targeted at the microphone layer ids read from the timeline.
4. `inspect_timeline`: a low-quality `contact_sheet` first, `frames` for one moment. One exact moment = `range {start_ms: t, end_ms: t+34}` with `sampling {type: "uniform", max_frames: 1}`.
5. Context discipline: never pull more than the target scene plus its two neighbours into the session. Whole-project transcript reads go through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call get_transcript '<json>' > <receipts>/file.json` and only the needed lines are read back (see Receipts).

## Edit sets and trims

`scenes[].edit_spans[].edit_sets` says what moves together: camera and microphone share a set, each `screen_N` is its own, overlays ripple as one group, `layout` follows the screen layer. Rules:

- Every trim is targeted (`target {type: "layers", layer_ids: [...]}`). An untargeted trim over independent sets is refused.
- Apply all confirmed ranges in one `trim_timeline` call per edit set; Borumi applies them in original coordinates. Never shift ranges yourself.
- Order: narration set first, then each `screen_N` active in the range, then one overlay layer when overlays exist. Trim `layout` only if a layout still sits at its old position after the screen trims.
- Re-read after each call and compare every layer's segments with the expected positions (`t - removedBefore(t)`, `scripts/lib/intervals.mjs`). Any mismatch: abort and report which layer disagreed. No partial commits.
- Never apply narration-derived ranges to an independent screen layer.
- Edge safety for narration cuts: snap each edge into the nearest detected silence gap within 400 ms, else pad 250 ms before the first kept word and 300 ms after the last.
- Behind-mode animations never delete recorded footage: a screen take over occupied `screen_1` lands on `screen_2`.

## Receipts and big reads

- Receipts folder: `<dirname(project.path)>/<project name> Agent/receipts/<command>-<stamp>/`. Create it with the Write tool (write `index.md` describing the run; Write creates the folders). Save the raw JSON of every read that a command depends on (`timeline.json`, `words.json`, `blocks.json`, `silences.json`, `inspect.json`) when the command spans several calls.
- Big reads: start the daemon once (`python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py start` in the background, wait for `~/.borumi-agent/sess/ready`), then `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>' > <file>`. It handles `guide_required` itself. Ids in those files belong to the daemon's connection: use only times, text and layer ids from them.
- `scripts/lib/paths.mjs` refuses to create deliverable folders when the `.bmprojbundle` does not exist or its volume is not mounted ("mount the drive first"). Report that message as is.

## Output rules

- Editor audience. Say what changed in the video, not which tools ran.
- Durations in `fmtDur` style (`8.4s`, `1:25`); wall clock in `fmtElapsed` style (`3m 12s`); positions as `m:ss`.
- No paths except renders, frames and exports. Commit ids go to receipts or job records, not the chat.
- No em dashes anywhere (use a comma, colon or period). Plain, direct sentences.
- One open question at a time: ask it and stop. End every response with the next action, a forward question, or nothing.
- Never report a failed render, tool error or unverified placement as success.

## Recovery

`references/recovery.md` maps every error seen to its action. The five to know by heart: `app_not_running` (open Borumi, retry), `guide_required` (fetch the named guide, retry once), `timeline_layer_not_found` (a layer vanished with its last segment; re-read without a layer filter), `unknown_id_alias` (re-list, match structurally), stale hash (re-read, retry once; twice means someone else is editing, abort).

## Host notes

- Claude Code (the plugin): Borumi tools are `mcp__plugin_borumi_borumi__<tool>` and the plugin root is `${CLAUDE_PLUGIN_ROOT}`; treat `$BORUMI_PLUGIN_ROOT` above and in every other skill as that same folder.
- Codex and other Agent Skills hosts (installed by `scripts/install-codex.sh`): `BORUMI_PLUGIN_ROOT` is `root` in `~/.borumi-agent/config.json` (the clone, usually `~/.codex/skills/borumi`); scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Borumi tools are called either through the `borumi` MCP server registered by `install-codex.sh --mcp` or through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` after `borumi_mcp.py start`. Ids stay valid only on that one connection; a transaction begins and commits on the same one.
- Without a permission prompt on `commit_project_edit` (Codex), the skill itself asks "Commit: <change_summary>?" and waits for a yes before committing.

## References

- `references/borumi-mcp-cookbook.md`: every verified behaviour with exact JSON.
- `references/segment-schemas.md`: the exact add and update input types per segment type, plus the text overlay and captions templates.
- `references/treatment.md`: Samin's look (pinned camera, chapter card, text rules).
- `references/recovery.md`: error to action table.
