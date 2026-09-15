---
name: visualize
description: "Borumi: design a Remotion animation for a stretch of narration in the open Borumi project, render it, and place it behind the camera (pinned bottom-right) or in front as a transparent overlay, then iterate in chat. Triggers: /borumi:visualize, visualize scene 3, animate this part, illustrate the bit where I explain X, make an animation for 1:02-1:14, put an overlay on top of this, make the arrows pink, slower, render again, place v2, remove the animation, put it in front instead."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__list_recent_projects mcp__plugin_borumi_borumi__get_ui_state mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__get_media_transcript mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__abort_project_edit mcp__plugin_borumi_borumi__import_media mcp__plugin_borumi_borumi__get_media_import_status mcp__plugin_borumi_borumi__cancel_media_import mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__update_segments mcp__plugin_borumi_borumi__split_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__move_timeline_segments mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__untrim_segments mcp__plugin_borumi_borumi__export_video mcp__plugin_borumi_borumi__get_export_status mcp__plugin_borumi_borumi__cancel_export
disable-model-invocation: true
---

Load `borumi-editing` first: read `$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md` (Host notes say how your host resolves `$BORUMI_PLUGIN_ROOT`) if it is not already loaded this session. Everything below assumes its rules (guide gating, alias-scoped ids, hash re-reads, one open question at a time, output rules).

# /borumi:visualize

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file); scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names below are Borumi's own; the base skill and the Host notes say how the host exposes them. The kit workspace is `~/.borumi-agent/animation-kit` (`BORUMI_AGENT_HOME` overrides). `commit_project_edit` is the approval gate: its permission prompt carries the change summary. Do not ask "shall I place it?" before v1; the commit prompt is that question.

## Syntax

```
/borumi:visualize scene 3
/borumi:visualize 1:02-1:14                         project time
/borumi:visualize scene 3 from 0:05 to 0:12         scene-relative
/borumi:visualize "the part where I explain the three Cs"
/borumi:visualize                                   selection or playhead scene (get_ui_state)
/borumi:visualize at 1:23 for 6s "a stopwatch counting down"   raw job, no narration
flags: --style excalidraw|n8n|leo  --mode behind|front  --frames  --size seq|4k|1440p|1080p|720p|WxH [--vertical]  --ref <image>...  --delegate  --place
follow-ups on the current job: say "..." | render | again | list | show | remove | replace | discard [jobId] | "in front instead" | "behind instead"
```

Defaults: style = the style of this project's most recent job (`job.mjs list --project-path P`), else `excalidraw`. Mode = `behind` (solid background) unless `--frames`, `--mode front`, or the user says overlay, on top, in front (then `front`, transparent). Size = the project canvas (`get_project_overview` slice `canvas`); `4k` 3840x2160, `1440p` 2560x1440, `1080p` 1920x1080, `720p` 1280x720, `--vertical` swaps. fps is always 30. `--frames` with behind mode is an argument error.

## Procedure for a new job

### 1. Preflight
- `node $BORUMI_PLUGIN_ROOT/scripts/kit.mjs ensure --quiet --detach` -> `{state:"done", ...}` when nothing needs installing, else `{state:"running", statusPath}`. While running, loop `node $BORUMI_PLUGIN_ROOT/scripts/kit.mjs wait --timeout 540` until `state` is `done` (`failed` stops with the error; `timedOut: true` is not a failure, call again). The first run installs Remotion and the headless browser; say so once.
- `get_guides` (no args), then one per call: `project_edits`, `editing`, `importing_media`, `editing_layouts`, `editing_transitions`, `editing_segment_take_add`, `editing_segment_video_update`, `editing_segment_layout_add`; front mode adds `editing_segment_media_overlay_add`; bare invocation adds `ui_navigation`.
- `list_open_projects` -> the active project `{id, name, path}`. Several open, none active: ask which and stop.

