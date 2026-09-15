---
name: insert
description: "Borumi: insert a local image, video, gif or audio file into the open Borumi project at a time: in front as an overlay (b-roll cutaway), behind the camera as the screen layer with the presenter pinned bottom-right, or as a sound effect or music track. Triggers: /borumi:insert, insert this image at 1:23, put this b-roll behind my camera at scene 2, add this clip for 4 seconds, drop this png in front at 0:41, add this sound effect at 2:10, add this music."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__import_media mcp__plugin_borumi_borumi__get_media_import_status mcp__plugin_borumi_borumi__add_segments mcp__plugin_borumi_borumi__update_segments mcp__plugin_borumi_borumi__split_segments mcp__plugin_borumi_borumi__delete_segments mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:insert

Put a file into the video at a time. Three placements:
- **front**: a `media_overlay` above everything, including the camera. The classic b-roll cutaway; the presenter is hidden while it plays. Default for images, gifs and alpha video.
- **behind**: the file becomes the screen layer for that stretch and the camera stays pinned bottom-right in Samin's layout. Same routine as `/borumi:visualize` behind mode, through `placement.mjs`. Default for opaque video. Never deletes recorded footage: a take over an occupied `screen_1` lands on `screen_2`.
- **audio**: a `sound_effect` at a time (or `music` with `--music`).

