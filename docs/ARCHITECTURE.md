# borumi plugin architecture

The plugin lets a Claude Code session edit a Borumi project the way an editor would: read the
scenes and the transcript, propose a change with exact times, get a yes, apply it inside one of
Borumi's own transactions, verify by re-reading the timeline. Its flagship turns a stretch of
narration into a rendered Remotion animation placed behind the presenter's camera or in front of
the footage. This page says how the pieces talk and why the load-bearing decisions look the way
they do.

## The pieces

```
Claude Code session (skills/*)  ──MCP stdio──►  Borumi.app  (`borumi mcp`, 45 tools, guide-gated)
        │ Bash                                   transactions, scenes, transcript, timeline, import, inspect, export
        ▼
scripts/*.mjs, doctor.sh, borumi_mcp.py     pure planning + file work; JSON out, logs to stderr
        │
        ▼
~/.borumi-agent/animation-kit  (kit workspace: Remotion, styles, src/jobs/<id>/, public/frames/)
        │ job.mjs render (detached)
        ▼
<project name> Agent/animations/<jobId>/<jobId>-v<N>.mp4|.mov  ──import_media──►  the .bmprojbundle
```

- **The session is the operator.** There is no server. A skill tells the session which Borumi
  tools to call in which order, which script to run for the pure work, and what to print. The
  Borumi tools are `mcp__plugin_borumi_borumi__<tool>`; the server is declared once in
  `.mcp.json` at the plugin root.
- **Borumi's MCP is the only writer.** Every project change is a transaction:
  `begin_project_edit` returns a `tx_id`, structural calls carry the latest `timeline_hash` and
  the hash is re-read after each, `commit_project_edit` takes a one-sentence summary that Claude
  Code shows in its permission prompt. That prompt is the approval gate; `commit_project_edit`
  is in no skill's allowlist on purpose.
- **Scripts do the deterministic work** so the session does not: job lifecycle (`job.mjs`),
  kit sync (`kit.mjs`), frames maps (`frames.mjs`), sentence segmentation and cut planning
  (`segments.mjs`), chapters (`chapters.mjs`), placement plans (`placement.mjs`), the doctor
  (`doctor.sh`), and the cross-agent client (`borumi_mcp.py`, with `place.py` running a
  placement plan end to end on one daemon connection for Codex or batch runs). Pure modules
  under `scripts/lib/` are unit tested against real Borumi responses in `tests/fixtures/`.
- **The kit workspace lives outside the plugin.** `kit.mjs ensure` copies `animation-kit/` to
  `~/.borumi-agent/animation-kit` (hash stamped, additive, preserving guides that carry a
  Learnings log), runs `npm install` when `package.json` changed and downloads Remotion's
  headless Chrome. Outside the plugin because `node_modules` and job folders churn, and because a
  Claude Code session working in the workspace must not inherit this repository's `CLAUDE.md`.

## Guides and ids

Borumi gates tools per connection: `get_guides` with no arguments first, then one guide id per
call before the tool that needs it. The 4-hex ids Borumi returns are stable across connections
but must be observed on the current one before use, so every command begins with
`list_open_projects` and reads the range it will touch before acting, even when a job record
already holds the ids. A `tx_id` exists only on the connection that began it. This is why the
session executes its own transactions and why a batch run does everything on one
`borumi_mcp.py` daemon.

## Job lifecycle (`/borumi:visualize`)

1. **Resolve** the target to project milliseconds: `scene N`, a bare time or range, `scene N
   from A to B` (scene-relative), a quoted sentence matched at word level and snapped to block
   boundaries, or the UI selection / playhead scene from `get_ui_state`. Ranges crossing a scene
   boundary are refused. The resolved range is printed both ways.
2. **Gather**: `get_transcript` words for the range, blocks for the scene and its two
   neighbours, the scene Script (for `(ANIMATION: ...)` beats and `[IMAGE: refs/...]`),
   `get_project_overview` for the canvas, `get_timeline` segments for the range. Raw responses
   go under the deliverable folder as receipts.
3. **Create** with `job.mjs create`: `src/jobs/<id>/{job.json, Scene.tsx, brief.md, words.json,
   refs/}` in the workspace, `manifest.ts` regenerated, the deliverable folder created. The
   brief keeps upstream's section format (narration lines with word timings, the context
   transcript with `>>>` marks) plus `## Placement` and, when there is one, `## The user's plan
   for this beat`. `fps` is 30 and `durationInFrames = floor(range_ms / (1000/30))`, so the
   render is never longer than the range; the effective end is written back to the job.
