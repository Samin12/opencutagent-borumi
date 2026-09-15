# Working in opencutagent-borumi

This repository is the **borumi** Claude Code plugin: slash commands (`/borumi:visualize`,
`/borumi:cut`, ...) that edit a Borumi project through Borumi's own MCP server, plus a vendored
Remotion animation kit (from OpenCutAgent) that `/borumi:visualize` renders with and places into
the project. The plugin root is the repository root. There is no server, no panel and no Premiere
in this tree any more; that history lives in `docs/LESSONS.md` under its own heading.

- `docs/ARCHITECTURE.md` says how a session, the scripts, the kit workspace and Borumi fit
  together. Read it once.
- The contracts every script and skill is written against: `DESIGN.md` in the build scratchpad
  produced them, and they are written down here as `docs/ARCHITECTURE.md` (job lifecycle,
  placement planner, deliverable folders), `docs/borumi-mcp-cookbook.md` (every Borumi behaviour
  verified live, exact JSON), `docs/borumi-guides/` (Borumi's own guides and `tools.json`), and
  `skills/borumi-editing/references/` (cookbook, segment schemas, recovery table, Samin's treatment).
- `docs/LESSONS.md` is the dated history: the Borumi section first, the Premiere era below.
  Search it before debugging anything that looks like a known symptom.

## Layout

```
.claude-plugin/plugin.json   name, version, description (no mcpServers here)
.mcp.json                    the Borumi MCP server: /Applications/Borumi.app/Contents/MacOS/borumi mcp
skills/<name>/SKILL.md       one skill per command; borumi-editing is the shared base (user-invocable: false)
agents/animator.md           optional designer subagent (file tools only, no Borumi MCP)
scripts/                     job.mjs, kit.mjs, frames.mjs, segments.mjs, chapters.mjs, placement.mjs, doctor.sh,
                             check.mjs, borumi_mcp.py + place.py (Codex/batch), install-codex.sh, gen-openai-yaml.mjs,
                             lib/ (pure modules: paths, intervals, fmt, silence, brief, render, transcript, tools, borumi_client.py)
animation-kit/               the vendored Remotion kit; GUIDE.md is its rulebook; synced to ~/.borumi-agent/animation-kit
tests/                       node --test files (*.test.mjs, no Borumi needed) + smoke.mjs (needs the Borumi binary) + fixtures/
docs/                        ARCHITECTURE, LESSONS, the cookbook, Borumi's guides
```

Runtime locations, never inside the repo: the kit workspace `~/.borumi-agent/animation-kit`
(`BORUMI_AGENT_HOME`), the cache `~/.borumi-agent/cache/`, the current-job pointer
`~/.borumi-agent/current.json`, and the deliverables `<project name> Agent/` next to the
`.bmprojbundle` (`BORUMI_AGENT_OUT` overrides the parent).

## Tests

```
node scripts/check.mjs          # node --check every .js/.mjs + the missing-import scan
node --test tests/*.test.mjs    # unit tests; no Borumi, no ffmpeg, no npm install
node tests/smoke.mjs            # spawns `borumi mcp`, asserts the tool names (needs Borumi installed)
claude plugin validate .        # manifest and skill frontmatter
```

Use the shell glob: `node --test tests/` treats the directory as a test file on Node 21+ and
fails. Every pure function gets a test; the fixtures under `tests/fixtures/` are real Borumi
responses captured on 2026-09-15, so a test that reads one is a test against the real shapes.

## Hard rules (each one is backed by a lesson; see LESSONS.md)

**Copy**
- **No em dashes anywhere**: docs, skills, script output, on-screen text, comments. Use a comma,
  colon or period. `tests/docs.test.mjs` scans the documentation for them.
- Plain, direct language. Final messages are for a video editor: no tool names, no paths except
  the render and frame paths, durations through `fmtDur` ("1:25") and wall clock through
  `fmtElapsed` ("3m 12s") from `scripts/lib/fmt.mjs`. End with the next action.

**Borumi MCP**
- Guides gate tools per connection: `get_guides` with no args first, then one id per call,
  before the tool that needs it (`export_video` needs `exporting`, `add_segments` needs
  `editing_segment_<type>_add`, `get_ui_state` needs `ui_navigation`).
- Ids are 4-hex strings that must be SEEN on the current connection before use: start every
  session with `list_open_projects`, then `get_scenes` / `get_timeline` for the range, and only
  then use ids, including ids from `job.json`. A `tx_id` lives on the connection that began it;
  never hand one between a script and the session.
- One small transaction per result. `begin_project_edit`, re-read the `timeline_hash` after
  every structural call, `inspect_timeline` where visuals matter, `commit_project_edit` with a
  concrete one-sentence summary, `get_timeline` after commit to verify. `abort_project_edit` on
  any doubt. Nothing is reversible through the MCP after commit.
- `commit_project_edit` is deliberately absent from every `allowed-tools` list: the permission
  prompt that carries Borumi's change summary is the approval gate. Mutating skills also carry
  `disable-model-invocation: true` and show their preview before `begin_project_edit`.
- Behind-mode placement never deletes recorded content: the take lands on the next free
  `screen_N` and the layout points at it. Only layouts and control segments overlapping the
  range are split and their inner pieces recorded in `placed.replaced_*` so `remove` can put
  them back.
- Every trim is targeted per edit set, in the order narration, each active `screen_N`, one
  overlay layer. Re-read after each call and compare every layer against the expected positions
  (`t - removedBefore(t)`); never trim `layout` unless one still sits at its old position; abort
  on any mismatch. Batch ranges in one call in ORIGINAL coordinates.
- Never apply narration-derived ranges to an independent screen layer.
- Ranges that cross a scene boundary are refused; offer one job per scene.

**Kit and renders**
- Jobs are always 30 fps compositions (`timing.ts` hardcodes `SEC()` at 30; Borumi conforms
  the clip). `durationInFrames = floor((end_ms - start_ms) / (1000/30))`, so a render is never
  longer than its range; never fix an overshoot with a ripple trim.
- `job.mjs render` detaches and writes `render-status.json`; poll with `job.mjs wait` (each call
  under the Bash tool's 600 s limit). A timeout is not a failure. `--foreground` is for tests.
- Every failure path writes to the job's `log.jsonl` before it propagates. Scripts print JSON to
  stdout and logs to stderr.
- Codec knobs live on the render command line (`job.mjs render`), never in `remotion.config.ts`:
  a global CRF breaks every ProRes render and a global mute cannot be undone by a flag.
- Every deliverable render passes `--props={"final":true}` (DebugFrame hides) and `--muted`
  unless the style declares `audio: true`. Front mode = ProRes 4444 `yuva444p10le` mov; behind
  mode = h264 crf 14 mp4. The all-intra pass is off by default (`BORUMI_AGENT_ALL_INTRA=1`).
- The designer writes only inside `src/jobs/<id>/` plus the style's Learnings log. The kit
  sync is additive; `styles/*/SKILL.md` and `frames/SKILL.md` in the workspace are preserved,
  so bump `<!-- guide-version: N -->` when you change the shipped text or the change never lands.
- Only `excalidraw`, `n8n` and `leo` ship. Do not promise the upstream `n8n-brand`, `n8n-game`
  or `n8n-ui` styles.

**Files and locations**
- Deliverables go in the user's `<project name> Agent/` folder, never in a temp dir.
  `scripts/lib/paths.mjs` refuses to create anything when the bundle is missing or when
  `/Volumes/<x>` is not a mount point ("mount the drive first").
- No new npm dependencies for the plugin scripts. The kit has its own `package.json`.
- Never write a secret into a doc, a receipt or a log.

## Loading code changes

- `scripts/*` and `skills/*`: read at invocation, nothing to restart. `.mcp.json`: restart the
  session (`/mcp` reconnect `borumi`).
- `animation-kit/*`: the workspace resyncs on the next `node scripts/kit.mjs ensure` (hash
  stamped, additive; delete removed files from `~/.borumi-agent/animation-kit` by hand). Guides
  with a Learnings log need the guide-version bump. Tests read the repo template, not the
  workspace.
- `animation-kit/package.json`: the `.deps-hash` changes and `kit.mjs ensure` runs `npm install`
  again.

## Testing live against a throwaway project

1. Open Borumi, turn on Settings > AI > Enable MCP.
2. `python3 scripts/borumi_mcp.py start &` and wait for `~/.borumi-agent/sess/ready`; then
   `python3 scripts/borumi_mcp.py call create_project '{"name":"plugin-smoke"}'`. The bundle
   lands in `~/Borumi Projects/`.
3. Make a narrated take: `say -o narration.aiff "..."`, an ffmpeg `testsrc` video muxed with it,
   then `begin_project_edit`, `create_scenes` (needs the `scripting` guide), `import_media`,
   `add_segments` take, `commit_project_edit`, `request_transcriptions`, and poll
   `get_project_overview slices ["transcripts"]` until `pending_media_count` is 0.
4. Run the commands from a Claude Code session started with `claude --plugin-dir <this repo>`.
   For a nested `claude -p` from inside a session use `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT claude -p ...`.
5. Probe destructive behaviour inside a transaction you then `abort_project_edit`; the cookbook's
   "Layering, splitting, ripple" section was built that way.
6. Keep every receipt under `<project> Agent/receipts/` and copy new facts into
   `docs/borumi-mcp-cookbook.md` and `skills/borumi-editing/references/borumi-mcp-cookbook.md`
   in the same change.

## Lessons discipline

When a failure costs you a session and you find the fix: one line under the matching heading
above, the full symptom / cause / fix story at the top of the Borumi section in `docs/LESSONS.md`
with the date, and, when it is a Borumi behaviour, the exact JSON in the cookbook. Recurring
operations only; one-off fixes are commit messages.

## Quick symptom index

| Symptom | Cause / fix |
|---|---|
| `app_not_running` on every project tool | Borumi is closed, or MCP is off in Settings > AI. `tools/list` and `get_guides` still answer. |
| `guide_required` | Fetch the named guide on this connection and retry; `borumi_mcp.py` does it once by itself. |
| `unknown_id_alias` | The id was never listed on this connection. `list_open_projects` / `get_scenes` / `get_timeline`, then retry with the ids they returned. |
| `get_timeline` refuses a range | Empty project (`duration_ms` 0). Take the hash from `get_project_overview`. |
| `timeline_layer_not_found` after a delete | The layer's last segment went away. Read without a layer filter. |
| Untargeted trim refused (`invalid_request`, independent edit sets) | Target the narration set: `{"type":"layers","layer_ids":["camera_1","microphone_1"]}`, then each screen layer, then one overlay layer. |
| Layout shortened twice after a silence pass | You trimmed `layout` after the screen trim; layouts follow the screen layer. |
| Animation shows where the recording was | Someone deleted screen content in behind mode. The rule is add on `screen_N` + layout; restore from the bundle. |
| Beats land at half time | The job was not 30 fps. `job.json` must say `fps: 30` (a unit test pins it). |
| Render dies at the timeout lookup or on a font | A font request in a style, or a dropped import; `node scripts/check.mjs` and the inlined-fonts rule. |
| ProRes render throws on `--crf` | A CRF crept into `remotion.config.ts`. Keep codec flags on the command line. |
| Bash tool kills the render at 600 s | Use `job.mjs render` (detached) + `job.mjs wait`, never `--foreground` in a session. |
| `node --test tests/` fails with `'test failed'` | Node 21+ treats the directory as a test file. Use `node --test tests/*.test.mjs`. |
| "mount the drive first" | The project lives on an unmounted volume; `paths.mjs` will not create folders under `/Volumes/<x>` until it is a mount point. |
| Kit change invisible in the workspace | Preserved guide (a Learnings log) without a guide-version bump, or a removed file the additive sync cannot delete. |
