# Design rules for a visualize job

Distilled from the kit rulebook (`~/.borumi-agent/animation-kit/GUIDE.md`, shipped at `$BORUMI_PLUGIN_ROOT/animation-kit/GUIDE.md`). Read the rulebook itself and the style guide before the first job of a session; this page is the checklist. The workspace is `~/.borumi-agent/animation-kit` (`BORUMI_AGENT_HOME` overrides); `kit.mjs path` prints it.

## Where the guides live (workspace copies, never the plugin's)

- `GUIDE.md`: the rulebook (engine, background modes, gotchas).
- `styles/<style>/SKILL.md`: the look, the non-negotiables, the style's own components, and its Learnings log. `excalidraw` (hand-drawn dark whiteboard, violet accent, the default), `n8n` (the same engine in n8n's pink brand, workflow nodes and connectors), `leo` (a 16-bit pixel presenter with word-timed lip sync from `words.json`, not hand-drawn). `kit.mjs styles` lists them, including custom styles the user dropped into the workspace.
- `frames/SKILL.md`: the frame-aware workflow for `--frames` jobs (contact sheets, `frames-map.json`, `anchors.json`, the time budget table, `<DebugFrame>`).
- The style guide wins on look. When a style says it is not hand-drawn (leo), the sketch primitives are off limits.

## Hard rules (verbatim in spirit from the rulebook)

1. Only create or edit files inside your job folder, `src/jobs/<jobId>/`. Never touch `src/jobs/manifest.ts`, `src/Root.tsx`, the engine (`src/sketch|theme|animation|components`), configs, or other jobs. One exception: a reusable correction from the user goes into the style's Learnings log (`styles/<style>/SKILL.md`), one dated terse line.
2. Duration, fps (30), width and height are fixed by the job. Fill exactly `durationInFrames`; read them with `useVideoConfig()`. Never pad or trim.
3. Silent. Never add `<Audio>`; the narration plays on the Borumi timeline under the clip and every render is muted and stripped unless the style declares audio.
4. Frame-pure and seeded: every animated value is a function of `useCurrentFrame()`. No `Math.random`, `Date.now`, `useState` for animation, CSS transitions. Every rough.js shape carries a fixed `seed` (`SEEDS` or `seedFor`), memoized with `useMemo`, or it boils between frames.
5. No em dashes in on-screen text. Comma, colon or period.
6. Sync to the narration: `brief.md` lists the words with times relative to t=0; land beats on the words they illustrate with `SEC(seconds)` (real seconds to frames). A beat needs at least 2 s to read; a few strong beats beat many rushed ones.
7. Behind mode (solid): the presenter's camera covers the bottom-right of the canvas (x >= 0.775, y >= 0.715). Keep essential content out of that rectangle. The brief carries this line; treat it as a hard rule.
8. Front mode (transparent): start with `<Canvas transparent>` (or the style canvas with `transparent`), leave real transparency where the footage should show, keep strokes and text big and high-contrast. Overlays render above the camera, so never put a solid block over the bottom-right either.
9. When a version works, write `render.json` (below). Only then is it rendered.

## The engine (import, do not modify)

- `../../sketch`: `SketchCircle/Ellipse/Rect/Line/Path/Polygon/Arrow/LoopArrow/DashedRect/Text`, `ScribbleFill`; all take `seed`, colours, `drawIn={{ delay, duration }}` in frames.
- `../../theme/tokens` (all colours, fonts, sizes; never hardcode a hex), `../../theme/timing` (`SEC`, `SCENE`, `BEAT`), `../../theme/seeds`, `../../theme/springs`.
- `../../animation`: entrances (Rise, Pop), stagger, typing, camera.
- `../../components`: `Canvas` (`transparent`, `dotGrid`, `bg`), `SketchLayer`, `NodeCard`, `ConnectionLine`, `StickyNote`, `Callout`, `Title`, `Label`, `Badge`, `BulletList`, `DotGrid`, `DebugFrame`.
- Style components: `../../../styles/<style>/src` (n8n: `n8n` theme, `SketchNode`, `SketchConnector`, `ChatScene`; leo: `Leo`, `LeoCorner`, `PixelPanel`).