4. **Frames** (front mode with `--frames`): `inspect_timeline` renders the composite at canvas
   size every 0.5 s; `frames.mjs from-borumi` writes `public/frames/<id>/full/tNNNN.NN.png`,
   contact sheets and `frames-map.json` v2 (`source: "borumi"`, `changes`, `shots`, `black`,
   and a `keepOut` rectangle where the camera is pinned).
5. **Design**: the session, or the `animator` subagent with `--delegate`, reads `brief.md`, the
   kit `GUIDE.md`, the style's `SKILL.md` and `frames/SKILL.md` when frame-aware, writes
   `Scene.tsx`, runs `job.mjs typecheck` and `job.mjs still`, looks at the stills, runs
   `job.mjs anchors` for frame-aware jobs, then writes `render.json {version, notes, title}`.
6. **Render**: `job.mjs render <id>` forks Remotion with the kit's own CLI entry, writes
   `render-status.json` on every progress line and returns; `job.mjs wait` polls in slices
   under the Bash tool's 600 s limit. Behind mode renders h264 crf 14 mp4, front mode ProRes 4444
   `yuva444p10le` mov; `--muted` unless the style declares audio; `--props={"final":true}`;
   two attempts on transient errors; a stall watchdog instead of a wall-clock cap; a finishing
   remux; a duration check against the range. A workspace lock serialises renders.
7. **Place** (one transaction, plan from `placement.mjs`): see the planner below.
8. **Iterate**: v1 places automatically. Every later design turn renders, shows a six-frame
   contact sheet and asks "Place vN into Borumi?"; on yes the old pieces are removed and the new
   ones placed in the same transaction. `~/.borumi-agent/current.json` makes plain follow-ups
   design turns on the current job. Superseded renders stay in the bundle (Borumi copies every
   import and the MCP cannot delete media), and the command says so once.
9. **Record**: `job.json` carries `placed` (mode, version, layer id, take and layout segment
   ids, replaced layouts and controls, commit id, times), `imported_media_ids` over the job's
   life, and `log.jsonl` receives every note, error and placement before anything is reported.

## The placement planner

`placement.mjs` turns a fresh `get_timeline` read plus the job facts into an ordered list of
Borumi calls; the session executes them with hash re-reads between structural steps.

**Behind the camera** (solid background). Add a take `{media_id, video_kind: "screen"}` at
`start_ms`. When `screen_1` already has content there, Borumi puts the take on `screen_2` (or the
next free screen layer) and nothing recorded is touched. Re-read, find the new video segment by
`media.media_id` and `start_ms`, set `face_tracking_mode: "disabled"` and a cut transition. Then
the layout: any layout segment overlapping `[start, end]` is split at the boundaries inside it,
the inner piece deleted with `ripple: false` and recorded in `placed.replaced_layouts`; a custom
layout for exactly the range puts the new screen layer full frame first and `camera_1` last in
the measured bottom-right rectangle (squircle corners, drop shadow). On a non-landscape canvas
Borumi's `corner` layout is used; on a scene without camera, `fullscreen`. Overlapping
`screen_zoom`, `screen_highlight` and `screen_blur` segments are split, their inner pieces
deleted and recorded in `placed.replaced_controls`; `cursor` is left alone. After the add the
planner asserts the project duration and every later scene's start are unchanged.

**In front** (transparent). A `media_overlay` for the range with a custom full-frame position,
`lock_aspect_ratio: false`, instant entrance and exit. If the range shows the camera fullscreen
(no screen layer, no custom layout), a pinned-camera layout is added as well so the overlay never
covers the presenter's face; on a non-landscape canvas it is skipped with a warning.

**Remove and re-place.** Delete the layout (tolerating not found), delete the take or overlay,
re-add every recorded replaced layout and control with its properties and range, verify, commit.
Re-placing a new version does the removal in the same transaction as the new placement. Before
that, the recorded take is confirmed at `placed.start_ms`; if narration moved because of a cut in
between, the range is re-resolved from the first and last word text and printed before anything
is deleted.

Verification frames come from `inspect_timeline` at the start, middle and end of the range and
are copied next to the job as `frames/vN-start.jpg|mid|end`; the placed notice prints their
paths and the elapsed time.

## Cuts: targeted trims

