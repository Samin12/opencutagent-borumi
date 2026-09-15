# Placement routine

How a rendered animation gets into the open Borumi project, and back out. Everything runs inside one `begin_project_edit` transaction on the session's own MCP connection (ids are connection-scoped aliases). `A` is the job's `startMs`, `B` its `endMsEffective` (`A + durationInFrames * 1000/30`, rounded down). `tx_id` and the latest `timeline_hash` go on every structural call; re-read `get_timeline {tx_id, range:{start_ms:A, end_ms:B}, detail:"segments", segment_fields:["all"]}` after every structural call.

`scripts/placement.mjs` turns a timeline read plus the job record into the exact ordered steps, so the session executes and never improvises. The JSON below is what those steps contain.

## Behind mode (the default): the animation becomes the screen, the camera stays pinned

Never deletes recorded content. Verified on 2026-09-15: a screen take added over a range where `screen_1` already has content lands on a new layer (`screen_2`, then `screen_3`), and the layout's full-frame source must be that new layer.

1. Take. `add_segments`:
   ```json
   {"tx_id":"<tx>","timeline_hash":"<hash>","additions":[{"type":"take","placement":{"at_ms":A},"content":{"media_id":"<imported id>","video_kind":"screen"}}]}
   ```
   No `audio_kind`: renders carry no audio track. Re-read. Locate the new video segment: `media.media_id == <imported id>` and `start_ms == A`, searching every `screen_N` layer. Its layer id is `$NEW_LAYER`, its id `$NEW_SEGMENT`. `duration_ms` and every later scene's `start_ms` must be unchanged (the render is never longer than the range; if they changed, abort).
2. Clip properties. `update_segments` (hash stays valid):
   ```json
   {"tx_id":"<tx>","timeline_hash":"<hash>","updates":[{"type":"video","segment_id":"$NEW_SEGMENT","properties":{"face_tracking_mode":"disabled","transition":{"kind":"cut"}}}]}
   ```
3. Existing layouts. For every `layout` segment overlapping `[A,B]`: `split_segments {"splits":[{"segment_id":"<id>","times_ms":[<A and/or B, only the boundaries strictly inside the segment>]}]}`, re-read, then `delete_segments {"segment_ids":[<the piece inside [A,B]>],"expand_groups":false,"ripple":false}`, re-read. Each deleted piece's `properties` and `[start_ms,end_ms]` are recorded in `replaced_layouts`.
4. Control segments on `screen_zoom`, `screen_highlight`, `screen_blur` overlapping `[A,B]`: same split, delete (`ripple:false`), re-read, recorded in `replaced_controls` (`type`, `layer_id`, `start_ms`, `end_ms`, `properties`). `cursor` segments are left alone.
5. Our layout for exactly `[A,B]`. Landscape canvas (`canvas.format.preset == "landscape"`, or width > height on a custom format):
   ```json
   {"tx_id":"<tx>","timeline_hash":"<hash>","additions":[{"type":"layout","placement":{"range":[A,B]},"properties":{"kind":"custom","transition":{"kind":"instant"},"sources":[
     {"layer_id":"$NEW_LAYER","x_ratio":0,"y_ratio":0,"width_ratio":1,"height_ratio":1,"border_radius_ratio":0,"lock_aspect_ratio":false,"overflow":false},
     {"layer_id":"camera_1","x_ratio":0.775,"y_ratio":0.715,"width_ratio":0.21,"height_ratio":0.25,"border_radius_ratio":0.0284,"corner_shape":"squircle_v2","lock_aspect_ratio":false,"overflow":false,
      "shadow":{"blur_ratio":0.0185,"color":{"r":0,"g":0,"b":0,"a":100},"x_offset_ratio":0,"y_offset_ratio":0.0185}}]}}]}
   ```
   Any other canvas format: `{"kind":"corner","main_layer_id":"$NEW_LAYER","corner_layer_id":"camera_1","corner_shape":"squircle_v2","transition":{"kind":"instant"}}`. No camera segment in the range (screen-only scene): `{"kind":"fullscreen","layer_id":"$NEW_LAYER","transition":{"kind":"instant"}}`. Camera source last so it draws on top. Re-read.
