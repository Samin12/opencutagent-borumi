# Design: `borumi` Claude Code plugin (repo Samin12/opencutagent-borumi)

Date 2026-09-15. Author: Jarvis. Status: draft for adversarial review, then build.

## 0. Goal in one paragraph

Samin records in Borumi (macOS recorder/editor, v0.30.5; camera, screen, mic captured as separate layers; scenes; its own MCP server). He wants to open Claude Code and say `/borumi:visualize scene 3` (or a timestamp, or "the bit where I explain the pipeline"), have the agent design a Remotion animation for exactly that stretch of narration using the OpenCutAgent animation kit (hand-drawn Excalidraw / n8n sketch / Leo pixel presenter styles), render it, and put it INTO the open Borumi project: either BEHIND his camera (the animation becomes the screen layer for that range, his camera pinned bottom-right in the layout he already approved on the Astra video) or IN FRONT as a transparent overlay. Then keep iterating in chat ("make the arrows pink", "slower"). Around that flagship, the same plugin gives him slash commands for the rest of an edit: cut a range, remove silences, remove retakes, insert b-roll or an image, chapter titles + YouTube chapters file, captions, inspect, export. Everything writes to the real Borumi project through Borumi's MCP inside transactions with preview-then-commit.

## 1. Facts this design rests on (all verified live today unless marked)