### 2. Resolve the target
- `get_scenes {project_id}` -> scenes with `position`, `name`, `start_ms`, `end_ms`, `script_markdown`. Save the reply as `scenes.json` (receipts, step 3).
- `scene N` = that scene's full range. `A-B` bare = project time. `scene N from A to B` or `scene N +5s` = scene-relative. `at T for Ds "..."` = raw job at project time T (or scene N start) for D seconds with no narration.
- A phrase: `get_transcript` mode `words` and mode `blocks` for the scene (or the project in <= 10 min chunks), saved to receipts, then `node $BORUMI_PLUGIN_ROOT/scripts/segments.mjs find --words <words.json> --blocks <blocks.json> --phrase "<text>" [--start-ms A --end-ms B]` -> `{matches:[{start_ms, end_ms, text, range}], best, ambiguous}`. Use `matches[best].range` (snapped to the enclosing block boundaries). Print the matched words; ask to widen or narrow only when `ambiguous` is true (one question, stop).
- Bare: `get_ui_state`. `active_project` null: list the open projects and stop. Use the selection when present, else the scene under the playhead. An auto-resolved range longer than 45 s is printed for confirmation before anything is created (one question, stop).
- A range that crosses a scene boundary is refused (create checks it too): offer one job per scene.
- Print the resolved line: `Scene 3 0:05-0:12 (project 1:46-1:53, 7.0 s, 24 words)`.

