# borumi

A Claude Code plugin that edits your Borumi project from the terminal.
Borumi records your camera, screen and microphone as separate layers and ships its own MCP
server; this plugin puts slash commands on top of it. The headline command designs a Remotion
animation for one stretch of your narration, renders it locally, and places it inside the open
project, behind your camera or in front of it. Around that it covers the rest of a talking-head
edit: cutting a range, removing silences and retakes, inserting b-roll, chapter cards with a
YouTube chapters file, captions, inspection and export. Every change goes through Borumi's own
transactions, previewed before it is committed. The animation kit and the editing rules come from
[OpenCutAgent](https://github.com/leonardogrig/opencutagent) (see `NOTICE.md`).

## The flagship in three lines

```
/borumi:visualize scene 3                      # animate the narration of scene 3, placed behind the camera
/borumi:visualize "where I explain the three Cs" --mode front   # transparent overlay on top of the footage
/borumi:visualize say "make the arrows pink"    # iterate; v2 renders, you approve, it replaces v1
```

## Install

From the marketplace:

```
claude plugin marketplace add Samin12/samin-plugins
claude plugin install borumi@samin-plugins
```

From a local clone (development, or to try it without the marketplace):

```
git clone https://github.com/Samin12/opencutagent-borumi.git
claude --plugin-dir /path/to/opencutagent-borumi
```

The plugin root is the repository root. Nothing is compiled; the animation kit installs its own
dependencies into a workspace outside the plugin on first use.

## Prerequisites

- macOS. Borumi is a Mac app and its MCP server is the app binary.
- **Borumi 0.30.5 or newer**, with Settings > AI > Enable MCP switched on, and the project you
  want to edit open in the app. With the app closed the plugin can list tools and guides, nothing
  else.
- **Node 18 or newer** for the plugin scripts. Remotion runs on the same Node.
- **ffmpeg** on the PATH (`brew install ffmpeg`): contact sheets, probes and the remux after a
  render.
- **Claude Code** signed in. The MCP tools are named `mcp__plugin_borumi_borumi__<tool>` inside a
  session.

## First run

```
/borumi:setup --install
```

`setup` runs `scripts/doctor.sh`: one `[ok]`, `[did]`, `[fix]` or `[note]` line per check (macOS,
Node, ffmpeg, Borumi version, MCP enabled, the kit workspace with Remotion and its headless
Chrome, the `claude` CLI). `--install` also copies the animation kit to `~/.borumi-agent/animation-kit`,
runs `npm install` there and downloads Remotion's browser, so the first `/borumi:visualize` does
not stall on a several-hundred-megabyte download. Every `[fix]` line names the exact command to
run; the script never installs system software itself.

## Commands

| Command | What it does | Example |
|---|---|---|
| `/borumi:visualize` | Design, render and place an animation for a scene, a range or a sentence | `/borumi:visualize scene 3 from 0:05 to 0:12 --style n8n` |
| `/borumi:cut` | Remove a range, snapping the edges into the nearest silence | `/borumi:cut "where I say let me start over"` |
| `/borumi:silences` | Detect silences, preview the list, trim them in one targeted call | `/borumi:silences scene 2 --pacing brisk` |
| `/borumi:retakes` | Sentence segments, the serial-restart rubric, keepers and cuts, then trim | `/borumi:retakes scene 1` |
| `/borumi:insert` | Import an image, video or audio file at a time, in front or behind the camera | `/borumi:insert ~/shots/dashboard.png at 1:23 --for 4s` |
| `/borumi:chapters` | Chapter cards in your card style plus `youtube-chapters.txt` | `/borumi:chapters auto` |
| `/borumi:captions` | A captions segment from Borumi's transcript with a template | `/borumi:captions all --template boxed` |
| `/borumi:inspect` | Scenes table, transcript blocks, or a contact sheet of a range | `/borumi:inspect frames 1:00-1:20` |
| `/borumi:export` | Export video, audio or transcript, with a phone-size copy on request | `/borumi:export scene 3 --preset best --phone` |
| `/borumi:open` | List, open and focus projects | `/borumi:open "Astra launch"` |
| `/borumi:setup` | Doctor report; `--install` prepares the animation kit | `/borumi:setup --install` |

Times are project time (`1:23`, `1:23.5`, `83s`, `1m23s`); inside `scene N from A to B` they are
scene-relative, and every resolved range is printed both ways before anything runs. Every
mutating command previews what it will change in plain words with exact times, waits for your
yes, then runs one small Borumi transaction and verifies the timeline afterwards.

## How visualize works

1. **Resolve.** The scene, range or matched sentence becomes a project-time range. Bare
   `/borumi:visualize` uses Borumi's current selection, else the scene under the playhead.
2. **Gather.** Word timings for the range, the transcript of the scene and its neighbours for
   context, the scene Script (an `(ANIMATION: ...)` beat there becomes the brief), the canvas
   size, and the layers already present. A job folder is created in the kit workspace with a
   `brief.md`, `words.json` and a `Scene.tsx` scaffold.
3. **Design.** The session (or the `animator` subagent with `--delegate`) writes `Scene.tsx`
   under the kit's rules: fixed duration, frame-pure, seeded, silent, one of the shipped styles
   (`excalidraw` hand-drawn whiteboard, `n8n` sketch, `leo` pixel presenter). It typechecks,
   renders stills, looks at them, and writes `render.json`.
4. **Render.** `job.mjs render` runs Remotion in the background and polls: h264 mp4 for behind
   mode, ProRes 4444 with alpha for front mode. Always 30 fps; Borumi conforms the clip.
5. **Place.** One transaction: import the file, add it, verify with rendered frames, commit.

**Behind** (the default): the render becomes a screen take for the range and a custom layout puts
it full frame with your camera pinned bottom-right (the measured rectangle from your approved
edits). Your recording is never deleted: if the screen layer already has content there, Borumi
puts the animation on the next screen layer and the layout points at it. On a non-landscape
canvas the plugin uses Borumi's corner layout instead.

**Front** (`--mode front`, or when you say overlay, on top, in front): the render is a full-frame
media overlay with alpha above every layer, camera included. With `--frames` the designer also
gets Borumi's own frames of the composite and must anchor every drawing to what is really on
screen, with the camera corner kept clear.

**Iterate.** Any follow-up message while a job is current is a design turn on it (`say "..."`
disambiguates). Each new version renders, shows a six-frame contact sheet and the file path, and
asks one question: place it? On yes the old pieces are removed and the new ones placed in the
same transaction. `render` re-renders the current version, `again` repeats the last instruction,
`list` and `show` read the jobs, `remove` takes a placed animation out of the project and puts
back anything it displaced, `discard` removes the job from the kit and keeps the rendered files.

## Where files land

- **Deliverables:** `<project name> Agent/` next to the `.bmprojbundle` (on the same drive as
  the project), with `animations/<jobId>/` (job record, log, brief copy, `Scene.tsx` history,
  every render as `<jobId>-v<N>.mp4|.mov`, verification frames, Borumi receipts), `exports/`,
  `chapters/` and `receipts/`. `BORUMI_AGENT_OUT` overrides the parent directory. The plugin
  refuses to create anything when the bundle is missing or its drive is not mounted.
- **Kit workspace:** `~/.borumi-agent/animation-kit` (`BORUMI_AGENT_HOME` moves it): the
  Remotion project, `node_modules`, job folders under `src/jobs/`, frames under `public/frames/`.
  Custom styles go in its `styles/` folder. `~/.borumi-agent/current.json` remembers the current
  job per project and `~/.borumi-agent/cache/` holds inspect-frame copies.
- **Inside the bundle:** every placed render is copied into the project by Borumi's import.

## Using it from Codex or a script

`scripts/borumi_mcp.py` is a persistent stdio client for Borumi's MCP server. Start one daemon,
call tools by name with JSON arguments, stop it; a missing guide is fetched once and the call
retried.

```
python3 scripts/borumi_mcp.py start &
python3 scripts/borumi_mcp.py call list_open_projects '{}'
python3 scripts/borumi_mcp.py call get_scenes '{"project_id":"a56d"}'
python3 scripts/borumi_mcp.py stop
```

Every id a call returns must first be seen on that same daemon session, and a transaction lives
on one connection; the skills say the same thing for Claude Code sessions. Batch placements for
Codex run through `scripts/place.py` on one daemon session, after you approve the plan.

`scripts/install-codex.sh` installs the same skills for the Codex CLI (`--clone` fetches the
repo into `~/.codex/skills/borumi`, `--mcp` registers the Borumi MCP server with
`codex mcp add borumi`, `--check` reports only). It prints the same `[ok]` / `[fix]` lines as the
doctor. In Codex the skills are invoked by name, for example
`$borumi-visualize scene 3 of my open Borumi project, placed behind my camera`; the skill text
then drives Borumi through `borumi_mcp.py` and runs placements through `place.py` after you
approve the plan.

## Deferred to v0.2

Moving clips, screen and camera zooms, cursor styles, and writing `(ANIMATION: ...)` beats back
into the scene Script (reading them works today).

## Safety

- Nothing changes in your project until you approve the commit: Claude Code's permission prompt
  carries Borumi's own one-sentence change summary, and cut, silence and retake commands show
  their preview and wait for a yes before the transaction even begins.
- Borumi's MCP has no undo after a commit. Transactions are small on purpose; a bad result is
  fixed with another transaction, and `/borumi:visualize remove` puts back what a placement
  displaced.
- Every placed render is copied into the project bundle by Borumi's import and the MCP cannot
  delete media, so superseded versions stay in the bundle until you clean up in Borumi.
- Trims are targeted per edit set (narration, then each screen layer, then overlays) and the
  timeline is re-read after every call; on any mismatch the transaction is aborted, never half
  committed.
- Renders run on your machine with Remotion and a headless Chrome the kit downloads once. The
  animation designer writes code only inside its job folder in the kit workspace.

## Docs

- `docs/ARCHITECTURE.md`: how a session, the scripts, the kit workspace and Borumi fit together.
- `CONTRIBUTING.md`: development setup, tests, the live verification checklist.
- `CLAUDE.md`: the working rules for anyone editing this repository with Claude Code.
- `docs/LESSONS.md`: dated lessons, Borumi first, the Premiere-era history below.
- `docs/borumi-guides/`: Borumi's own MCP guides and `tools.json`, as fetched on 2026-09-15.

## License

MIT with the Commons Clause, inherited from OpenCutAgent (see `LICENSE` and `NOTICE.md`). Free
to use, change and share for yourself or your team; not for sale, and not as the substance of a
commercial product or service. Remotion has its own license for larger companies.
