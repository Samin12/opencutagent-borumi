# Contributing to the borumi plugin

This page covers the repository layout, how to run and test each part, the live verification
checklist, and the conventions that keep the plugin healthy.

## Repo layout

```
opencutagent-borumi/                 plugin root = repo root
├── .claude-plugin/plugin.json       plugin identity (name borumi, version, description)
├── .mcp.json                        Borumi's MCP server (stdio, the app binary with `mcp`)
├── skills/                          one folder per slash command
│   ├── borumi-editing/              shared base: transactions, guide gating, time parsing, output rules
│   │   └── references/              borumi-mcp-cookbook.md, segment-schemas.md, treatment.md
│   ├── visualize/                   the flagship; references/ has the placement routine and script markers
│   ├── cut/ silences/ retakes/ insert/ chapters/ captions/ inspect/ export/ open/ setup/
├── agents/animator.md               optional designer subagent for --delegate and batch runs
├── scripts/
│   ├── job.mjs                      job lifecycle: create, signal, render (detached), wait, still, anchors, placed, remove...
│   ├── kit.mjs                      template -> ~/.borumi-agent/animation-kit sync, npm install, browser download
│   ├── frames.mjs                   frames-map v2 from Borumi inspect frames (or ffmpeg from a media file)
│   ├── segments.mjs                 Borumi words -> sentence segments -> cut ranges with edge padding
│   ├── chapters.mjs                 chapters.json -> youtube-chapters.txt + text_overlay additions
│   ├── placement.mjs                the placement planner (behind / front / remove / re-place steps)
│   ├── doctor.sh                    [ok]/[did]/[fix]/[note] report; --install prepares the kit
│   ├── borumi_mcp.py                persistent stdio client for Codex and batch runs; place.py runs a plan on it
│   ├── install-codex.sh             installs the skills for the Codex CLI; gen-openai-yaml.mjs writes its skill metadata
│   ├── check.mjs                    syntax + missing-import scan over every .js/.mjs
│   └── lib/                         pure modules: paths, intervals, fmt, silence, brief, render, transcript, tools,
│                                    and borumi_client.py (the Python session client place.py builds on)
├── animation-kit/                   the vendored Remotion kit (GUIDE.md is the designer's rulebook)
├── tests/                           *.test.mjs (pure, no Borumi) + smoke.mjs (needs Borumi) + fixtures/
└── docs/                            ARCHITECTURE.md, LESSONS.md, borumi-mcp-cookbook.md, borumi-guides/
```

## Setup

```bash
git clone https://github.com/Samin12/opencutagent-borumi.git
cd opencutagent-borumi
claude --plugin-dir "$PWD"      # a session with the plugin loaded from this clone
```

Requirements for the full loop: macOS, Borumi 0.30.5+ with Settings > AI > Enable MCP on, Node 18+,
ffmpeg, the `claude` CLI signed in. `/borumi:setup --install` (or `bash scripts/doctor.sh --install`)
prepares the kit workspace at `~/.borumi-agent/animation-kit`: `npm install` for Remotion and the
one-time headless Chrome download happen there, never in the repo.

The plugin scripts have no npm dependencies and there is no `npm install` at the repo root. The
`package.json` scripts are shortcuts:

```bash
npm test          # node --test tests/*.test.mjs
npm run check     # node scripts/check.mjs
npm run smoke     # node tests/smoke.mjs (needs the Borumi binary)
npm run doctor    # bash scripts/doctor.sh
npm run kit       # node scripts/kit.mjs ensure
```

## Tests

```bash
node scripts/check.mjs            # parses every .js/.mjs and flags calls to exported names a file never imports
node --test tests/*.test.mjs      # unit tests against the fixtures; no Borumi, no ffmpeg, no network
node tests/smoke.mjs              # spawns `borumi mcp` over stdio and asserts the tool names in scripts/lib/tools.mjs
claude plugin validate .          # manifest and skill frontmatter
```

Pass the shell glob, not the directory: on Node 21 and newer `node --test tests/` treats
`tests/` as a test file and fails. CI (`.github/workflows/test.yml`) runs the check and the unit
tests on macOS with Node 20 and 22.

**Every pure function belongs in a test.** The edit math (interval merging, removed-before
remapping, sentence segmentation, chapter timing, duration and size rules, placement planning)
lives in pure functions precisely so it can be tested without Borumi. `tests/fixtures/` holds
real responses captured from Borumi 0.30.5 on 2026-09-15 (`timeline-*.json`,
`inspect-frames-max.json`, `transcript-*.json`, `silences.json`, `scenes.json`,
`import-media.json`, `overview-canvas.json`); write new tests against those shapes and add a new
fixture when you capture a new one. `tests/docs.test.mjs` guards the documentation (no em dashes,
the frames guide version, the notice).

## Live verification checklist