### 3. Gather inputs (receipts folder: `<dirname(project.path)>/<project name> Agent/receipts/visualize-<stamp>/`, created with the Write tool)
- `get_project_overview {project_id, slices:["canvas"]}` -> `canvas.json` (`canvas.format.width_px`, `height_px`, `preset`).
- `get_transcript` mode `words` for the range -> `words.json` (Borumi's exact shape). Mode `blocks` for the target scene and its two neighbours only -> `blocks.json`. Nothing more of the transcript enters the session.
- The target scene's `script_markdown` -> `script.md` (`references/script-markers.md`; reference images named there are passed as `--ref`).
- `get_timeline {project_id, range, detail:"segments", segment_fields:["all"]}` -> `timeline.json`: layers present, screen segments, layouts, control segments, `edit_spans`.
- A raw job skips the transcript reads.

### 4. Create the job
```
node $BORUMI_PLUGIN_ROOT/scripts/job.mjs create --project-path "<path>" --project-name "<name>" --scene-id <id> --scene-name "Scene 3" --scenes <receipts>/scenes.json \
  --start-ms A --end-ms B --width W --height H --canvas-format <preset> --style <style> --mode behind|front \
  --words <receipts>/words.json --context <receipts>/blocks.json [--script-text <receipts>/script.md] [--user-brief "<text>"] [--ref <img>]... [--frames] [--raw --length-ms L]
-> {jobId, kitDir, jobDir, outDir, briefPath, scenePath, wordsCount, durationInFrames, endMsEffective, kitInstalled, title}
```
`behind` = solid background, `front` = transparent (`--background` overrides). `durationInFrames = floor((B - A) / (1000/30))`; the effective end `endMsEffective = A + durationInFrames * 1000/30` (rounded down) is the range every later placement uses, so the render never overshoots the narration. Create writes the brief, the scaffold, the current-job pointer (`~/.borumi-agent/current.json`) and `<outDir>/job.json`. Log the receipts path: `job.mjs log <jobId> --kind note --text "receipts: <folder>"`.

### 5. Frames (`--frames`, front mode only)
`inspect_timeline {project_id, range:{start_ms:A, end_ms:endMsEffective}, view:{type:"render"}, presentation:"frames", quality:"high", sampling:{type:"uniform", max_frames: min(255, ceil(dur_s/0.5))}, save:true, include_images:false}` -> write the JSON to `<receipts>/inspect.json`, then `node $BORUMI_PLUGIN_ROOT/scripts/frames.mjs from-borumi <jobId> <receipts>/inspect.json --job <outDir>/job.json`. It builds `public/frames/<jobId>/full/tNNNN.NN.png`, the contact sheets and `frames-map.json` v2 (`source:"borumi"`, plus a `keepOut` rect when the camera is pinned). Anchors inside `keepOut` fail the anchor check.

### 6. Design
Read, in this order: `<briefPath>`, `<kitDir>/GUIDE.md`, `<kitDir>/styles/<style>/SKILL.md`, and `<kitDir>/frames/SKILL.md` when frames exist. The distilled rules are in `references/design-rules.md`; the style guide wins on look. Then:
1. Write `<scenePath>` (`src/jobs/<jobId>/Scene.tsx`). Only that folder is yours, plus the style's Learnings log for a reusable correction.
2. `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs typecheck` until `ok`.
3. `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs still <jobId> --frame N` at two or three meaningful frames (mid-draw, composed, near the end) and LOOK at each PNG with the Read tool. Fix what is wrong before going on.
4. Frames job: write `anchors.json`, run `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs anchors <jobId>`; `status: "fail"` blocks the render.
5. Write `src/jobs/<jobId>/render.json` `{"version": 1, "notes": "...", "title": "<2 to 3 words, max 20 chars>"}`.
`--delegate`: hand steps 1 to 5 to the `animator` agent (plugin agent, file tools only) with the job id, kit dir and brief path; when it returns, re-run steps 2 and 3 yourself before rendering. Design in-session otherwise.

### 7. Render (detached; the Bash tool kills anything past 600 s)
- `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs render <jobId>` -> `{state:"running", statusPath, version}` (refused when the version was already rendered; `--force` re-renders).
- Loop `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs wait <jobId> --timeout 540` until `state` is `done` or `failed`. A reply with `timedOut: true` is not a failure: call it again.
- `done` -> `path` (`<outDir>/<jobId>-v<N>.mp4` for behind, `.mov` ProRes 4444 with alpha for front), `durationSec`, `codec`. `failed` -> the error is already in the job log; report `error` (and `logPath`), retry once with `--force` only for transient errors (see recovery).

### 8. Place (one transaction; the routine and the executor rules are in `references/placement.md`)
1. `begin_project_edit {project_id}` -> `tx_id`. `get_timeline {tx_id, range:{start_ms:A, end_ms:endMsEffective}, detail:"segments", segment_fields:["all"]}` -> save as `<receipts>/timeline-tx.json` (fresh hash, current screen layers, layouts, controls).
2. `import_media {tx_id, file_path: <render path>}` -> `media.id`; poll `get_media_import_status` only when the status is not `completed`.
3. `node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs plan --timeline <receipts>/timeline-tx.json --job <outDir>/job.json --media-id <id> --canvas <receipts>/canvas.json --action place --out <receipts>/plan.json` -> `{steps, warnings, expect}`. Read the warnings. Execute the steps in order: `op` is the Borumi tool, `args` the arguments minus `tx_id` and `timeline_hash` (add the current ones); after a step with `reread: true`, re-read the range and use the new hash. `find_new_segment` binds `$NEW_LAYER` and `$NEW_SEGMENT` from the re-read (the segment with `media.media_id` equal to the imported id at `start_ms`); a delete with `select` replaces `$SELECT` by the split pieces inside the range; `tolerate_missing` deletes ignore a missing id; `verify` is step 4. Behind mode never deletes recorded content; a take over occupied `screen_1` lands on `screen_2` and the layout's full-frame source is that layer.
4. After the last tool step, re-read to `<receipts>/timeline-after.json` and run `node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs verify --timeline <receipts>/timeline-after.json --job <outDir>/job.json --plan <receipts>/plan.json --media-id <id> --out <receipts>/placed.json` -> `{ok, placed, problems}`. Not ok (exit 2): `abort_project_edit`, report the problems. When `expect.replaced_layouts` or `expect.replaced_controls` is non-empty, record them now: `job.mjs replaced <jobId> --json '{"replaced_layouts":[...],"replaced_controls":[...]}'`.
5. Look: `inspect_timeline {tx_id, range:{start_ms:t, end_ms:t+34}, view:{type:"render"}, quality:"medium", sampling:{type:"uniform",max_frames:1}, save:true, include_images:false}` at t = A+50, the midpoint, and endMsEffective-80; Read the three JPGs. The animation must fill the frame with the camera pinned bottom-right (behind) or float over the footage without covering the face (front). Wrong: abort, fix, retry.
6. `commit_project_edit {tx_id, change_summary:"Place animation v1 behind the camera in Scene 3 from 0:41 to 0:49."}` (front: "in front of the footage"). The permission prompt is the approval; a decline means abort and stop.

### 9. Verify, record, report
- `get_timeline {project_id, range:[A, endMsEffective], detail:"segments", segment_fields:["media"]}` after the commit: the placed segment must exist at A.
- `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs placed <jobId> --json '<the verify placed object plus "commit_id">'`. Ids in this record are aliases of this session; a later session re-locates the pieces structurally (`references/placement.md`).
- Copy the three verification JPGs to `<outDir>/frames/v<N>-start.jpg|mid.jpg|end.jpg` (a `cp` in Bash; one prompt) and log `--kind placed`.
- Print: `Animation v1 placed behind the camera in Scene 3 (0:41-0:49) in 3m 12s.` (elapsed from the `created` to the `placed` entry in the job log), the render path and the three frame paths. Nothing else: no tool names, no commit id, no other paths.

## Iteration (the current job)
- The current job is `~/.borumi-agent/current.json[project_path]` (`job.mjs current --project-path P`). While a job is current, a plain follow-up in this session ("make the arrows pink", "slower", "the title should come in later") is a design turn on it; `say "..."` disambiguates. `--ref <image>` adds references (`job.mjs refs <jobId> --add <img>...`).
- A design turn: edit `Scene.tsx`, typecheck, stills, bump `render.json` `version`, render (step 7), then `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs sheet <jobId>` (6-frame contact sheet at `<outDir>/frames/v<N>-sheet.png`), Read it, and print the render path plus the sheet path. Then ask exactly one question, `Place v2 into Borumi?`, and stop. On yes, or when the message carried `--place`: run step 8 with `--action replace` (the plan removes the recorded pieces and re-adds any replaced layouts or controls in the same transaction), verify, commit, record, and print the placed notice. In a session other than the one that placed, refresh the recorded ids first (`references/placement.md`, "Re-locating a placement"). If the plan warns that the recorded segment no longer starts at `placed.start_ms`, the narration moved: re-resolve the range from the first and last word text within the scene, print the new range, then proceed.
- On the first v2 or later placement of a job print once: `Superseded versions stay inside the project bundle until you clean up in Borumi.`
- "in front instead" / "behind instead": remove the current placement (`--action remove`), switch the job (`mode` and `background` in `<outDir>/job.json`, `background` in `<jobDir>/job.json`, and the `Canvas transparent` prop in Scene.tsx, all with the Edit tool), bump the version, re-render, and place with the new mode.

## Subcommands (current job unless a job id is given)
- `render`: re-render the current `render.json` version without a design turn (refused when nothing is pending; `--force` re-renders anyway), then the sheet and the one question.
- `again`: redo the last design instruction as a new version.
- `list`: `job.mjs list --project-path P`, printed as a table (title, range, mode, style, version, placed). `show`: `job.mjs show <jobId>` summarized.
- `remove`: `placement.mjs plan --action remove` in one transaction: delete the layout and the take (or the overlay and any camera layout the job added), re-add `replaced_layouts` and `replaced_controls` with their recorded properties and ranges, verify, commit with a concrete summary. Missing pieces are tolerated and reported. Recorded content is never touched.
- `replace`: `remove` plus place the latest rendered version (`--action replace`).
- `discard`: `remove` when placed, then `job.mjs discard <jobId>` (kit job and manifest entry gone; renders and the deliverable folder stay).

## Failure handling
Every failure goes to the job log before it is reported (the scripts log their own; for a tool error: `job.mjs log <jobId> --kind error --text "<what and where>"`), then the row in `$BORUMI_PLUGIN_ROOT/skills/borumi-editing/references/recovery.md`. An open transaction is aborted before any question is asked. A render error, a tool error, a failed typecheck, a `fail` from the anchor check or a placement that did not verify is never reported as success and never commits.

## What to print
Editor audience. The resolved-range line, one line per stage that changed something visible ("Rendered v1, 8.4s"), the placed notice, and the render and frame paths. Durations as `8.4s` or `1:25`, wall clock as `3m 12s`. No paths except renders, frames and the sheet. No em dashes. End with the next action, the one open question, or nothing.

## Host notes
- Claude Code: tools are `mcp__plugin_borumi_borumi__<tool>`, the plugin root is `${CLAUDE_PLUGIN_ROOT}` (the same folder `BORUMI_PLUGIN_ROOT` names in other hosts), and the commit permission prompt is the approval gate.
- Codex (`scripts/install-codex.sh`, invoked as `$borumi-visualize`): `BORUMI_PLUGIN_ROOT` is `root` in `~/.borumi-agent/config.json`; every `scripts/<name>.mjs` call above runs from that root; Borumi tools go through the registered `borumi` MCP server or `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection for the whole transaction; before `commit_project_edit` the skill asks "Commit: <change_summary>?" and waits for a yes.

## References
- `references/placement.md`: the exact JSON for the take, video update, pinned-camera layout, corner and fullscreen fallbacks, overlay, split and delete; the plan and verify contracts and the executor rules; remove and re-place ordering; re-locating a placement in a new session.
- `references/script-markers.md`: `(ANIMATION: ...)`, `[IMAGE: refs/...]`, `[SHOW TABLE n]`, `[OPEN: ...]` in the scene Script and how they reach the brief.
- `references/design-rules.md`: the kit's hard rules, the verify commands through `job.mjs`, the `render.json` protocol, where the style guides live.
