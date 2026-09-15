# Borumi MCP cookbook

Verified 2026-09-15 on Borumi 0.30.5 against a live smoke project. Every fact below was executed through `borumi mcp`, not read from docs. Tool names here are bare; in Claude Code they are `mcp__plugin_borumi_borumi__<tool>`.

## 1. Connection and gating

- Server: `/Applications/Borumi.app/Contents/MacOS/borumi mcp` (stdio JSON-RPC, protocol 2025-06-18). It answers `initialize`, `tools/list` and `get_guides` even with the app closed; every project tool returns `app_not_running` until Borumi is open.
- 45 tools. Guides gate tools PER CONNECTION. `get_guides` with no args first, then one id per call. `export_video` refuses with `guide_required` until `exporting` was fetched in that connection; `add_segments` needs `editing_segment_<type>_add`; `create_scenes` needs `scripting`. Fetch the guide, retry.
- Guide ids that exist: basics, project_edits, scripting, editing, editing_canvas, editing_cursors, editing_layouts, editing_sound_effects, editing_synchronization, editing_transcripts, editing_transitions, editing_trimming, exporting, importing_media, ui_navigation, use_cases, editing_segment_{take,media_overlay,text_overlay,layout,captions,screen_zoom,camera_zoom,screen_highlight,screen_blur,music,sound_effect,cursor}_add, editing_segment_{audio,video,overlay,media_overlay,text_overlay,layout,captions,screen_zoom,camera_zoom,screen_highlight,screen_blur,music,sound_effect,cursor}_update, editing_segment_text_overlay_templates, editing_segment_captions_templates. There is NO take_update (takes become `video`/`audio` segments; update those).

## 2. Ids are connection-scoped aliases (verified with two simultaneous connections)