6. Verify (below), inspect three moments, commit.

## Front mode: a transparent overlay above everything

1. `add_segments` media overlay for exactly `[A,B]` (ProRes 4444 alpha is honoured):
   ```json
   {"tx_id":"<tx>","timeline_hash":"<hash>","additions":[{"type":"media_overlay","placement":{"range":[A,B]},"content":{"media_id":"<imported id>"},"properties":{"position":{"kind":"custom","x_ratio":0,"y_ratio":0,"width_ratio":1,"height_ratio":1},"lock_aspect_ratio":false,"entrance_transition":{"kind":"instant"},"exit_transition":{"kind":"instant"}}}]}
   ```
   Borumi adds a default shadow; harmless on a full-frame alpha clip. Re-read; the overlay segment id is `$NEW_SEGMENT` on `media_overlay_N`.
2. If the effective layout over `[A,B]` shows the camera fullscreen (no `screen_N` segment and no layout in the range) and the canvas is landscape: add the pinned-camera custom layout with the camera source alone for `[A,B]` (the sources array holds only the `camera_1` entry above, the canvas background shows behind it) so the overlay never covers his face; recorded as `layout_segment_id`. Non-landscape canvas: the plan skips it and warns.
3. Verify, inspect, commit. Overlays render above the camera; a frames job (`--frames`) is front-only for that reason and keeps anchors out of the camera keep-out rectangle.

## The plan and verify contracts (`scripts/placement.mjs`)

```
node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs plan --timeline <get_timeline JSON> --job <outDir>/job.json --media-id <id> [--canvas <get_project_overview canvas JSON>] --action place|remove|replace [--prev-placed <placed.json>] [--out plan.json]
-> {"action","steps":[{"op","args","reread","note","select"?,"tolerate_missing"?,"binds"?}],"warnings":[...],"expect":{...}}
node $BORUMI_PLUGIN_ROOT/scripts/placement.mjs verify --timeline <get_timeline JSON after the steps> --job <outDir>/job.json --plan <plan.json> --media-id <id> [--out placed.json]
-> {"ok":true|false,"placed":{...}|null,"problems":[...]}      (exit 2 and a job-log line when not ok)
```

Executor rules (the session is the executor):
- `args` never contain `tx_id` or `timeline_hash`; add the current ones. After a step with `reread: true`, re-read the range and use the new hash before the next step.
- `find_new_segment` is not a Borumi tool: in the fresh read, find the segment of type `args.segment_type` whose `media.media_id` equals `args.media_id` and `start_ms` equals `args.start_ms`; bind `$NEW_LAYER` (its layer id) and `$NEW_SEGMENT` (its id). Later steps carry those placeholders verbatim; substitute before calling.
- A `delete_segments` step with `select` carries `"$SELECT"` in `segment_ids`: after the re-read, replace it with every segment on layers of kind `select.layer_kinds` whose `[start_ms,end_ms]` lies inside `select.inside` (split pieces get fresh ids, so they cannot be named in advance).
- `tolerate_missing` on a delete: a segment-not-found error is not a failure; drop that id and continue.
- `verify` is the last step and not a tool: run `placement.mjs verify` on the post-step read.
- `expect` carries `duration_ms`, `scene_starts`, `replaced_layouts`, `replaced_controls`, `keep_out`, `layouts_in_range_after`, `camera_layer_id`; `warnings` name occupied screen layers, a missing camera, a non-landscape canvas, and a recorded segment that moved.

`verify` asserts: the take (behind) or overlay (front) of the imported media starts at `A` and ends at `B` (a take may run one frame long at most); face tracking disabled and a cut transition on the take; the take did not land on a layer that already had content; exactly one layout covers `[A,B]` in behind mode and it references the take's layer; the camera layout exists when the plan added one; `duration_ms` equals the pre-placement value; every later scene's `start_ms` is unchanged. Any problem: abort the transaction. If the script's interface ever differs from this page, those assertions are still the contract: check them by hand from the re-read before committing.

