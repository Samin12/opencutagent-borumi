---
name: chapters
description: "Borumi: add chapter title cards to the open Borumi project in Samin's Astra card style and write the YouTube chapters file (youtube-chapters.txt) next to the project; re-runnable, it replaces the cards it placed before. Triggers: /borumi:chapters, add chapters, chapter cards, make a YouTube chapters list, title cards for each scene, retime the chapters, remove the chapter cards."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:chapters

Two deliverables from one list of chapters: a `text_overlay` card at each chapter start (the Astra look: DM Sans bold 62, dark navy card bottom-left, fade in, instant out, 3.2 s or 4 s for long titles) and `youtube-chapters.txt` for the video description (first line `00:00`). The list lives in `<project name> Agent/chapters/chapters.json`; every run rebuilds both from it and removes the cards the previous run placed, so re-timing after a cut is one command.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:chapters auto                                   one chapter per scene; titles proposed, confirmed once
/borumi:chapters "0:00 Intro; 1:07 Why this matters; 4:20 The build"
/borumi:chapters /path/chapters.json                    re-run from a file (the default file after a cut)
/borumi:chapters auto --no-cards                        only the YouTube file
/borumi:chapters auto --card-seconds 3.2 --style astra|label|bold --card-first
/borumi:chapters remove                                 delete the cards placed earlier, keep the file
```

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `editing_segment_text_overlay_add`, `editing_transitions`; `editing_segment_text_overlay_templates` for `--style label|bold`.

## Procedure

1. Project. `list_open_projects` -> the active project (several open and none active: ask, stop). `get_project_overview {project_id, slices:["project","scenes"]}` -> `duration_ms`. `get_scenes {project_id}` -> positions, names, bounds. Chapters folder: `<dirname(project.path)>/<project name> Agent/chapters/` (create it through the mount guard: `node --input-type=module -e "import { ensureAgentDir } from '$BORUMI_PLUGIN_ROOT/scripts/lib/paths.mjs'; console.log(ensureAgentDir(process.argv[1], process.argv[2], ['chapters']))" "<project.path>" "<project name>"`; a "mount the drive first" error stops the command).
2. The chapter list:
   - `auto`: one chapter per scene at `start_ms`. Title = the scene's `name` when it is set (not a generated display name); otherwise the first sentence of the scene's first transcript block (`get_transcript {project_id, range:{start_ms:<scene start>, end_ms:<scene start + 20000>}, mode:"blocks"}`), shortened to at most 32 characters on a word boundary. Print the proposed list and ask once, `Use these titles (tell me any to change)?`, then stop. Apply the edits and continue.
   - an inline list: parse `m:ss Title` pairs split on `;` or newlines (project time).
   - a file: read it as is (`{"chapters":[{"start_ms","title"}], ...}` or `m:ss Title` lines; a bare array also works).
   - `remove`: skip to step 6 with an empty list.
   Write `<chapters>/chapters.json` = `{"project":"<name>","project_path":"<path>","generated_at":"<iso>","card_seconds":3.2,"style":"astra","chapters":[{"start_ms":0,"title":"Intro","scene_id":"eeaa"}, ...],"placed":[<from the previous file, if any>]}`.
3. Build: `node $BORUMI_PLUGIN_ROOT/scripts/chapters.mjs build --chapters <chapters>/chapters.json --out-dir <chapters> --card-seconds 3.2 --style astra [--card-first] --duration-ms <duration_ms>` -> writes `youtube-chapters.txt` and `text_overlays.json` (`{style, additions:[{type:"text_overlay", placement:{range}, properties:{...ASTRA_CARD, text:"02  Why this matters"}}], cards:[...]}`), prints `{files, chapters, cards, warnings}`. Read the warnings (a card shortened to end before the next chapter, a missing 00:00 chapter added as "Intro"). `--style bold`: replace each addition's properties with the Bold template from the templates guide (sizing `hug`, alignment `center`, `x_ratio 0.5`, `y_ratio 0.78`, keep the `text`, entrance fade, exit instant) with the Edit tool. `--no-cards`: stop after this step and report the file.
4. Preview, then STOP and wait for a yes:
   ```
   6 chapters -> youtube-chapters.txt; 5 cards (3.2 s, 4 s for the two long titles), the 00:00 chapter has no card.
   02  Why this matters   1:07   3.2s
   03  The recorder       4:20   3.2s
   ...
   Replaces the 5 cards placed on 2026-09-14.
   ```
5. Old cards (re-run): for every entry in `placed[]`, `get_timeline {tx_id, range:{start_ms:<card start - 100>, end_ms:<card end + 100>}, detail:"segments", segment_fields:["all"]}` and match a `text_overlay` segment whose `properties.text` equals the recorded text and whose `start_ms` is within 50 ms of the recorded start (ids from an earlier session are aliases; match structurally). Collect the ids; a card that is not there any more is reported and skipped.
6. Transaction:
   1. `begin_project_edit {project_id}` -> `tx_id`; run step 5 with `tx_id` (fresh hash from the last read).
   2. `delete_segments {tx_id, timeline_hash, segment_ids:[<old card ids>], expand_groups:false, ripple:false}` when any; re-read one card range for the new hash.
   3. `add_segments {tx_id, timeline_hash, additions:<text_overlays.json additions>}` in one call. Re-read each card's range: exactly one `text_overlay` with that text at that range.
   4. Look: for up to six cards, `inspect_timeline {tx_id, range:{start_ms:<card start + 700>, end_ms:<card start + 734>}, view:{type:"render"}, presentation:"frames", quality:"medium", sampling:{type:"uniform", max_frames:1}, save:true, include_images:false}` and Read the frames: the card sits bottom-left, the text fits on one or two lines, nothing under the camera window. A title that wraps badly: shorten it (Edit `chapters.json`, rebuild) before committing.
   5. `commit_project_edit {tx_id, change_summary:"Add 5 chapter cards (02 to 06) and replace the 5 cards placed earlier."}` (`remove`: "Remove the 5 chapter cards placed earlier."). Declined means abort and stop. Nothing to delete or add: abort instead of committing an empty transaction.
7. After the commit: re-read each card range with `project_id`, then write `placed` into `chapters.json`: `[{"index":2,"start_ms":67000,"end_ms":70200,"text":"02  Why this matters","segment_id":"<id>","placed_at":"<iso>"}]`. Print the chapters text block for the description.
8. Report: `5 chapter cards placed (02 to 06). youtube-chapters.txt: <path>` plus the frame paths and the chapters text. End with the next action.

## Rules

- Titles under 32 characters; two-digit number, two spaces, title (`02  Why this matters`). Never invent chapter times; they come from scene bounds, the user, or the file.
- Cards never overlap the next chapter start; the builder shortens them and says so.
- The card style JSON is `scripts/chapters.mjs ASTRA_CARD` (the verified Astra look, also in the base skill's `references/treatment.md`). Do not restyle by hand unless asked.
- After a `/borumi:cut`, `/borumi:silences` or `/borumi:retakes`, those commands run `chapters.mjs shift` and call this skill with the file; the cards are re-placed at the new times whether or not they moved with the overlays.

## Failure handling

Every error goes to `<chapters>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`. `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate.
- Codex or any host without the plugin MCP: run the same calls through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once), and ask for a yes in chat before `commit_project_edit`.