- Every id Borumi returns (project, tx, scene, segment, media, take, clip: the 4-hex strings) is an ALIAS valid only on the MCP connection that received it. A second connection asking about the same `tx_id` or `project_id` gets `unknown_id_alias: Borumi doesn't recognize this ID. List the relevant data again, then try again.`
- Consequences: a transaction must begin, run and commit on ONE connection (the session's plugin MCP connection, or one `borumi_mcp.py` daemon session). Never hand a `tx_id` from a script to the session or vice versa. Ids saved in receipts or job records from another session are stale: re-list (`list_open_projects`, `get_scenes`, `get_timeline`) and match structurally (scene position/name, layer id, `start_ms`/`end_ms`, media name or duration) before acting.
- A transaction whose connection died is invisible to other connections; begin a new one.
- Layer ids (`camera_1`, `screen_2`, `layout`, ...) are structural names, not aliases; see the probe output for whether segment/media aliases change between connections.

## 3. Projects

- `create_project {name}` puts the bundle at `~/Borumi Projects/<name>.bmprojbundle` and opens it (not focused). A `path` must be an absolute path ending in `.bmprojbundle` (a plain folder is `invalid_project_path`).
- `list_open_projects` -> `{active_project_id, projects:[{id,is_active,name,path}]}`; ids are 4-hex strings.
- An empty project has `duration_ms 0`; `get_timeline` refuses any range on it. Take the `timeline_hash` from `get_project_overview` (slices project/scenes) instead.
- Takes need a Scene. `create_scenes {tx_id,timeline_hash,destination:{type:"end"},scenes:[{name,script_markdown}]}` -> `{changed, created_scene_ids}`. A fresh scene reports 3000 ms until content arrives.
- The scene Script (`script_markdown`) round-trips through `create_scenes` / `get_scenes`, so `(ANIMATION: ...)` beats can live in the Borumi scene Script.
- `get_ui_state` (needs the `ui_navigation` guide first) with no project focused returns `{"active_project": null, "screen": "new_project"}`; with a focused project it reports the active project, tool, playhead and selection (shape to be recorded on first real use).

## 4. Transactions

- `begin_project_edit {project_id}` -> `{tx_id, base_commit_id}`. Use `tx_id` everywhere inside; never mix `project_id`.
- Every structural call needs the latest `timeline_hash`; re-read after each. `update_segments` does not change the hash.
- `commit_project_edit {tx_id, change_summary}` -> `{commit_id, changed_entity_count}`. A dropped connection leaves the tx dangling; `abort_project_edit` with the old id clears it.

## 5. Import

- `import_media {tx_id, file_path}` (absolute). Local files complete synchronously (`status: completed` in the first reply). Reply: `{import_id, status, media:{id,name,width_px,height_px,duration_ms?,tracks:["video"|"audio"|"image"],inferred_video_kind?,inferred_audio_kind?}}`.
- Formats that imported: h264 mp4, ProRes 4444 mov with alpha (`yuva444p12le`), PNG with alpha. Alpha is honored by `media_overlay`.
- Inference is heuristic (a synthetic test-pattern clip was inferred `screen` + `music`); override with `video_kind` / `audio_kind` on the take.
- Borumi COPIES the file into the bundle (`medias/<uuid>.mov|mp4|wav`). Abort removes media imported in that transaction; commit keeps it; nothing in the MCP deletes media afterwards.

## 6. Takes and layers

- `add_segments` take: `{type:"take", placement:{at_ms}, content:{media_id, video_kind:"camera"|"screen", audio_kind:"microphone"|"system_sound"|"music"}}`. A camera+mic file creates `camera_1` + `microphone_1` segments in one edit group; a silent video with `video_kind:"screen"` creates `screen_1`.
- A take's duration extends the scene (12 s camera -> scene 12 s).
- Layers only exist while they have segments: deleting the only `screen_1` segment removes the layer; `get_timeline` with `layers:["screen_1"]` then errors `timeline_layer_not_found`. Read without a layer filter after deletes.
- Deleting the screen segment also drops any `layout` that referenced `screen_1`. Re-add the layout after re-adding the take.
- A freshly added take's video segment has `face_tracking_mode:"auto"` and `transition:{kind:"auto"}`. For an animation set `{"type":"video","segment_id":..,"properties":{"face_tracking_mode":"disabled","transition":{"kind":"cut"}}}` via `update_segments`.
- `get_timeline` (detail segments, segment_fields media/properties/all) returns per layer `{id,kind,category,segment_count,segments:[{id,type,start_ms,end_ms,group_id,scene_id,media:{media_id,clip_id,take_id,start_ms,end_ms,speed,source_scene_id},properties}]}` plus `scenes:[{start_ms,end_ms,edit_spans:[{start_ms,end_ms,edit_sets:[[layer ids]]}]}]`, `duration_ms`, `timeline_hash`. Camera+mic share an edit set; screen is its own; overlays and layout are their own.
- Layer ids seen: camera_1, screen_1, screen_2, screen_3, microphone_1, system_sound_1, media_overlay_1, text_overlay_1/2, music, layout, screen_zoom, camera_zoom, screen_blur, screen_highlight, captions, cursor, background.

## 7. Layering, splitting, ripple (probed in aborted transactions on the smoke project)

- A screen take added at `at_ms` over a range where `screen_1` already has content lands on a NEW layer `screen_2` (screen_3, ... as needed). Nothing is deleted. `edit_spans` then list `["screen_1"]` and `["screen_2"]` as separate edit sets. So an animation "behind the camera" over an existing screen recording = add the take (it becomes screen_N) + a custom layout whose full-frame source is that NEW layer id (find it by `media.media_id == imported id` at `start_ms`) with camera_1 last. Removing it later = delete that take segment + the layout.
- `split_segments` works on `layout` and `media_overlay` segments (control and overlay layers), not only content.
- `trim_timeline` with `target:{type:"layers",layer_ids:[...]}` ripples ONLY that edit set. Observed on one range [1000,2000]: narration trim moved camera+mic only; a `layout`-targeted trim shortened the layout only; a `media_overlay_1`-targeted trim rippled media overlays AND text overlays (overlays behave as one ripple group); a `screen_1`-targeted trim split/rippled screen_1 AND shortened the layout again (layouts follow the screen layer). So blindly applying the same range to every edit set double-cuts layouts. Rule: trim narration first, then each screen layer active in the range, then ONE overlay layer if overlays exist; re-read after each call and compare every layer's segments to the expected positions (`t - removedBefore(t)`); never trim `layout` unless a layout still sits at its old position after the screen trims; abort on any mismatch.

## 8. The pinned-camera layout (Samin's measured treatment, verified render)

```json
{"type":"layout","placement":{"range":[start_ms,end_ms]},"properties":{"kind":"custom","transition":{"kind":"instant"},"sources":[
 {"layer_id":"screen_1","x_ratio":0,"y_ratio":0,"width_ratio":1,"height_ratio":1,"border_radius_ratio":0,"lock_aspect_ratio":false,"overflow":false},
 {"layer_id":"camera_1","x_ratio":0.775,"y_ratio":0.715,"width_ratio":0.21,"height_ratio":0.25,"border_radius_ratio":0.0284,"corner_shape":"squircle_v2","lock_aspect_ratio":false,"overflow":false,
  "shadow":{"blur_ratio":0.0185,"color":{"r":0,"g":0,"b":0,"a":100},"x_offset_ratio":0,"y_offset_ratio":0.0185}}]}}
```

Camera last so it draws on top. Verified in the export: animation full frame, camera bottom-right with squircle corners and shadow. When the animation take landed on `screen_2`, the full-frame source is `screen_2`, not `screen_1`.

## 9. Overlays (render ABOVE the camera)

- `media_overlay` with `position:{kind:"custom",x_ratio:0,y_ratio:0,width_ratio:1,height_ratio:1}`, `lock_aspect_ratio:false`, instant entrance/exit = a full-frame alpha overlay; Borumi adds a default shadow property (harmless on a full-frame alpha clip). PNG overlays work the same way with `tracks:["image"]` media.
- `text_overlay` chapter card that matches the Astra edit: DM Sans, bold, size 62, `sizing_mode:"fixed"`, position custom x 0.055 y 0.76 w 0.7 h 0.16, alignment left, background rgba(17,31,47,239), paragraph sizing, padding 0.3/0.22, radius 0.016, entrance fade, exit instant. Verified render. (Full JSON in `treatment.md`.)

## 10. Cuts

- `trim_timeline {ranges:[[9000,10000]], ripple:true}` with no target removed the range from every layer: duration 12000 -> 11000, camera split into (0-9000 media 0-9000) and (9000-11000 media 10000-12000).
- `untrim_segments {segments:[{segment_id, right_ms:500}], ripple:true}` -> `{changed, clamped}` restored 500 ms at that edge (duration 11500).
- Target `{type:"layers",layer_ids:[...]}` when narration and screen are independent edit sets (see edit_spans); never apply narration ranges to an independent screen layer.
- An UNTARGETED `trim_timeline` whose ranges overlap independent edit sets (e.g. a screen take or an overlay under the range) is refused: `invalid_request: Untargeted trim ranges overlap independent content edit sets. Specify target layers or Segments and trim each edit set separately.` Target the narration edit set: `target:{type:"layers", layer_ids:["camera_1","microphone_1"]}`.
- Multi-range in ONE call works and applies every range in ORIGINAL coordinates: `ranges:[[1000,2000],[5000,6000]]` on a 11500 ms project -> 9500 ms, camera pieces (0-1000 media 0-1000), (1000-4000 media 2000-5000), (4000-7500 media 6000-9500), (7500-9500 media 10000-12000). Batch confirmed ranges; do not shift them yourself.

## 11. Transcripts and speech (verified on the narrated test project, Borumi's local engine)

- `request_transcriptions {project_id}` -> `{poll_after_ms:1000, requested_media_ids:[...]}`. Readiness: poll `get_project_overview {project_id, slices:["transcripts"]}` -> `transcripts: {pending_media_count, ready_media_count, failed_media_count, unavailable_media_count}`; ready when `pending_media_count == 0` and `ready_media_count >= 1`. A 20 s take was ready within seconds.
- `get_transcript {project_id|tx_id, range, mode:"words"}` -> `{layers:[{id:"microphone_1", kind:"microphone", segments:[{segment_id, scene_id, media_id, start_ms, end_ms, media_range:{start_ms,end_ms}, items:[[start_ms, end_ms, "text"], ...]}]}], timeline_hash}`. Item times are PROJECT ms (a take at 0 gives words from 100 ms). Words keep punctuation and capitalization ("scene,", "pipeline.", "First,"), so sentence-level segmentation rules work. Relative time for a job = `start_ms - range.start_ms`.
- `mode:"blocks"` returns the same shape with sentence-ish chunks split on pauses and punctuation (9 blocks for a 20 s take): the natural review unit for retakes and for "the part where I say ...". `mode:"sections"` groups by scene with a `text` field per track (see the Astra receipts).
- `detect_speech {project_id|tx_id, range, activity:"silence"}` -> `{ranges:[[start_ms,end_ms], ...], timeline_hash}` in project ms, including the leading and trailing edges.

## 12. Inspect

- `inspect_timeline {tx_id|project_id, range, view:{type:"render"}, presentation:"frames", quality:"medium", sampling:{type:"uniform",max_frames:N}, save:true, include_images:false}` -> `{frames:[{time_ms,path,width,height,image_index}]}` with JPGs at 1280x720 under `~/Library/Application Support/borumi/temp/control-media/<uuid>/`. With `include_images:true` the frames come back as image content blocks (large).
- `quality:"max"` and `"high"` return 1920x1080 JPGs (canvas size); `"medium"` returns 1280x720. `view:{type:"layer_source", layer_id:"screen_1"}` returns the raw layer frames and adds `layer_id` and `segment_id` per frame.
- `sampling.max_frames` is uint8 (max 255).
- `inspect_timeline` has no "frame at time t" parameter; to see one exact moment use `range:{start_ms:t, end_ms:t+34}` with `sampling:{type:"uniform",max_frames:1}` (returns the bin midpoint, t+~17 ms).

## 13. Export

- `export_video {project_id, range:{type:"time",start_ms,end_ms}|{type:"scene",scene_id}, settings:{type:"custom",width_px,height_px,fps}|{type:"preset",preset}, output_path}` -> `{export_id,status:"queued",poll_after_ms:5000,output:{format,video_codec,audio_codec,width_px,height_px,fps}}`; poll `get_export_status` until `status:"completed"`, then `artifact.path`. A 9 s 1080p30 export took a few seconds.
- Presets: `fast`, `balanced` (1080p60 H.264, the normal final export), `best`. Custom dimensions must keep the canvas aspect ratio.

## 14. Renders that Borumi accepted

- Remotion kit (4.0.484) renders on this Mac: h264 crf 14 mp4 (long-GOP, keyframe every 30 frames) and ProRes 4444 alpha mov. Borumi decoded the long-GOP mp4 fine in the smoke test and re-encodes on export, so no all-intra pass is needed (`BORUMI_AGENT_ALL_INTRA=1` re-enables it).
- Renders are muted and stripped of audio (`-an`) unless the style declares audio.