## The job folder

`src/jobs/<jobId>/`: `brief.md` (read first), `words.json` (`[{text,start,end?}]` seconds from t=0, always present, empty for raw jobs), `job.json` (id, fps 30, width, height, durationInFrames, background, style), `Scene.tsx` (scaffold to replace; default export, no props), `refs/` (reference images: Read them whenever they exist), `render.json` (yours), and for frames jobs `frames-map.json` and `anchors.json`. Footage frames for frames jobs sit in `public/frames/<jobId>/full/` with sheets in `sheets/`.

## Verify before declaring a version done (all through `job.mjs`, so `Bash(node:*)` covers them)

| Command | What it does |
|---|---|
| `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs typecheck` | `tsc --noEmit` over the workspace; must be clean. |
| `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs still <jobId> --frame N [--out <png>]` | Renders one frame to a PNG (default `src/jobs/<jobId>/check.png`). Pick meaningful frames: mid-draw, fully composed, near the end. Read the PNG and judge it: text inside the safe margin, nothing under the camera rectangle (behind), strokes legible on footage (front). |
| `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs anchors <jobId>` | Frames jobs only: runs the kit's `check-anchors` over `anchors.json`, writes a sheet per anchor, prints `{status: "ok"|"warn"|"fail"|"missing"|"none"}` with the per-anchor results. `fail` (including an anchor inside the camera keep-out) blocks the render; `missing` means a frames job without `anchors.json`. |
| `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs sheet <file or jobId> [--out <png>]` | A 6-frame contact sheet of a render (ffmpeg); the iteration loop shows it before asking to place. |
| `node $BORUMI_PLUGIN_ROOT/scripts/job.mjs probe <file>` | ffprobe JSON of a render (duration, codec, pixel format). |

Frames jobs also use the kit's own `node scripts/grab-frames.mjs <jobId> <from> <to> [--crop x,y,w,h]` from the workspace, and `<DebugFrame src="frames/<jobId>/full/tNNNN.NN.png" />` as the first child of `<Canvas transparent>` to see a drawing on its target in a still (it renders nothing in the final clip).

## The render.json protocol

```json
{ "version": 1, "notes": "what changed in this version", "title": "Webhook branches" }
```

- `version` is a positive integer. Version 1 means "ready to render"; each design turn bumps it (2, 3, ...). `job.mjs render` refuses a version that was already rendered unless `--force`; `job.mjs signal <id>` reports `{version, notes, title, pending}`.
- `title`: 2 to 3 plain words, 20 characters max; it labels the animation in `job.mjs list`.
- Do not bump the version for an unfinished draft or when only answering a question.
- Never render the final video with the Remotion CLI yourself; `job.mjs render` chooses the encoder (h264 crf 14 mp4 for solid, ProRes 4444 with alpha for transparent), mutes, strips audio, checks the duration and writes the deliverable next to the project.

## Gotchas (from the rulebook and the Learnings logs)

- Unseeded rough shapes boil; memoize generated strokes with `useMemo`.
- Gate always-on details (handles, labels) to appear with their parent's draw-on.
- `NodeCard` and `BulletList` text is not gated by `drawIn`: wrap staged builds in `<Sequence from={...}>` or compose with delayed `SketchText`.
- Springs are front-loaded; use `interpolate` plus easing for deliberate moves, springs for pops.
- Camera moves: ease every channel (`smoothstep`), geometric zoom (`z0 * (z1/z0)^t`), never linear.
- Curling loop arrows need `SketchLoopArrow`, not `SketchArrow`.
- Fonts are loaded through `src/theme/fonts.ts`; a render must never make a font request.
- Long ranges: fewer, stronger beats. Keep holds alive with a subtle pulse.
- Leo: never hand-time mouth shapes; pass `words.json` straight in, and `timeOffset` when he lives inside a `<Sequence>`.
