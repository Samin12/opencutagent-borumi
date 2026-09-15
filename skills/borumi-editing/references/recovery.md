# Recovery: error to action

Every failure is logged before it is reported (`node $BORUMI_PLUGIN_ROOT/scripts/job.mjs log <id> --kind error --text "..."` when a job exists; otherwise a line in the receipts `index.md`). Then act on the row below. Never report a failed step as success, and never leave a transaction open while asking the user a question: abort first, ask second.

## Borumi MCP errors

| Error or symptom | Meaning | Action |
|---|---|---|
| `app_not_running` | Borumi is closed, or MCP is disabled in Settings > AI | Tell the user to open Borumi (and enable MCP), then retry the same call. Do not loop. |
| `guide_required` (names a guide id) | The tool is gated for this connection | `get_guides {guide_ids:[<id>]}` (one id), retry the call once. |
| `unknown_id_alias` | The id came from another connection or session | Re-list (`list_open_projects`, `get_scenes`, `get_timeline`) on this connection, match structurally (scene position or name, layer id, `start_ms`/`end_ms`, media name or duration), then continue with the fresh ids. |
| `timeline_layer_not_found` | The layer vanished with its last segment (deletes remove empty layers) | Re-read `get_timeline` without a `layers` filter; re-derive layer ids from the response. |
| stale or mismatched `timeline_hash` on a structural call | A structural change happened since the last read | Re-read the range, retry once with the new hash. A second failure means another editor is active: `abort_project_edit` and report. |
| `range` refused on a project with `duration_ms 0` | Empty project; `get_timeline` refuses every range | Take the hash from `get_project_overview` (slices `project`, `scenes`); add a scene and a take before timeline reads. |
| `invalid_project_path` | A path that is not an absolute `.bmprojbundle` | Use the exact `path` from `list_open_projects` or `list_recent_projects`. |
| `invalid_request: Untargeted trim ranges overlap independent content edit sets` | Narration and screen (or overlays) are separate edit sets under the range | Repeat the trim with `target {type:"layers", layer_ids:[...]}` for the narration set, then the other sets, one call each, re-reading between calls. |
| `range_too_large` (transcript or timeline read) | Range longer than Borumi allows | Follow the suggestion in the error; otherwise split into ranges of at most 10 minutes. |
| `transcripts.pending_media_count > 0` | Transcription still running | Wait `poll_after_ms`, poll `get_project_overview` slice `transcripts` again. |
| `failed_media_count > 0` or `unavailable_media_count > 0` after a request | Borumi could not transcribe that media | Report it once; do not re-request in a loop. Word-dependent commands stop; visualize can continue as a raw job if the user agrees. |
| `import_media` returns `queued` or `running` | Asynchronous import (non-local sources) | Wait `poll_after_ms`, `get_media_import_status` until `completed`; a transaction cannot commit while an import runs. |
| `import_media` returns `failed` or `canceled` | Bad file or unsupported format (allowed: MP4, MOV, GIF, MP3, WAV, M4A, JPG, JPEG, PNG) | Probe the file (`job.mjs probe <file>`), fix or re-render, retry in the same transaction. |
| commit conflict on `commit_project_edit` | The project changed under the transaction | The transaction is closed. Begin a new one from the latest state, re-read, redo the edit. |
| dangling transaction (a connection dropped mid-edit) | Borumi still holds the tx on the old connection | `abort_project_edit {tx_id}` with the old id from the same connection when possible; a new connection cannot see it, so begin fresh. |
| `get_ui_state` returns `active_project: null` | No project focused in the app | Say which projects are open and stop; the user focuses one (or names it). |
| `get_ui_state` refused | `ui_navigation` guide not fetched | Fetch it, retry. |
| `export` status never `completed` | Export still running or failed | Poll no faster than `poll_after_ms`; unchanged progress is not failure. Report the artifact path only after `completed`. On `failed`, report the message; do not start a duplicate export. |
| MCP tool call times out | Borumi busy (transcription, export, a long inspect) | Wait, then re-issue the read. For a write inside a transaction, re-read first: the write may have landed. |

## Placement and verification failures (visualize, insert)

| Symptom | Action |
|---|---|
| After the take add, `duration_ms` or a later scene's `start_ms` changed | The take overshot the range (render longer than the range). `abort_project_edit`, log, re-render with the correct `durationInFrames`, retry. |
| New take's video segment not found by `media.media_id` at `start_ms` | Re-read without a layer filter and search every `screen_N`; if still absent, abort and report the import id. |
| More than one layout covers the range after placement | The existing layout was not split cleanly. Abort, re-run the plan (split at both boundaries, delete the inner piece, add ours). |
| Inspect frames show the camera covered or the animation missing | Wrong layout source layer or wrong mode. Abort, fix the plan, retry. Never commit an unverified placement. |
| The recorded `take_segment_id` is not at `placed.start_ms` on a re-place or remove | The narration moved (a cut in between). Re-resolve the range from the first and last word text within the scene, print the new range, then proceed. |
| `remove` finds nothing to delete | Tolerate: report what was already gone, still re-add `replaced_layouts` and `replaced_controls`, commit if anything changed, else abort. |

## Render and kit failures

| Symptom | Action |
|---|---|
| `kit.mjs ensure` fails (npm install, network) | Report the last stderr lines; the user can rerun `/borumi:setup --install`. Nothing else proceeds. |
| `job.mjs typecheck` errors | Fix `Scene.tsx` (only the job folder), rerun. Never bump `render.json` with a failing typecheck. |
| `job.mjs still` shows the wrong composition or a blank frame | Check the manifest registered the job (`job.mjs manifest`), the `Canvas transparent` prop matches the background mode, and the frame index is inside the duration. |
| `job.mjs anchors` returns `status: "fail"` (or `"missing"` on a frames job) | Fix the anchor or the timing per `frames/SKILL.md`, or write the missing `anchors.json`; a fail never renders. Inside the camera keep-out rectangle counts as a fail. |
| `placement.mjs verify` exits 2 with `problems` | The staged placement does not match the plan (it is already in the job log). `abort_project_edit`, read the problems, fix the plan or the range, retry. |
| Render `state: failed` with a transient error (browser crash, timeout, ENOMEM) | `job.mjs render <id> --force` once more; a second failure is reported with the error text from `render-status.json`. |
| Render stalls (no progress for 10 minutes) | The watchdog marks it failed; retry once with `--force`; then report. |
| Rendered duration differs from the expected by more than max(0.25 s, 2 frames) | Do not place. Check `durationInFrames` in the kit job.json and the composition's use of `useVideoConfig()`; re-render. |
| `job.mjs wait` returns with `state: running` after its timeout | Not a failure. Call `wait` again (each call stays under the Bash limit). |
| Chrome headless shell downloads on the first render | Expected once; `kit.mjs ensure` runs `remotion browser ensure` to move this out of the first job. |
| ffmpeg or ffprobe missing | Run `/borumi:setup`; it prints the brew command. Renders and sheets need both. |
| "mount the drive first" from `paths.mjs` | The project bundle's volume is not mounted. Stop; the user mounts it and reruns. |
| A Bash command hits the 600 s limit | Only detached work is allowed to be long: renders and kit installs go through `render`/`wait` and `ensure --detach`/`wait`. Anything else that ran long is a bug; log it. |

## When in doubt

Abort the open transaction, log what happened, tell the user what was verified and what was not, and end with the single next action.
