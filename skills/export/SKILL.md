---
name: export
description: "Borumi: export the open Borumi project, one scene or a range to a video file next to the project (preset or custom size and fps), with optional phone-sized copy, transcript file (srt, md, txt) and mixed audio. Triggers: /borumi:export, export the video, render scene 3, give me an mp4, export at 4k, export for my phone, export the transcript as srt, export the audio."
allowed-tools: Bash(node:*) Bash(python3:*) Bash(ffmpeg:*) Read Write Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__export_video mcp__plugin_borumi_borumi__export_audio mcp__plugin_borumi_borumi__export_transcript mcp__plugin_borumi_borumi__get_export_status mcp__plugin_borumi_borumi__cancel_export
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:export

Exports come from the committed project (finish and commit edits first; an open transaction is not exported). Files land in `<dirname(project.path)>/<project name> Agent/exports/`, never in a temp folder. No transaction is involved, but files are written, so the command is user-invoked only.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:export                                   the whole project, preset balanced
/borumi:export scene 3
/borumi:export 1:02-1:14 --preset fast|balanced|best
/borumi:export all --custom 3840x2160@30
/borumi:export scene 3 --phone                   also a 720p H.264 copy for the phone
/borumi:export --transcript srt|md|txt
/borumi:export --audio wav|m4a
/borumi:export scene 3 --out /path/file.mp4      a path the user names
```

Presets (Borumi's): `fast` for a quick review, `balanced` for the normal final export (1080p60 H.264), `best` when quality beats time. `--custom WxH@fps` resizes the composition (same aspect ratio as the canvas, fps 20 to 120); it never crops or reframes.

## Guides to fetch first

`get_guides` with no arguments once per session, then `exporting`.

## Procedure

1. Project and scope. `list_open_projects` -> the active project (several open and none active: ask, stop). `get_project_overview {project_id, slices:["project","scenes","canvas","transcripts"]}` -> canvas size (for the custom aspect check) and `duration_ms`. `get_scenes {project_id}` for a scene id or bounds. Scope: omitted or `all` = no range; `scene N` = `{type:"scene", scene_id}`; `A-B` = `{type:"time", start_ms, end_ms}`.
2. Output folder through the mount guard: `node --input-type=module -e "import { ensureAgentDir } from '$BORUMI_PLUGIN_ROOT/scripts/lib/paths.mjs'; console.log(ensureAgentDir(process.argv[1], process.argv[2], ['exports']))" "<project.path>" "<project name>"`. A "mount the drive first" error stops the command. File name: `<project name> - <scope> - <preset or WxH@fps>.mp4` where scope is `full`, `scene-3-<scene name>` or `1m02s-1m14s`; an existing file gets `-2`, `-3`. `--out` wins.
3. Custom settings: `--custom WxH@fps` must keep the canvas aspect ratio within 1% and even dimensions; otherwise say which size would (for example `3840x2160` for a 16:9 canvas) and stop.
4. Video: `export_video {project_id, range:<scope or omitted>, settings:{type:"preset", preset:"balanced"} or {type:"custom", width_px, height_px, fps}, output_path:"<file>"}` -> `{export_id, status:"queued", poll_after_ms, output:{format, video_codec, audio_codec, width_px, height_px, fps}}`. Check `output` against the request (size, fps); unsuitable: `cancel_export {export_id}` and report. Print one line: `Exporting Scene 3 (7:44) at 1920x1080 60 fps...`.
5. Poll: `python3 -c "import time; time.sleep(<poll_after_ms/1000, at least 5>)"` then `get_export_status {export_id}`; repeat until `status` is `completed` or `failed`. Unchanged progress is not failure; never start a second export for the same request. Report the path only after `completed`: `artifact.path`. `failed`: report the message, stop.
6. Probe the file: `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs probe "<artifact.path>"` (ffprobe JSON; if `job.mjs` is absent use `ffprobe -v error -show_streams -show_format -of json "<path>"`) -> duration, width x height, fps, codec, size in MB. The duration must match the scope within 0.1 s; otherwise say so.
7. `--phone`: `ffmpeg -y -i "<artifact.path>" -vf "scale=-2:720" -c:v libx264 -crf 20 -preset veryfast -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 128k "<same name>-720p.mp4"`, then probe it too.
8. `--transcript`: readiness first (`transcripts.pending_media_count == 0`; otherwise `request_transcriptions {project_id}`, wait `poll_after_ms`, poll the overview slice `transcripts` until ready). Then `export_transcript {project_id, format:"srt"|"md"|"txt", output_path:"<exports>/<project name>.<ext>"}`. If the reply carries an `export_id`, poll it like a video; otherwise the reply names the file. `srt` is for subtitle uploads, `txt` plain text, `md` grouped by scene.
9. `--audio`: `export_audio {project_id, format:"wav"|"m4a", output_path:"<exports>/<project name> - full.<ext>"}` -> check the returned format, sample rate and channel layout; poll `get_export_status` until `completed`; probe.
10. Report, one line per file: `Scene 3 -> <path> (7:44, 1920x1080, 60 fps, H.264, 412 MB)`; the phone copy and the transcript on their own lines. End with the next action.

## Rules

- Never poll faster than `poll_after_ms`. A long export (a 40-minute video at `best`) can take many minutes; keep polling and say so once.
- Paths printed here are the deliverables; that is the one place paths belong in the chat.
- `cancel_export` only when the output settings are wrong, the export is superseded, or the user says stop.

## Failure handling

Every error goes to `<exports>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`. `ffmpeg` is pre-approved for the phone copy; `ffprobe` prompts once when `job.mjs probe` is not available.
- Codex or any host without the plugin MCP: `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call export_video '<json>'` then `call get_export_status '{"export_id":"..."}'` on one daemon connection (`start` once; ids are connection-scoped).