Borumi keeps narration (camera + microphone) and each screen layer in separate edit sets, with
overlays and layouts as their own. A `trim_timeline` call with no target is refused when the
ranges overlap independent sets, and a targeted call ripples only its set. Layouts follow the
screen layer and overlays ripple as one group, so applying one range to every set double-cuts
layouts. The plugin therefore trims narration first, then each screen layer active in the range,
then one overlay layer if any overlay exists, all ranges in one call per set in original
coordinates, re-reading after each call and comparing every layer against the expected
positions (`t - removedBefore(t)`); `layout` is trimmed only when one still sits at its old
position; any mismatch aborts the transaction. `--narration-only` skips the non-narration sets.
Edges snap into the nearest `detect_speech` silence gap within 400 ms, else 250 ms lead and 300
ms tail pads. After a trim that moved narration under earlier chapter cards, `chapters.mjs shift`
re-times `chapters.json` and the cards are re-placed.

## Deliverable folders

`<dirname(project.path)>/<project name> Agent/` next to the `.bmprojbundle`:

```
animations/<jobId>/   job.json, log.jsonl, brief.md, history/Scene.tsx snapshots, <jobId>-v<N>.mp4|.mov,
                      frames/, borumi/ receipts
exports/              /borumi:export outputs (and the 720p phone copy)
chapters/             chapters.json, youtube-chapters.txt
receipts/             raw tool responses from multi-call commands, the full silence lists
```

`scripts/lib/paths.mjs` refuses to create anything when the bundle does not exist at call time,
and never creates a directory under `/Volumes/<x>` unless it is a mount point, so an unmounted
external drive produces "mount the drive first" instead of a folder on the boot disk.
`BORUMI_AGENT_OUT` overrides the parent directory; `~/.borumi-agent/cache/` holds inspect-frame
copies and other cache.

## What was dropped from upstream, and why

| Upstream OpenCutAgent piece | Fate | Why |
|---|---|---|
| CEP panel (`cep-panel/`), design system, browser QA | dropped | Borumi is the UI; the plugin runs in a terminal session. |
| Node MCP server, WebSocket bridge on 3001, auto-start, port file | dropped | Borumi ships its own MCP server; the session calls it directly. |
| `premiere.jsx` host script, ExtendScript try-ladders, tick math, relinking | dropped | No Premiere. Borumi's segments carry ids and ms. |
| ElevenLabs Scribe transcription and its cache | dropped | `get_transcript` returns word and block timings from Borumi's local engine. |
| Loudness meter, silence threshold UI, mirrored detector | detector kept as pacing presets | `detect_speech` finds silences; the presets map to min and keep values. |
| Cut-edge planner on the loudness envelope (`cutplan.js`) | replaced by silence-gap snapping + pads | Media files are not reachable through the MCP; `detect_speech` gaps are. Pads stay conservative until Borumi's word offsets are measured. |
| XML round-trip and generated rebuild, batched razor, undo snapshots | dropped | `trim_timeline` with multi-range batches and ripple is the apply path; there is no undo after commit, so preview-then-commit is the safety net. |
| Headless `claude -p` oracle and the cloud proxy | dropped | The session is the judge; `--delegate` uses a subagent. No nested `claude -p`. |
| Sequence markers (Soft Apply) | dropped | Borumi has no comparable recolorable annotation; retakes are previewed as a table instead. |
| Animation chat, `chat.json`, panel web-access toggles | replaced by `say` turns and `log.jsonl` | The chat is the Claude Code session. |
| Premiere frame export for frame-aware jobs | replaced by `inspect_timeline` | Borumi renders the composite at canvas size on request. |
| All-intra transcode of h264 renders | off by default | Borumi decoded the long-GOP mp4 fine and re-encodes on export; `BORUMI_AGENT_ALL_INTRA=1` re-enables it. |
| `install.sh` / `install.ps1` | `scripts/doctor.sh` | Same `[ok]/[did]/[fix]/[note]` contract, macOS only, no system installs. |
| Retake rubric, sentence segmentation, interval math, duration formatting, the animation kit | kept | Editor-agnostic and already paid for. |

## Design rules that keep this maintainable

- **Borumi is the only writer, and small transactions are the unit of approval.** One result per
  transaction; the change summary is what the user approves.
- **Pure functions for all edit math**, tested against real Borumi responses, so `node --test`
  needs neither Borumi nor ffmpeg.
- **Trust nothing stale.** Ids are re-observed, hashes re-read, positions compared after every
  trim, placements verified with `get_timeline` after commit.
- **Never delete recorded content to place an animation.** Layers are added, layouts point at
  them, and whatever a placement displaced is recorded so `remove` can restore it.
- **Long work detaches and is polled.** Nothing a skill runs may need more than one Bash call's
  600 s.
- **Lessons are recorded** in `docs/LESSONS.md` with the distilled rules in `CLAUDE.md`, and
  every verified Borumi behaviour lands in the cookbook with its exact JSON.