- Borumi MCP: `/Applications/Borumi.app/Contents/MacOS/borumi mcp` (stdio). 45 tools. Guides gate tools per connection (`get_guides` no-arg first, then one id per call; `export_video` refused until `exporting` fetched). App must be running for project tools; with the app closed, tools/list and get_guides still work.
- Projects: `create_project {name}` -> `~/Borumi Projects/<name>.bmprojbundle` (Samin's real projects live on `/Volumes/Samin Razer NVME/Borumi Projects/`, currently unmounted). `list_open_projects` gives `{id,name,path,is_active}`. Media inside the bundle: `medias/<uuid>.mov|mp4|wav`; media id = first 4 hex of the uuid (from the intros skill; not re-verified today).
- Empty project: duration 0, `get_timeline` refuses; hash comes from `get_project_overview`. Takes need a Scene (`create_scenes`, needs `scripting` guide).
- Imports: local mp4 / ProRes 4444 mov with alpha / PNG with alpha all import synchronously. Borumi COPIES the file. Inferred kinds are heuristic; override with `video_kind`/`audio_kind` on the take.
- Screen layer swap: a take `{media_id, video_kind:"screen"}` at `at_ms` creates `screen_1` for the media's duration. Deleting the only screen segment removes the layer (filtered reads error) and drops any layout referencing it. A new take's video segment has `face_tracking_mode:"auto"`; set `disabled` + `transition cut` via `update_segments type video`.
- Custom layout (camera pinned bottom-right, Samin's measured rect) renders exactly as on the Astra edit: screen full frame first, camera last at x .775 y .715 w .21 h .25 squircle_v2 r .0284 shadow blur .0185 a100 y .0185; `transition instant`.
- `media_overlay` full-frame custom position honors ProRes 4444 alpha (yuva444p12le) and PNG alpha. Overlays render above the camera.
- `text_overlay` chapter card style from the Astra edit renders: DM Sans bold 62, fixed sizing at x .055 y .76 w .7 h .16, bg rgba(17,31,47,239) paragraph sizing pad .3/.22 radius .016, fade in, instant out.
- `trim_timeline {ranges:[[a,b]], ripple:true}` removes from all layers; `untrim_segments` restores edges. Multi-range in one call is documented ("batch confirmed ranges") but only single-range verified.
- `inspect_timeline` with `save:true, include_images:false` returns JPG paths (1280x720 at medium quality) under `~/Library/Application Support/borumi/temp/control-media/<uuid>/`; `view` can be `render` (composite) or `layer_source` (one layer, e.g. screen_1). `sampling.max_frames` is uint8 (max 255).
- `export_video` custom 1920x1080x30 or preset; poll `get_export_status` (5 s) until `completed`, then `artifact.path`. A 9 s export takes seconds. Presets: balanced = 1080p60 H.264 (from the intros skill).
- `get_transcript` words mode returns project-time ms (blocks in the Astra receipts are project ms; words assumed the same, verify on first real run). `get_ui_state` returns playhead and selection (for "visualize what I'm looking at").
- Scene Script (`script_markdown`) is readable/writable via `get_scenes`/`update_scenes`, so `(ANIMATION: ...)` markers can live in the Borumi scene Script.
- Remotion kit (4.0.484) installs and renders on this Mac (node 24): h264 crf14 mp4 and ProRes 4444 alpha mov; Excalifont renders; typecheck clean. First render downloaded chrome-headless-shell.
- Claude Code 2.1.263 plugin mechanics (from the guide agent): `mcpServers` in `.claude-plugin/plugin.json` or `.mcp.json`; plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>` (so `mcp__plugin_borumi_borumi__get_timeline`); skills in `skills/<name>/SKILL.md` invoked `/<plugin>:<name>`; `${CLAUDE_PLUGIN_ROOT}` expands in MCP config, commands and skills; `claude --plugin-dir <path>` for local testing; `claude plugin validate <path>`; marketplace source `{"source":"url","url":...}` with the plugin at repo root.
- Samin's rules: deliverables in his folders (never temp dirs); commit+push his repos as changes land; register new plugins in `Samin12/samin-plugins` marketplace.json in the same change (url source, never github-object).

## 2. Naming and layout

Plugin name: `borumi` (commands read `/borumi:visualize`, `/borumi:cut`). Repo stays `opencutagent-borumi`; plugin root = repo root. Marketplace entry name `borumi`.

```
opencutagent-borumi/
  .claude-plugin/plugin.json      name borumi, version 0.1.0, mcpServers.borumi (stdio, absolute path, args ["mcp"], timeout 600000)
  .mcp.json                       same server, for `claude --plugin-dir` / working in the repo (not gitignored: no secrets)
  skills/
    borumi-editing/SKILL.md       the base skill: transaction discipline, tool map, time parsing, preview-then-commit, output rules; loaded by every other skill by reference
    borumi-editing/references/borumi-mcp-cookbook.md   (today's verified facts, exact JSON shapes)
    borumi-editing/references/segment-schemas.md       (the add/update input types per segment type, from the guides)
    borumi-editing/references/treatment.md             (Samin's look: pinned-camera layout, chapter card style, text-card rules)
    visualize/SKILL.md            flagship; references/animation-guide.md (the kit rulebook), references/script-markers.md, references/placement.md
    cut/SKILL.md                  remove a range; edge safety
    silences/SKILL.md             detect_speech -> preview -> trim
    retakes/SKILL.md              segments -> judge (rubric) -> decisions -> trim
    insert/SKILL.md               b-roll / image / video at a time, front or behind
    chapters/SKILL.md             chapter cards + youtube-chapters.txt
    captions/SKILL.md             captions segment with a template
    inspect/SKILL.md              timeline map, transcript, frames
    export/SKILL.md               export video/audio/transcript
    setup/SKILL.md                doctor + kit install
  agents/animator.md              optional designer subagent (file tools only, no Borumi MCP) for batch/parallel jobs
  scripts/
    doctor.sh                     [ok]/[did]/[fix]/[note] contract, --check, --install
    borumi_mcp.py                 persistent stdio client (start/call/stop), auto-fetches a missing guide once and retries; for Codex and scripted batches
    kit.mjs                       ensureKit: template -> ~/.borumi-agent/animation-kit (hash-stamped additive sync, preserved SKILL.md merge), npm install, `remotion browser ensure`
    job.mjs                       create | manifest | signal | render | list | discard | show
    frames.mjs                    frames-map v2 from Borumi inspect frames (or from a media file with ffmpeg)
    segments.mjs                  Borumi words -> sentence segments ('[i] m:ss text'), decisions -> cut ranges with edge padding
    chapters.mjs                  chapters.json -> youtube-chapters.txt + text_overlay additions
    lib/                          ported pure modules: paths.mjs, silence.mjs (detector, kept for pacing presets), intervals.mjs (makeRemovedBefore, keepSpans), fmt.mjs (fmtDur, fmtElapsed, mmss)
  animation-kit/                  upstream kit verbatim: engine, styles (excalidraw, n8n, leo), scripts, fonts; CLAUDE.md renamed GUIDE.md with Borumi wording
  tests/                          node tests (no Borumi needed) + smoke.mjs (needs Borumi binary)
  docs/ARCHITECTURE.md, docs/LESSONS.md (upstream history kept under a heading + new Borumi lessons on top)
  README.md, CLAUDE.md, CONTRIBUTING.md, LICENSE (upstream MIT + Commons Clause, attribution kept), .gitignore, package.json
```

Deleted from the fork: `cep-panel/`, `server/` (pure pieces ported into scripts/lib), `install.sh`, `install.ps1`, `start-opencutagent.command`, `.mcp.json.example`, `.env.example` (replaced), `project/` (the marker convention moves to skills/visualize/references/script-markers.md), `.claude/skills/*` (replaced by skills/), `.github/workflows/test.yml` (rewritten for the new tests).

Runtime locations:
- Kit workspace: `~/.borumi-agent/animation-kit` (env `BORUMI_AGENT_HOME`). Outside the plugin dir (node_modules, job churn, no CLAUDE.md inheritance).
- Job deliverables: `<dirname(project.path)>/<project name> Animations/<jobId>/` (next to the .bmprojbundle: `job.json`, `log.jsonl`, `brief.md` copy, `Scene.tsx` snapshots in `history/`, renders `<jobId>-v<N>.mp4|.mov`, `borumi/` receipts, `frames/` contact sheets). Env `BORUMI_AGENT_OUT` overrides the parent dir.
- Plugin cache (levels envelopes, inspect frames copies): `~/.borumi-agent/cache/`.

## 3. The flagship: `/borumi:visualize`

Syntax (the skill parses natural language too):
```
/borumi:visualize scene 3
/borumi:visualize 1:02-1:14            (project time range)
/borumi:visualize scene 3 from 0:05 to 0:12
/borumi:visualize "the part where I explain the three Cs"
/borumi:visualize                       (uses get_ui_state selection, else playhead scene)
/borumi:visualize at 1:23 for 6s "a stopwatch counting down"   (raw job: no narration)
flags: --style excalidraw|n8n|leo   --mode behind|front   --frames   --size seq|4k|1440p|1080p|720p|WxH [--vertical]   --ref <image>...   --delegate
follow-ups: /borumi:visualize say "make the arrows pink"   /borumi:visualize render   /borumi:visualize again   /borumi:visualize list   /borumi:visualize discard <jobId>
```
Defaults: style = last used (else excalidraw), mode = behind (solid bg) unless `--frames` or the user says overlay/on top/in front (then front + transparent), size = project canvas.

Pipeline the skill drives (session = the agent; Borumi tools are `mcp__plugin_borumi_borumi__*`; scripts via Bash with `${CLAUDE_PLUGIN_ROOT}`):

1. Preflight: `node ${CLAUDE_PLUGIN_ROOT}/scripts/kit.mjs ensure --quiet` (idempotent; first run installs). `get_guides` (no args) then `project_edits`, `editing`, `importing_media`, `editing_layouts`, `editing_transitions`, `editing_segment_take_add`, `editing_segment_media_overlay_add`, `editing_segment_layout_add`, `editing_segment_video_update`, `exporting` (only what the mode needs).
2. Resolve target: `list_open_projects` -> active project (ask if several and none active). `get_scenes` -> scene bounds + `script_markdown`. Range from args; "the part where..." -> `get_transcript` blocks for the scene(s) and pick the block(s) whose text matches; nothing -> `get_ui_state` selection/playhead. Print the resolved range: `Scene 3, 0:41-0:49 (8.4 s), 27 words`.
3. Gather inputs: `get_project_overview slices canvas` (width/height); `get_transcript mode words` for the range; `get_transcript mode blocks` for the whole project in <= 10 min chunks (context; capped to 400 lines around the target); the scene Script (for `(ANIMATION: ...)` beats and `[IMAGE: refs/...]`); `get_timeline detail segments` for the range (layers present, existing screen segments and layouts, edit spans). Save all raw responses under `<outDir>/borumi/`.
4. Create the job: `node scripts/job.mjs create --project-path <p> --project-name <n> --scene-id <id> --start-ms --end-ms --width --height --style --background solid|transparent --mode behind|front --words <words.json path> --context <blocks.json path> --script-text <file> --user-brief "<text>" [--raw --at-ms --length-ms] [--ref <img>...] [--frames]` -> prints `{jobId, kitDir, jobDir, briefPath, outDir}`. fps is fixed at 30 (kit's SEC() hardcodes 30; Borumi conforms imported media). durationInFrames = round((end-start)/1000*30). Even dims enforced.
5. `--frames` (front mode only, forces transparent): `inspect_timeline` for the range, `view render`, `presentation frames`, `quality max`, `sampling uniform max_frames min(255, ceil(dur/0.5))`, `save true`, `include_images false` -> `node scripts/frames.mjs from-borumi <jobId> <frames.json>` builds `public/frames/<jobId>/full/tNNNN.NN.png` at canvas size + sheets + `frames-map.json` v2 (source "borumi"). For behind mode frames come from `view layer_source screen_1` (so the camera PiP is not in the reference) and anchors must avoid the camera rect (x >= 0.775, y >= 0.715 of canvas).
6. Design (the session, or the `animator` agent when `--delegate` or batch): read `brief.md`, `animation-kit/GUIDE.md`, `styles/<style>/SKILL.md`, `frames/SKILL.md` if frames; write `src/jobs/<id>/Scene.tsx`; `npm run typecheck`; `npx remotion still` at 2-3 meaningful frames and LOOK at them; frame-aware: `node scripts/check-anchors.mjs <id>` must not FAIL; then write `render.json {version, notes, title}`. Hard rules from the kit stay verbatim (fixed duration, frame-pure, seeded, silent, no em dashes, only touch your job folder + the style's Learnings log).
7. Render: `node scripts/job.mjs render <jobId>` -> `<outDir>/<jobId>-v<N>.mp4` (behind: h264 crf 14, then ffmpeg all-intra? see open Q) or `.mov` (front: ProRes 4444 yuva444p10le, remux -an); retry once on transient errors; stall watchdog 10 min; duration check within max(0.25 s, 2 frames). Prints the path and probe.
8. Place (one transaction):
   - `begin_project_edit` -> `get_timeline detail segments` for the range (fresh hash, current screen segments/layouts).
   - `import_media <render>` -> media_id (poll if not completed).
   - behind: if `screen_1` segments overlap the range: `split_segments` at range start and end (only where a segment straddles), re-read, `delete_segments` the pieces inside the range with `expand_groups:false, ripple:false`; re-read. Save any existing custom layout in the range (properties) for restore later. `add_segments` take `{media_id, video_kind:"screen"}` at `start_ms`; re-read; `update_segments` the new video segment `{face_tracking_mode:"disabled", transition:{kind:"cut"}}`; `add_segments` layout custom (treatment rect) for `[start,end]`, camera source last. If the range had no camera segments (screen-only scene), use `fullscreen screen_1` instead.
   - front: `add_segments media_overlay {media_id}` range `[start,end]`, position custom full frame, lock_aspect false, entrance/exit instant.
   - `inspect_timeline` render frames at start+50 ms, middle, end-80 ms (medium) and LOOK at them; `commit_project_edit` with a concrete summary; `get_timeline` after commit to verify the segment exists at start_ms; record `placed:{mode, media_id, segment_ids, layout_segment_id, start_ms, end_ms, commit_id}` in job.json.
   - Print: `Animation v1 placed behind the camera in Scene 3 (0:41-0:49). Commit 6c56. Frames: <paths>`.
9. Iterate: `say "..."` -> design turn (edit Scene.tsx, bump version) -> render -> place again: new transaction deletes `placed.segment_ids` (+ layout for behind) with expand_groups false, ripple false, then repeats step 8. `render` = re-render the current render.json version without a design turn (when version > lastRenderedVersion). `again` = redo last instruction. `discard` = remove the kit job + manifest entry, keep rendered files (Borumi copied them anyway) and the deliverable folder.
10. Every failure writes a line to `<outDir>/log.jsonl` before it is reported; the final message is editor-audience (no paths except the render and frame paths, no tool names).

Behind-mode subtlety: the take's duration is the render's duration, which equals the range. A take that overshoots by one frame is harmless; never fix an overshoot with a ripple trim.

Script markers: if the scene Script contains `(ANIMATION: ...)` beats, `[IMAGE: refs/<file>]` + prose + `Source:` lines, or `[SHOW TABLE n]` + a table, the skill copies referenced images into `src/jobs/<id>/refs/` and injects the beat text into brief.md under `## The user's plan for this beat`. Documented in references/script-markers.md (from upstream project/script*.md).

## 4. The other commands (each a skill that loads borumi-editing first)

All mutating commands: resolve -> preview (plain-English list + exact ms) -> wait for yes -> `begin_project_edit` -> edits with hash re-reads -> `inspect_timeline` where visuals matter -> `commit_project_edit` with a concrete one-sentence summary -> `get_timeline` verify -> report. On any error or "no": `abort_project_edit`. Nothing is reversible through the MCP after commit, so the preview is the safety net; say so once per session.

- `/borumi:inspect [scene N | range | transcript | frames <range>]`: scenes table (position, name, start-end, takes, layers active per edit span), transcript blocks for a scene, or a contact sheet (`inspect_timeline` contact_sheet low) the agent views. Receipts saved to `<outDir>/borumi/`.
- `/borumi:cut <range | scene N | "from X to Y" | "where I say ...">`: resolve via transcript; edge safety = snap each edge into the nearest `detect_speech activity silence` gap inside +-400 ms, else pad 250 ms before the first kept word / 300 ms after the last kept word (upstream measured Scribe offsets: word starts lag onset median 48 ms p90 242, ends lead by 178 ms; Borumi's engine unmeasured, so pads stay conservative until measured); `trim_timeline ranges ripple true` targeting the narration edit set when screen is independent (edit_spans tell). Report duration before/after.
- `/borumi:silences [scene N|all] [--min-ms 700] [--keep-ms 150] [--pacing relaxed|natural|balanced|brisk|rapid]`: `detect_speech activity silence` -> keep silences >= min, shrink each by keep-ms on both sides (never on a scene edge side), merge, dry-run list capped 200 rows + total seconds -> confirm -> one `trim_timeline` call with all ranges (verify the duration drop equals the sum; if Borumi applies ranges sequentially with ripple, fall back to descending single calls). Pacing presets map to min/keep from upstream PRESETS (Relaxed 1000/200 ... Rapid 120/80).
- `/borumi:retakes [scene N]`: `get_transcript words` -> `node scripts/segments.mjs list` -> `[i] m:ss text` (word-empty stretches auto-cut, < 0.5 s flagged) -> judge with the serial-restart rubric (verbatim from upstream; chunk 36+14 when > 50 segments, delegating chunks to subagents) -> `decisions.json` -> grouped table (group, keeper, cuts) -> confirm -> `segments.mjs plan --decisions` -> cut ranges with edge padding (same rule as /cut) -> `trim_timeline` -> verify -> commit. Decisions persisted so a re-run re-marks.
- `/borumi:insert <file> at <time|scene N start> [--for 4s] [--front (default for images/alpha) | --behind (screen take + pinned camera)] [--fit cover|contain] [--fade]`: import_media -> media_overlay (front) or screen take + layout (behind, same routine as visualize). Supports png/jpg/gif/mp4/mov/mp3/wav/m4a (Borumi's list). Audio files -> `sound_effect` (or `music` with `--music`).
- `/borumi:chapters [auto | <file> | "0:00 Intro; 1:07 Why this matters; ..."] [--no-cards] [--card-seconds 3.2] [--style astra|label|bold]`: auto = one chapter per scene (scene name, else the first sentence shortened to <= 32 chars; the agent proposes titles and asks once). Writes `<project> Animations/chapters/chapters.json` + `youtube-chapters.txt` (mm:ss or h:mm:ss, first line 00:00). Cards: text_overlay at each chapter start (except 0:00 unless asked) for 3.2 s (4 s when > 27 chars), Samin's Astra style; `--style label` uses Borumi's Label template. Re-runnable: it deletes cards it placed earlier (ids in chapters.json) before placing new ones.
- `/borumi:captions [scene N|all] [--template boxed|highlight|accent|impact|card|outline] [--position bottom|top]`: check transcript availability (`request_transcriptions` if missing, poll), then `captions` segment for the range with the template fields copied.
- `/borumi:export [scene N | range | all] [--preset fast|balanced|best | --custom WxH@fps] [--phone] [--transcript srt|md|txt] [--audio wav|m4a]`: export to `<project> Animations/exports/<name>.mp4` (or a path the user names), poll, ffprobe, print duration/res/fps; `--phone` also renders a 720p copy with ffmpeg.
- `/borumi:setup [--install]`: runs `scripts/doctor.sh` (Darwin, node >= 18, npm, ffmpeg absolute path, Borumi.app + version from Info.plist >= 0.30.5, `borumi mcp` answers tools/list with 45 tools, MCP enabled in settings.db, kit workspace installed with remotion + chrome-headless-shell, claude CLI). `--install` runs `kit.mjs ensure`. Prints the [ok]/[fix] report and next steps.

## 5. Scripts: contracts

### job.mjs
```
job.mjs create  --project-path P --project-name N --scene-id S --scene-name "Scene 3" --start-ms A --end-ms B
                --width W --height H [--fps 30] --style ID --background solid|transparent --mode behind|front
                --words words.json --context blocks.json [--script-text file] [--user-brief "text"] [--ref img]... [--frames]
                [--raw --at-ms T --length-ms L]
   -> stdout JSON {jobId, kitDir, jobDir, outDir, briefPath, wordsCount, durationInFrames}
job.mjs manifest                     regenerate src/jobs/manifest.ts
job.mjs signal <jobId>               -> {version, notes, title, pending:boolean}
job.mjs render <jobId> [--force]     -> {version, path, durationSec, codec}; refuses when version <= lastRenderedVersion unless --force
job.mjs list --project-path P        -> jobs with title, range, mode, style, lastRenderedVersion, placed
job.mjs show <jobId>                 -> job.json
job.mjs discard <jobId> [--delete-outputs]
job.mjs placed <jobId> --json '{...}'   record placement (mode, media_id, segment_ids, layout_segment_id, commit_id, start_ms, end_ms)
job.mjs log <jobId> --kind note|error|placed --text "..."
```
Job id: `anim-<base36 time>`. Kit job folder: `src/jobs/<id>/{job.json, Scene.tsx, brief.md, words.json, refs/, render.json (agent), frames-map.json, anchors.json}`; `public/frames/<id>/...`. Deliverable folder as in section 2. brief.md keeps upstream's exact section format (`[a.aas - b.bbs] text` lines with `words: w@t`, `## Full video transcript (context only)` with `>>>` marks) plus a `## Placement` line (behind the camera / in front) and `## The user's plan for this beat` when a brief or script beat exists. words.json = `[{text,start,end?}]` seconds relative to t=0, compact, always written.
Render args (from upstream render.js, verbatim): `process.execPath <@remotion/cli entry> render <id> <tmp> --timeout=120000 --image-format=png --overwrite --props={"final":true} [--muted unless style audio] + transparent: --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le | solid: --codec=h264 --crf=14`; concurrency 3 at 4K / 4 at 1440p; stall 10 min; 2 attempts on transient errors; finishing pass: mov `-c:v copy -an`; mp4 `-c:v copy -an` (Borumi decodes long-GOP fine in the smoke test, and its own export re-encodes; the all-intra pass is dropped, `BORUMI_AGENT_ALL_INTRA=1` re-enables it).

### kit.mjs
`ensure [--quiet]`: template = `${plugin}/animation-kit`; workspace `~/.borumi-agent/animation-kit`; sha1 signature stamp `.kit-version`; additive copy; PRESERVE `styles/*/SKILL.md`, `frames/SKILL.md` via guide-version merge (case-insensitive Learnings log); GENERATED `src/jobs/manifest.ts` only when absent; `.deps-hash` = sha1(package.json) -> `npm install --no-audit --no-fund --loglevel=error`; then `remotion browser ensure` so the first render is not a surprise download. `styles`: list styles (template + workspace custom). `path`: print the workspace path.

### frames.mjs
`from-borumi <jobId> <inspect.json> [--layer screen_1]`: for each frame `{time_ms, path}` compute t = (time_ms - job.startMs)/1000, convert/scale to canvas size PNG at `public/frames/<id>/full/tNNNN.NN.png`, then reuse `animation-kit/scripts/frame-analysis.mjs` (grayFrames, detectChanges, shotsFromChanges, blackSpans) to write `frames-map.json` v2 `{version:2, jobId, source:"borumi", step, canvas, frames, changes, shots, black, sheets}` and 4x3 contact sheets. `from-media <jobId> <file> --source-in-ms X`: the ffmpeg path (0.5 s step), same outputs.

### segments.mjs
`list --words words.json --start-ms A [--out segments.json]` -> prints `[i] m:ss text ⟦cut: no speech⟧|⟦flag: very short⟧` lines; `plan --segments segments.json --decisions decisions.json [--silences silences.json] [--pad-lead-ms 250 --pad-tail-ms 300] [--pause-ms 250]` -> `{ranges:[[a,b]], summary}` in project ms: each run of Cut segments becomes one span whose edges are moved into the nearest detected silence gap (from `detect_speech`) or padded; runs never cross a scene boundary. Port of upstream segments.js rules (pause >= 0.5 s, sentence enders, cut-off tokens, immediate repeats k=2..6, capitalised starters, audio events alone, 24-word cap) with a Borumi word adapter `{text,start_ms,end_ms} -> {type:'word', text, start, end}`.

### chapters.mjs
`build --chapters chapters.json --out-dir D [--card-seconds 3.2] [--style astra|label]` -> `youtube-chapters.txt` + `text_overlays.json` (the add_segments additions array with placement ranges and Samin's properties). `shift --chapters chapters.json --cuts cuts.json` -> remapped times after a silence pass (makeRemovedBefore).

### borumi_mcp.py
`start` (daemon over a FIFO, initialize + get_guides), `call <tool> '<json>' [timeout]`, `stop`. On a `guide_required` error it fetches the named guide once and retries. Prints text or structuredContent JSON. Same shape as the intros skill's script (that one is proven), plus `--sess-dir`. Used by Codex (no MCP) and by `scripts/smoke.mjs`? No: smoke is Node. The Python client is the cross-agent fallback and the batch driver.

### doctor.sh
Checks listed in section 4 with the [ok]/[did]/[fix]/[note] contract; `--check` default; `--install` runs kit ensure and writes nothing else. Never installs system software itself; prints the brew command.

## 6. Skills: what each SKILL.md says (shape)

Frontmatter: `name`, `description` (trigger phrases), `allowed-tools` where sensible (`Bash(node *) Bash(python3 *) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__*`). Body under ~250 lines; details in references/. Every skill starts with "Load `borumi-editing` (read `${CLAUDE_PLUGIN_ROOT}/skills/borumi-editing/SKILL.md`) if not already loaded this session."

borumi-editing (base):
- Preconditions: Borumi open with the project; `list_open_projects`; Settings > AI > Enable MCP.
- Guide gating: which guides before which tools (table).
- Transaction discipline (project_edits guide, hash re-reads, small transactions, concrete summaries, abort on doubt).
- Time parsing: `1:23`, `1:23.5`, `83s`, `1m23s`, `scene 3`, `scene 3 +5s`; everything in project ms; never invent ids.
- Reading: get_scenes / get_timeline summary then segments / get_transcript blocks then words / inspect_timeline low contact sheet first / detect_speech.
- Edit sets: narration (camera_1+microphone_1) vs screen_1 independent; never apply narration ranges to an independent screen layer.
- Output rules: editor audience, fmtDur for durations, no em dashes, report commit ids, end with the next action.
- Receipts: save raw tool JSON under `<project> Animations/borumi/` when a command spans several calls.
- Recovery table (app_not_running, guide_required, timeline_layer_not_found, range invalid on empty project, dangling tx -> abort by id, commit conflict -> begin again).

visualize: the section-3 pipeline as numbered steps, with the exact tool calls and script commands; the design rules imported by reference (GUIDE.md + style SKILL.md); the placement routine (references/placement.md) with exact JSON for take/layout/overlay/update; the iteration subcommands; failure handling; what to print.

## 7. Verification plan (before calling it done)

1. `claude plugin validate .` clean; `node --test tests/` green (manifest, brief text, words.json, render args, size rules, segments rules, chapters output, doctor parsing); `npm run check` (upstream's import scan, ported).
2. `tests/smoke.mjs`: spawn `borumi mcp`, assert 45 tools with object schemas.
3. Live: a fresh Borumi project with a synthetic narrated take (macOS `say` voice + testsrc video), `request_transcriptions` -> words; then the full visualize pipeline through the scripts and MCP: create job from real words -> a real Scene.tsx (I design it) -> render -> place behind + pinned camera -> commit -> export -> frames viewed. Then a front (alpha) job, then `say` iteration to v2 replacing v1. Then /chapters, /silences (the sine gap), /cut on the same project. Every step's receipts kept.
4. Install: push repo, add marketplace entry to samin-plugins, `claude plugin marketplace update samin-plugins`, `claude plugin install borumi@samin-plugins`, `claude plugin details borumi`, then a `claude -p` session using the installed plugin listing `/borumi:*` skills.
5. Review workflow over the built tree (correctness, Borumi-fit, plugin mechanics) with adversarial verification; fix; re-run tests.

## 8. Open questions I am deciding by default (flag to Samin in the report)

- fps: jobs are always 30 fps compositions; Borumi conforms the imported clip to the project. (The kit's SEC() is hardcoded to 30.)
- All-intra transcode dropped by default (Borumi played the long-GOP mp4 fine in the smoke test).
- Design in-session by default; `--delegate` / batch use the `animator` agent (file tools only). No nested `claude -p`.
- Deliverables next to the Borumi project bundle (`<name> Animations/`), which on Samin's machine means the Razer drive when mounted.
- No undo after commit through the MCP; preview-then-commit is the safety, plus small transactions.
- `--frames` supported for front mode; for behind mode it uses the screen layer source and excludes the camera rect from anchors.
- Multi-range `trim_timeline` in one call is assumed to apply in original coordinates (per the guide's "batch confirmed ranges"); verified live before shipping /silences.

## 9. Revisions after the critique (authoritative where they conflict with sections 1-8)

Three adversarial critics returned 57 findings on 2026-09-15; the probes in `borumi-cookbook-draft.md` ("Layering, splitting, ripple") settled the Borumi questions. Decisions:

### 9.1 Behind mode never deletes the recording
- Placement = `add_segments` take `{media_id, video_kind:"screen"}` at `start_ms`. When `screen_1` already has content there, Borumi puts the new take on `screen_2` (or the next free screen layer). No split, no delete of screen content, ever.
- After the add, re-read `get_timeline` for the range and locate the new video segment by `media.media_id == <imported id>` and `start_ms`; its layer id (`screen_N`) is the full-frame layout source. `update_segments type video` on it: `face_tracking_mode:"disabled"`, `transition:{kind:"cut"}`.
- Layout: if a layout segment already overlaps `[start,end]`, `split_segments` it at `start` and at `end` (only the boundaries inside it), re-read, `delete_segments` the inner piece (`expand_groups:false, ripple:false`) and record its `properties` + range in `placed.replaced_layouts`; then add ours for exactly `[start,end]`. Verify exactly one layout segment covers the range.
- Camera rect: on a landscape canvas use the measured custom rect. On any other canvas format use Borumi's `corner` layout (`main_layer_id: screen_N, corner_layer_id: camera_1, corner_shape squircle_v2`). If the range has no camera segment (screen-only), use `fullscreen` on `screen_N`.
- Control segments over the range on `screen_zoom`, `screen_highlight`, `screen_blur`: read them; if any overlap, split at the boundaries, delete the inner pieces (`ripple:false`) and record them in `placed.replaced_controls` (properties + range) so `remove` can re-add them. `cursor` overrides are left alone.
- Duration discipline: `durationInFrames = floor((end_ms - start_ms) / (1000/30))`, so the render is never longer than the range; the job's effective `end_ms` = `start_ms + durationInFrames*1000/30` (rounded down to ms). Ranges that cross a scene boundary are refused (offer one job per scene). After the add, assert `duration_ms` and every later scene's `start_ms` are unchanged; abort otherwise.
- `placed` record: `{mode, version, media_id, layer_id, take_segment_id, layout_segment_id, replaced_layouts:[...], replaced_controls:[...], start_ms, end_ms, commit_id, placed_at}` plus `imported_media_ids:[...]` over the job's life.
- `/borumi:visualize remove [jobId]`: one transaction: delete the layout (tolerate not found), delete the take (tolerate not found), re-add any `replaced_layouts` / `replaced_controls` with their recorded properties and ranges, verify, commit. Front mode: delete the overlay segment (+ any camera layout we added). Removal never touches recorded content. `discard` = `remove` (if placed) + kit cleanup; rendered files and the deliverable folder stay.
- Re-place (v2 over v1): same routine as remove for v1 pieces, in the same transaction as the v2 placement. Before that, confirm the recorded `take_segment_id` still exists at `placed.start_ms`; if the narration moved (a cut in between), re-resolve the range from the first and last word text via `get_transcript` words within the scene, print the new range, and only then proceed.

### 9.2 Front mode
- `media_overlay` full frame with instant transitions, as before. If the effective layout over the range shows the camera fullscreen (no screen layer and no custom layout), ALSO add the pinned-camera custom layout with `camera_1` alone as the corner source over the canvas background for `[start,end]` so the overlay never covers his face; record it as `layout_segment_id`. On a non-landscape canvas, skip the layout and warn.
- `--frames` is front-only; `--frames` with `--mode behind` is an argument error. Frames come from `inspect_timeline view render quality high` (1920x1080 verified) at `max_frames = min(255, ceil(dur/0.5))`; `frames.mjs from-borumi` names them `tNNNN.NN.png`, writes `frames-map.json` v2 with `source:"borumi"` and a `keepOut` rect `{x:0.775,y:0.715,w:0.225,h:0.285}` (canvas ratios) when the camera is pinned; `check-anchors` FAILs anchors inside keepOut.
- Behind mode gets one fixed brief line: "The presenter's camera covers the bottom-right of the canvas (x >= 0.775, y >= 0.715). Keep essential content out of that rectangle."

### 9.3 Iteration without bloating the bundle
- v1 renders and places automatically (the command's promise).
- Every later design turn ("make the arrows pink", `say "..."`, `--ref` images allowed) renders the new version and shows a 6-frame contact sheet (`job.mjs sheet`) plus the file path. It then asks exactly one question, "Place v2 into Borumi?", and stops. On yes (or `--place` on the message), the placement transaction runs (remove v1 pieces, place v2). Every `import_media` copies the file into the bundle and the MCP cannot delete media, so the job prints once: "Superseded versions stay inside the project bundle until you clean up in Borumi."
- Current job pointer: `~/.borumi-agent/current.json` `{project_path: jobId}` written on create; any plain follow-up in a session where a visualize job is current is a design turn on it. `say` remains for disambiguation. `/borumi:visualize list|show|render|remove|discard|again` operate on the current job by default.
- "Put it in front instead" / "behind instead" = placement change: remove the current placement, re-render if the background mode changes (behind = solid, front = transparent), place with the new mode.

### 9.4 Long-running work vs the Bash tool
- `job.mjs render <id>` detaches by default: forks the render (`setsid`), writes `<jobDir>/render-status.json` `{state:"running"|"done"|"failed", version, progress, pid, started_at, path?, error?}` atomically on every progress line, and returns immediately. `job.mjs wait <id> [--timeout 540]` blocks until done/failed or the timeout and prints the status; the skill calls it repeatedly (each call under the Bash limit) and never treats a timeout as failure. `--foreground` keeps the old behaviour for tests.
- `kit.mjs ensure` also detaches when it must install (`--detach`), with `kit-status.json`; `kit.mjs wait`.
- A workspace lock (`.render-lock`, `.manifest-lock`) serialises renders and manifest rewrites so parallel animator agents queue instead of clobbering each other.
- Everything the design step runs goes through `job.mjs` so `Bash(node:*)` covers it: `job.mjs typecheck`, `job.mjs still <id> --frame N [--out <png>]`, `job.mjs anchors <id>`, `job.mjs sheet <file|id> [--out <png>]` (ffmpeg contact sheet), `job.mjs probe <file>` (ffprobe JSON). All chdir to the workspace and invoke the kit's own `@remotion/cli` entry with `process.execPath`.
- fps is not a flag; job.json carries `fps: 30` and a unit test asserts it.

### 9.5 Trims and drift
- Every trim is TARGETED. Before trimming, read `scenes[].edit_spans` for the union of the ranges and list the edit sets active. Apply the ranges (all in one call per edit set, original coordinates) to: the narration set first, then each `screen_N` set active in the range, then one overlay layer if any overlay set is active (overlays ripple together). Re-read after every call and compare each layer's segments with the expected positions (`t - removedBefore(t)` for segments after a cut; straddlers shortened); trim `layout` only if a layout still sits at its old position after the screen trims. On any mismatch: abort the transaction and report which layer disagreed (no partial commits).
- `--narration-only` skips the non-narration sets (the synchronization guide's case). The preview names what will move: "camera, mic, screen and 3 overlays cut together" or "narration only; screen and overlays stay".
- `detect_speech` is always targeted at the microphone layer ids read from `get_timeline`; the trim target uses the same ids plus the camera ids in that edit set.
- After a trim that moved narration under earlier `/chapters` cards, the command ends by re-timing `chapters.json` with `chapters.mjs shift` and re-placing the cards (they moved with the overlays if overlays were trimmed; the file must match the new times either way).

### 9.6 Argument semantics and output
- Bare `m:ss` / `m:ss-m:ss` / `1m23s` = project time. Times inside "scene N from A to B" or "scene N +5s" are scene-relative. The resolved-range line always prints both: `Scene 3 0:05-0:12 (project 1:46-1:53, 7.0 s, 24 words)`.
- "the part where I say ..." matches at word level (`get_transcript` words for the scene), snaps to the enclosing block boundaries from `mode:"blocks"`, prints the matched words, and asks to widen/narrow only if the match is ambiguous.
- Bare `/borumi:visualize`: `get_ui_state` (after the `ui_navigation` guide); with `active_project` null, say which projects are open and stop. Use the selection when present, else the scene under the playhead; auto-resolved ranges longer than 45 s are printed for confirmation before the job is created.
- The placed notice: `Animation v2 placed behind the camera in Scene 3 (0:41-0:49) in 3m 12s.` The commit id goes to job.json. Verification frames are copied to `<jobDir>/frames/v2-start.jpg|mid|end` and those paths are printed. Single-moment frames come from `inspect_timeline range [t, t+34] max_frames 1`.
- `/silences` preview: one summary line ("Scene 3: 43 silences, 38.2 s (12%), longest 2.1 s at 1:04; camera, mic and screen cut together") plus the five longest; "show all" on request; the full list is written to `<project> Agent/receipts/`.
- Mutating skills carry `disable-model-invocation: true`; `borumi-editing` is `user-invocable: false`; descriptions start with "Borumi:". `allowed-tools` use the colon form: `Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__*`. `commit_project_edit` is intentionally NOT in any allowlist: the permission prompt that carries Borumi's `change_summary` is the single approval gate for placements; cut/silence/retake commands additionally show their preview and wait for a yes before `begin_project_edit`.
- Context discipline: never pull more than the target scene plus its two neighbours into the session; whole-project transcript reads go through `python3 scripts/borumi_mcp.py call ... > <receipts>/file.json` and only the needed lines are read back.

### 9.7 Locations, guards, install
- Deliverables: `<dirname(project.path)>/<project name> Agent/` with `animations/<jobId>/`, `exports/`, `chapters/`, `receipts/`. `scripts/lib/paths.mjs` refuses to create anything when the `.bmprojbundle` does not exist at call time, and never creates a directory under `/Volumes/<x>` unless `/Volumes/<x>` is a mount point (`st_dev` differs from `/`); the error says "mount the drive first".
- MCP server declared once, in `.mcp.json` at the plugin root (the plugin manifest's default location); `.claude-plugin/plugin.json` carries no `mcpServers`. The `timeout` key is kept only if `claude plugin validate` accepts it.
- `tests/`: `job.test.mjs` (manifest, brief text, words.json, render args, size rules, fps 30, durationInFrames floor), `placement.test.mjs` (plan generation from `tests/fixtures/staged-timeline.json`: behind over empty, behind over occupied screen_1, existing layout split, front with fullscreen camera, remove/re-place ordering), `frames.test.mjs` (inspect fixture -> frames-map v2 with keepOut), `segments.test.mjs`, `chapters.test.mjs`, `time.test.mjs`, `paths.test.mjs`, `smoke.mjs` (asserts the specific tool names in `scripts/lib/tools.mjs`, not a count).
- Verification (section 7) adds: a mid-scene sub-range behind placement over a scene whose screen_1 is occupied; v2 re-place on a camera-only scene; `remove`; a targeted multi-set trim with overlays downstream; and, when the Razer drive is mounted, a `duplicate_project` of a real recording for the same checks (recorded takes may group camera+mic+screen differently than imported files).
- Install verification runs `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p ...` (nested launches are refused otherwise).
- Added commands: `/borumi:open <name>` (list_recent_projects / open_project / focus_project) and `/borumi:visualize remove`. Explicitly deferred to v0.2 in the README: move clips, screen/camera zoom, cursor styles, writing `(ANIMATION: ...)` beats into the scene Script.

### 9.8 job.mjs contract (final)
```
job.mjs create --project-path P --project-name N --scene-id S --scene-name "Scene 3" --start-ms A --end-ms B
               --width W --height H --style ID --background solid|transparent --mode behind|front
               --words <words.json from get_transcript mode words> --context <blocks.json> [--script-text <file>]
               [--user-brief "text"] [--ref <img>]... [--frames] [--raw --length-ms L] [--canvas-format landscape|vertical|square|portrait|photo|custom]
   -> {jobId, kitDir, jobDir, outDir, briefPath, scenePath, wordsCount, durationInFrames, endMsEffective}
job.mjs manifest
job.mjs signal <id>            -> {version, notes, title, pending}
job.mjs render <id> [--force] [--foreground] [--all-intra]   -> detached: {state:"running", statusPath} | foreground: {version, path, durationSec, codec}
job.mjs wait <id> [--timeout 540]   -> render-status.json contents
job.mjs status <id>
job.mjs typecheck | still <id> --frame N [--out png] | anchors <id> | sheet <file|id> [--out png] | probe <file>
job.mjs list --project-path P | show <id> | current [--project-path P] | set-current <id>
job.mjs placed <id> --json '{...}' | replaced <id> --json '{...}' | log <id> --kind note|error|placed --text "..."
job.mjs refs <id> --add <img>...   (copies into src/jobs/<id>/refs with -1/-2 suffixes)
job.mjs discard <id> [--delete-outputs]
```
`create` reads `words.json` in Borumi's exact shape (`layers[].segments[].items` triples, project ms) and takes only items inside `[A,B]`; `end` is dropped when not after `start`. The brief keeps upstream's section format exactly (see maps/anim-jobs.md contracts) with the added `## Placement` and `## The user's plan for this beat` sections. The context transcript lists only blocks from the target scene and its two neighbours.

### 9.9 Id registration and who executes a transaction
- Ids are stable across connections but must be observed on the current connection before use (cookbook "IDs must be observed"). Every skill starts a session's work with `list_open_projects` and reads the range it will touch (`get_scenes`, `get_timeline`) before using any id, including ids from job.json.
- A transaction lives on one connection. In Claude Code the session executes the placement plan itself through the plugin's MCP tools (plan from `placement.mjs`, hashes re-read after structural steps, `commit_project_edit` prompts the user). For Codex and batch runs, `scripts/place.py` executes the same plan end to end (begin, import, steps, verify, inspect, commit) on one `borumi_mcp.py` daemon connection; the skill asks for approval before running it because the script's commit does not go through Claude Code's permission prompt.
- `placed` records keep the structural facts (mode, layer id, start_ms, end_ms, media name = render filename, version) next to the ids, and `remove`/`replace` validate ids against a fresh read before deleting anything.

## 10. Host portability (Samin, 2026-09-15: "use this with any subscription, mainly Codex, not just Claude")

Principle: the plugin is a folder of standard skills (SKILL.md, the Agent Skills format Codex and Claude both read) plus host-neutral scripts. No feature depends on Claude Code, on an Anthropic API key, or on a nested `claude` process. The model that designs the animation is whatever the host runs.

- Tool references in every skill are host-neutral: name the Borumi MCP tool (`get_timeline`, `add_segments`) and give the arguments. A "Host notes" block in `skills/borumi-editing/SKILL.md` maps hosts: Claude Code plugin tools appear as `mcp__plugin_borumi_borumi__<tool>`; Codex exposes the server registered as `borumi` in `~/.codex/config.toml`; a host without MCP uses `python3 "$BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py" call <tool> '<json>'` with the same arguments (one daemon per session, `start` first). Skills never spell `mcp__plugin_...` inside procedures.
- Script paths: every skill resolves `BORUMI_PLUGIN_ROOT` once at the top: in Claude Code it is `${CLAUDE_PLUGIN_ROOT}`; otherwise read `~/.borumi-agent/config.json` (`{"root": "..."}`, written by the installer) or take the grandparent of the directory holding the SKILL.md. All commands are written as `node "$BORUMI_PLUGIN_ROOT/scripts/job.mjs" ...`.
- Claude-only pieces are optional extras: `.claude-plugin/plugin.json`, `.mcp.json`, `agents/animator.md`, frontmatter keys `allowed-tools` / `disable-model-invocation` / `user-invocable` (Codex ignores unknown keys). Each skill also ships `agents/openai.yaml` (display_name, short_description, default_prompt) for Codex's skill picker, like the visualize-a-cam-intros skill does.
- Approval gates without Claude's permission prompt: on Codex the skill states the change summary and asks for a yes before `commit_project_edit`; for scripted placements it asks before running `scripts/place.py`.
- Writes outside the cwd (kit workspace, deliverables next to the .bmprojbundle) need a Codex sandbox approval or `--sandbox workspace-write` with the dirs allowed; the installer prints the recommended `[shell_environment_policy.set]` and sandbox lines, and `BORUMI_AGENT_HOME` / `BORUMI_AGENT_OUT` can point the workspace and deliverables anywhere (config.json keys `home`, `out`).
- Installer `scripts/install-codex.sh [--clone | --link <path>] [--mcp] [--claude-skills]`: puts the repo at `~/.codex/skills/borumi` (clone) or links an existing clone, symlinks `~/.codex/skills/borumi-<name>` -> `<root>/skills/<name>` for every skill, writes `~/.borumi-agent/config.json`, registers the Borumi MCP server with `codex mcp add borumi -- /Applications/Borumi.app/Contents/MacOS/borumi mcp` when asked, and with `--claude-skills` also symlinks into `~/.claude/skills/` for people who do not use the plugin system. `scripts/doctor.sh` reports which hosts are wired.
- Codex invocation: `$borumi-visualize scene 3` (skill name = folder name). The same SKILL.md serves both hosts; `tests/portability.test.mjs` fails any skill that hardcodes `${CLAUDE_PLUGIN_ROOT}` or `mcp__plugin_` outside the Host notes block, or lacks the root-resolution line.