Run this before a release, on a throwaway project (see `CLAUDE.md`, "Testing live against a
throwaway project"), and keep the receipts under `<project> Agent/receipts/`:

1. `tests/smoke.mjs` green; `claude plugin validate .` clean.
2. A synthetic narrated take (`say` voice + ffmpeg `testsrc`) imported, transcribed
   (`request_transcriptions`, poll the `transcripts` overview slice).
3. `/borumi:visualize` behind mode on a camera-only scene: job created from real words, a real
   `Scene.tsx`, detached render, placement (take on `screen_N` + pinned-camera layout), commit,
   `get_timeline` shows the take at `start_ms`, verification frames viewed, export plays.
4. Behind mode over a mid-scene sub-range whose `screen_1` is occupied: the take lands on
   `screen_2`, nothing recorded is deleted, an existing layout is split and its inner piece
   recorded in `placed.replaced_layouts`.
5. Front mode (`--mode front`): ProRes 4444 alpha overlay, camera visible through the transparent
   areas; with `--frames`, the frames map carries `keepOut` and `check-anchors` FAILs an anchor
   inside it.
6. `say "..."` iteration: v2 renders, the contact sheet shows, the question is asked once, on yes
   v1's pieces are removed and v2 placed in one transaction. Then `remove` restores what v1
   displaced.
7. `/borumi:chapters auto`, then `/borumi:silences` (targeted, multi-range in one call, duration
   drop equals the sum), then `/borumi:cut` on the same project; chapters re-timed after the trim.
8. A targeted multi-set trim with overlays downstream: overlays ripple together, the layout is
   not double-cut, every layer matches `t - removedBefore(t)`.
9. When the external drive is mounted: `duplicate_project` a real recording and repeat 3 to 6
   (recorded takes can group camera, mic and screen differently from imported files).
10. Install path: push, update the marketplace entry, `claude plugin install borumi@samin-plugins`,
    `claude plugin details borumi`, and a `claude -p` session (run with
    `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT` from inside a session) lists the `/borumi:*` skills.

Note in the pull request which of these ran live and which only ran through tests.

## Conventions

- **ES modules only** (`.mjs`), Node 18 compatible, no new npm dependencies for the plugin
  scripts. Scripts print JSON to stdout and logs to stderr, and every failure path writes to the
  job log (`log.jsonl`) before it propagates.
- **Long work detaches.** The Bash tool inside Claude Code kills a command after 600 s.
  Anything that can run longer forks, writes a status file atomically, and is polled
  (`job.mjs render` + `job.mjs wait`, `kit.mjs ensure --detach` + `kit.mjs wait`).
- **Borumi discipline** as written in `CLAUDE.md`: guides before tools, ids observed on the
  current connection, one transaction per result, hashes re-read, targeted trims, behind mode
  never deletes, `commit_project_edit` never in an allowlist.
- **Copy:** no em dashes anywhere (docs, skills, scripts, on-screen text). Plain language. The
  final message of a command is for a video editor. Durations through `fmtDur`, elapsed time
  through `fmtElapsed`.
- **Deliverables** land in `<project name> Agent/` next to the bundle; temp directories hold
  only intermediates.
- **Skills:** frontmatter `name`, `description` starting with "Borumi:", `allowed-tools` in the
  colon form (`Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__*`),
  `disable-model-invocation: true` on mutating commands, `user-invocable: false` on the base
  skill. Body under about 250 lines; details go in `references/`. Every skill starts by loading
  `borumi-editing`.
- **Kit:** never set codec knobs in `remotion.config.ts`; keep the designer's write boundary
  (`src/jobs/<id>/` plus the Learnings log); bump `<!-- guide-version: N -->` when you change a
  preserved guide; keep fonts inlined.
- **Adding a style:** a folder under `animation-kit/styles/<id>/` with `style.json` (`id` equal
  to the folder name), a `SKILL.md` ending in a Learnings log, optional `src/index.ts`. Custom
  styles for one machine go in the workspace's `styles/` folder instead.
- **Adding a command:** a skill folder, a line in the README table, an entry in
  `docs/ARCHITECTURE.md`, and tests for any pure logic it introduces.

## Recording lessons

When you hit a new failure mode and find the fix: one line under the matching heading in
`CLAUDE.md`, the full symptom / cause / fix story with the date at the top of the Borumi section
of `docs/LESSONS.md`, and, for a Borumi behaviour, the exact JSON in
`docs/borumi-mcp-cookbook.md` and the skill copy under `skills/borumi-editing/references/`.
A lesson written once is never re-learned the hard way.

## Pull requests

- Keep `node scripts/check.mjs` and `node --test tests/*.test.mjs` green.
- A change to the placement planner, the trim routine or the render command line needs a test
  that pins the new behaviour, and a live run on a throwaway project before release.
- Say in the description what ran live and what did not.
- No em dashes in the diff.