Nothing changes before the preview gets a yes and the commit prompt is accepted. Borumi copies the file into the project bundle; abort removes it, commit keeps it.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:insert /path/dashboard.png at 1:23                 image, 4 s, in front
/borumi:insert /path/broll.mp4 at scene 2 start            opaque video, behind the camera, its own length
/borumi:insert /path/broll.mp4 at 1:23 --for 4s --front    cutaway for 4 s
/borumi:insert /path/overlay.mov at 0:41 --behind          alpha video forced behind
/borumi:insert /path/logo.png at scene 3 +5s --for 3s --fit cover --fade
/borumi:insert /path/whoosh.wav at 2:10                    sound effect
/borumi:insert /path/bed.mp3 at 0:00 --music --fade        music with fade in and out
```

Flags: `--for <s>` duration (images default 4 s; video and audio default to the file's length; a shorter `--for` trims the end), `--front | --behind`, `--fit contain|cover` (front only; contain is the default: the whole picture inside the frame, no distortion; cover fills the frame and crops the overflow), `--fade` (fade in and out instead of instant), `--music`.

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `importing_media`, `editing_transitions`. Front: `editing_segment_media_overlay_add`. Behind: `editing_layouts`, `editing_segment_take_add`, `editing_segment_video_update`, `editing_segment_layout_add`. Audio: `editing_sound_effects`, then `editing_segment_sound_effect_add` or `editing_segment_music_add`.

## Procedure

1. Project. `list_open_projects` -> the active project (several open and none active: ask, stop). `get_project_overview {project_id, slices:["project","scenes","canvas"]}` -> `<receipts>/canvas.json` (canvas size and preset) and `duration_ms`. `get_scenes {project_id}`. Receipts: `<dirname(project.path)>/<project name> Agent/receipts/insert-<stamp>/` (write `index.md` first).
2. File. Absolute path, exists, extension in Borumi's list: mp4, mov, gif, mp3, wav, m4a, jpg, jpeg, png (anything else: say so, stop). Probe it: `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs probe "<file>"` (ffprobe JSON; if `job.mjs` is absent use `ffprobe -v error -show_streams -show_format -of json "<file>"`) -> duration, width, height, pixel format. Kind: image (png, jpg, jpeg), video (mp4, mov, gif), audio (mp3, wav, m4a). Alpha: png, or a video whose pixel format starts with `yuva`, `rgba`, `argb` or `bgra`.
3. Mode: `--front`/`--behind`/`--music` as given; else image, gif or alpha video -> front; opaque video -> behind; audio -> sound effect.
4. Range. `A` = the resolved time (project ms; `scene N start` = that scene's `start_ms`; `scene N +5s` is scene-relative). `D` = `--for`, else the file's duration (images 4 s). `B = A + D`. `[A, B]` must stay inside one scene (crossing a boundary: refuse, offer one insert per scene); `B` past the scene end is clamped to it and said so.
5. Timeline for the range: `get_timeline {project_id, range:{start_ms:A, end_ms:B}, detail:"segments", segment_fields:["all"]}` -> `<receipts>/timeline.json`: is a screen layer active (behind mode will land on a new `screen_N`), which layouts and control segments overlap (behind mode splits and replaces them for the range), is there a camera segment (screen-only scenes get a fullscreen layout).
6. Preview, then STOP and wait for a yes:
   ```
   Insert dashboard.png in front of everything at 1:23 for 4.0s in Scene 2 (it covers the camera for those 4 s; --behind keeps the camera pinned).
   ```
   or `Insert broll.mp4 behind the camera at 2:05 for 12.3s in Scene 2 (camera pinned bottom-right; the existing screen recording stays on screen_1 underneath; 1 layout replaced for the range).` or `Add whoosh.wav as a sound effect at 2:10 (0.8s).`
7. Transaction:
   1. `begin_project_edit {project_id}` -> `tx_id`. Re-read the range with `tx_id` -> `<receipts>/timeline-tx.json` (fresh hash).
   2. `import_media {tx_id, file_path:"<file>"}` -> `media.id`. `queued` or `running`: wait `poll_after_ms` (`python3 -c "import time; time.sleep(2)"`) and `get_media_import_status {import_id}` until `completed`; `failed` means abort and report.
   3. Front: `add_segments {tx_id, timeline_hash, additions:[{"type":"media_overlay","placement":{"range":[A,B]},"content":{"media_id":"<id>"},"properties":{"position":{"kind":"custom","x_ratio":X,"y_ratio":Y,"width_ratio":W,"height_ratio":H},"lock_aspect_ratio":true,"entrance_transition":{"kind":"instant"},"exit_transition":{"kind":"instant"}}}]}`. Contain: `X=0, Y=0, W=1, H=1` (Borumi fits the picture inside). Cover: with media `w x h` and canvas `CW x CH`, `s = max(CW/w, CH/h)`, `W = w*s/CW`, `H = h*s/CH`, `X = (1-W)/2`, `Y = (1-H)/2` (the rectangle may extend past the canvas; Borumi clips it). `--fade`: both transitions `{"kind":"fade"}`. Re-read; the new segment is the `media_overlay` on some `media_overlay_N` at `start_ms A` with `media.media_id` equal to the imported id.
   4. Behind: write `<receipts>/insert-job.json` = `{"id":"insert-<stamp>","start_ms":A,"end_ms":B,"mode":"behind","fps":30,"outDir":"<receipts>"}`. `node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs plan --timeline <receipts>/timeline-tx.json --job <receipts>/insert-job.json --media-id <id> --canvas <receipts>/canvas.json --action place --out <receipts>/plan.json` -> `{steps, warnings, expect}`. Execute the steps in order exactly as `/borumi:visualize` does (its `references/placement.md`): `args` plus the current `tx_id` and `timeline_hash`; re-read the range after every step with `reread:true`; `find_new_segment` binds `$NEW_LAYER` and `$NEW_SEGMENT` from the fresh read (the video segment with the imported media id at `A`); a delete step's `$SELECT` is filled from the re-read; `tolerate_missing` deletes ignore a missing piece; `verify` is `node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs verify --timeline <receipts>/timeline-after.json --job <receipts>/insert-job.json --plan <receipts>/plan.json --media-id <id> --out <receipts>/placed.json`. A clip longer than `D`: right after the `find_new_segment` step, `split_segments {splits:[{segment_id:"$NEW_SEGMENT", times_ms:[B]}]}`, re-read, `delete_segments {segment_ids:[<the piece starting at B>], expand_groups:false, ripple:false}`, re-read, then continue with the plan (the layout covers exactly `[A, B]`). Behind mode with an image: make a still video first, `ffmpeg -y -loop 1 -i "<img>" -t <D> -r 30 -vf "scale=CW:CH:force_original_aspect_ratio=decrease,pad=CW:CH:(ow-iw)/2:(oh-ih)/2:color=0x0f0d0b" -pix_fmt yuv420p "<project name> Agent/inserts/<name>-<D>s.mp4"`, and import that file instead.
   5. Audio: `add_segments {tx_id, timeline_hash, additions:[{"type":"sound_effect","placement":{"at_ms":A},"content":{"media_id":"<id>"}}]}` (a shorter `--for`: `"placement":{"range":[A,B]}`). `--music`: `{"type":"music","placement":{"range":[A,B]},"content":{"media_id":"<id>"},"properties":{"fade_in":true,"fade_out":true}}` (the properties only with `--fade`; otherwise omit `properties`). Re-read.
   6. Look (visual inserts): `inspect_timeline {tx_id, range:{start_ms:T, end_ms:T+34}, view:{type:"render"}, presentation:"frames", quality:"medium", sampling:{type:"uniform", max_frames:1}, save:true, include_images:false}` at `T = A+50`, `(A+B)/2`, `B-80`; Read the three JPGs. Front: the picture where it should be, undistorted. Behind: the clip fills the frame, the camera sits bottom-right with squircle corners and a shadow. Wrong: `abort_project_edit`, fix, retry.
   7. `commit_project_edit {tx_id, change_summary:"Insert dashboard.png in front of the footage at 1:23 for 4 s in Scene 2."}` (behind: "behind the camera"; audio: "Add whoosh.wav as a sound effect at 2:10."). Declined means abort and stop.
8. Verify after the commit: `get_timeline {project_id, range:{start_ms:A, end_ms:B}, detail:"summary"}` shows the new layer active in the span; `duration_ms` unchanged (front, audio) or unchanged as verified by the plan (behind). Write `<receipts>/placed.json` (mode, layer, segment ids, range, media name) and the summary to `<receipts>/index.md`; a later "remove that insert" deletes those segments (re-located structurally by range and media name, since ids are session aliases) and re-adds any replaced layouts from the plan.
9. Report: `Inserted dashboard.png in front at 1:23 for 4.0s (Scene 2).` plus the three frame paths. End with the next action.

## Failure handling

Every error goes to `<receipts>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked (abort also removes the imported copy). An unverified placement never commits.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`. `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate. `ffmpeg` and `ffprobe` are not pre-approved either; the still-video and probe fallbacks prompt once.
- Codex or any host without the plugin MCP: `python3 $BORUMI_PLUGIN_ROOT/scripts/place.py --project <name> --job <receipts>/insert-job.json --plan <receipts>/plan.json --render "<file>" --summary "..."` runs the behind placement on one connection after the user approved the preview in chat; front and audio inserts go through `borumi_mcp.py call` on one daemon connection with a yes before `commit_project_edit`.