## Inspect before commit

Three single moments, `quality:"medium"`, `presentation:"frames"`, `save:true`, `include_images:false`:

```json
{"tx_id":"<tx>","range":{"start_ms":T,"end_ms":T+34},"view":{"type":"render"},"presentation":"frames","quality":"medium","sampling":{"type":"uniform","max_frames":1},"save":true,"include_images":false}
```

at `T = A+50`, `T = (A+B)/2`, `T = B-80`. Read the JPGs. Behind: the animation fills the frame, the camera is bottom-right with squircle corners and a shadow, nothing essential under it. Front: the drawing floats over the footage, the face is visible. After the commit, copy the three files to `<outDir>/frames/v<N>-start.jpg`, `-mid.jpg`, `-end.jpg`; those are the paths the placed notice prints.

## Remove (`/borumi:visualize remove`, `--action remove`)

One transaction, in this order, each step tolerating "not found":
1. Delete the layout we added (`expand_groups:false, ripple:false`). Front mode: the camera layout, if one was added.
2. Delete the take's video segment (behind) or the overlay segment (front), `expand_groups:false, ripple:false`. Deleting the only segment of `screen_N` removes that layer; that is expected.
3. Re-add every `replaced_layouts` entry and every `replaced_controls` entry with its recorded `properties` and `[start_ms,end_ms]` (`add_segments`, one call per group, re-read between calls).
4. Verify (`--action remove`): no segment with the render's media remains in `[A,B]`, the restored layouts are back, `duration_ms` unchanged. Commit with a concrete summary ("Remove animation v2 from Scene 3 and restore the previous layout."). Nothing changed: abort instead.

Recorded footage is never touched. The imported media stays in the bundle (the MCP cannot delete media); say so once.

## Re-place (v2 over v1, `--action replace`)

Same transaction: the removal steps for the recorded placement first, then the placement steps for the new render, then verify, inspect, commit ("Replace animation v1 with v2 behind the camera in Scene 3 from 0:41 to 0:49."). The plan warns when the recorded segment no longer starts at `placed.start_ms` (a cut moved the narration): re-resolve the range from the first and last word text via `get_transcript` words within the scene, print the new range, then plan against it.

## Re-locating a placement (any session other than the one that placed)

`job.placed` holds the ids the placing session saw; on a new connection they are stale (`unknown_id_alias`), and the remove plan would tolerate the "missing" pieces and delete nothing. Before `remove` or `replace` in a new session, re-read the range and rebuild the record with current ids, then pass it as `--prev-placed <receipts>/prev-placed.json`:
- `take_segment_id`: the video segment on `placed.layer_id` whose `start_ms` equals `placed.start_ms` and whose `media` matches the render (the media name in `get_project_overview` slice `sources`, or a `media.end_ms - media.start_ms` equal to the render length).
- `overlay_segment_id`: the `media_overlay` segment at `placed.start_ms` with that media.
- `layout_segment_id`: the layout segment covering exactly `[placed.start_ms, placed.end_ms]` that references `placed.layer_id` (behind) or the camera alone (front).
- `replaced_layouts` and `replaced_controls` carry properties and ranges, not ids; copy them as they are.

## The `placed` record (`job.mjs placed <id> --json`)

```json
{"mode":"behind","version":2,"media_id":"87d7","layer_id":"screen_2","take_segment_id":"b054","layout_segment_id":"2ca5","overlay_segment_id":null,
 "replaced_layouts":[{"type":"layout","layer_id":"layout","start_ms":41000,"end_ms":44000,"properties":{...}}],"replaced_controls":[{"type":"screen_zoom","layer_id":"screen_zoom","start_ms":42000,"end_ms":43000,"properties":{...}}],
 "start_ms":41000,"end_ms":49400,"commit_id":"6c56","placed_at":"2026-09-15T18:02:11Z"}
```

`verify --out placed.json` writes everything but `commit_id`; add it after the commit. `job.mjs placed` also appends the media id to `importedMediaIds` over the job's life and merges any `replaced` record saved earlier with `job.mjs replaced`.
