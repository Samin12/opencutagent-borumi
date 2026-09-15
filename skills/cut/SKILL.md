---
name: cut
description: "Borumi: remove one range of footage from the open Borumi project with edge-safe cut points, showing the exact times before anything changes. Triggers: /borumi:cut, cut 1:02-1:14, cut scene 3, remove from 0:41 to 0:49, delete the part where I say X, take this bit out, trim this section out of the video."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:cut

Remove one stretch of the video. Ripple: everything after it moves up. Nothing changes until the preview gets a yes and the commit prompt is accepted. There is no undo through the MCP after a commit; say so once per session.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names below are Borumi's own; the base skill and the Host notes say how the host exposes them.

## Syntax

```
/borumi:cut 1:02-1:14                       project time
/borumi:cut scene 3                         the whole scene
/borumi:cut scene 3 from 0:05 to 0:12       scene-relative
/borumi:cut "the part where I say the three Cs"
/borumi:cut 1:02-1:14 --narration-only      camera and mic only; screen layers and overlays stay where they are
/borumi:cut 1:02-1:14 --exact               no edge snapping or padding
```

Several ranges: run the command once per range, or use `/borumi:silences` and `/borumi:retakes`, which batch ranges.

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `editing_trimming`. Add `editing_transcripts` when the range comes from a phrase, and `editing_synchronization` when a screen layer under the range is its own edit set.

## Procedure

1. Project. `list_open_projects` -> the active project `{id, name, path}` (several open and none active: ask which one, stop). `get_project_overview {project_id, slices:["project","scenes","transcripts"]}` -> `duration_ms`. `get_scenes {project_id}` -> scene bounds and names.
2. Resolve the range to project ms per the base skill. A phrase: `get_transcript {project_id, range:<the scene>, mode:"words"}` and `mode:"blocks"`, saved to receipts, then `node $BORUMI_PLUGIN_ROOT/scripts/segments.mjs find --words <receipts>/words.json --blocks <receipts>/blocks.json --phrase "<text>"`: use `matches[0].range` when `ambiguous` is false; otherwise print the matches with their words and ask which one (one question, stop). A range that crosses a scene boundary is refused: offer one cut per scene. Call the range `[A, B]`.
3. Timeline. Receipts folder: `<dirname(project.path)>/<project name> Agent/receipts/cut-<stamp>/` (write `index.md` first; Write creates the folders). `get_timeline {project_id, range:{start_ms:max(0, A-2000), end_ms:min(duration_ms, B+2000)}, detail:"segments", segment_fields:["all"]}` -> `<receipts>/timeline.json`. From `scenes[].edit_spans` inside `[A, B]` list the active edit sets: the narration set (the `camera_N` + `microphone_N` group), every `screen_N`, the overlay layers (`media_overlay_N`, `text_overlay_N`), `layout`.
4. Edge safety (skipped with `--exact`). `detect_speech {project_id, range:{start_ms:max(0, A-1000), end_ms:B+1000}, activity:"silence", target:{type:"layers", layer_ids:[<the microphone ids from step 3>]}}` -> `<receipts>/silences.json`. Then per edge:
   - a silence gap `[gs, ge]` that contains the edge, or whose midpoint is within 400 ms of it: move the edge into the gap so the kept side keeps air: `A -> gs + min(120, (ge-gs)/2)` and `B -> ge - min(120, (ge-gs)/2)`;
   - no such gap: pad from the words (`get_transcript` mode `words` over `[A-3000, B+3000]` if not read yet): `A -> end_ms of the last word before A + 300` and `B -> start_ms of the first word after B - 250`;
   - never move an edge more than 400 ms from where the user put it, keep `A < B`, stay inside the scene.
   Print what moved: `start 1:02.00 -> 1:01.88 (into a 0.3 s pause)`.
5. Preview, then STOP and wait for a yes:
   ```
   Cut 1:01.9-1:14.2 (12.3s) from Scene 3.
   Last kept: "...and that is the whole pipeline."  |  removed: "So let me, let me try that again ... okay"  |  first kept: "The second piece is..."
   Moves together: camera, mic, screen_1 and 2 overlays (the layout follows the screen). Project 12:04 -> 11:52.
   ```
   With `--narration-only` the third line reads `narration only; screen and overlays stay`. Record the resolved range, the edge moves and the edit sets in `<receipts>/index.md` and write `<receipts>/cuts.json` as `{"ranges":[[A,B]]}`.
6. Transaction. The base skill's trim rules, one `trim_timeline` call per edit set, all `ripple:true`, re-read after each:
   1. `begin_project_edit {project_id}` -> `tx_id`. Re-read the window `[W0, W1]` = `[max(0, A-2000), <end of the scene after this one, or duration_ms>]` with `tx_id`, `detail:"segments"`, `segment_fields:["all"]` -> `<receipts>/before.json` (fresh hash). Use `layers:[...]` only if the window read is refused as too large; on `timeline_layer_not_found` read without the filter.
   2. Narration: `trim_timeline {tx_id, timeline_hash, ranges:[[A,B]], ripple:true, target:{type:"layers", layer_ids:[<camera ids and microphone ids of that set>]}}`. Re-read the same window (new coordinates end at `W1 - (B-A)`) -> `<receipts>/after-narration.json`. Check with the position checker below for those layer ids.
   3. Unless `--narration-only`: each `screen_N` active in `[A,B]`, the same call with `layer_ids:["screen_N"]`; re-read and check that layer. Layouts follow the screen layer: a `layout` segment that overlapped the range must now be shorter or moved with it.
   4. Unless `--narration-only`: when any overlay layer is active in `[A,B]`, one call with `layer_ids:[<one overlay layer id>]` (overlays ripple as one group); re-read and check every overlay layer.
   5. `layout` only if a layout still sits at its old position after the screen trims (a layout with no screen underneath): one call with `layer_ids:["layout"]`. Otherwise leave it alone.
   6. A layer that disagrees with the expected positions: `abort_project_edit`, write the mismatch to `<receipts>/index.md`, report which layer, stop. No partial commits.
   7. `duration_ms` after the trims: old duration minus `(B - A)` when every set moved. With `--narration-only` the duration only shrinks when narration was the longest content in the scene; the position check is the proof.
   8. One look at the seam: `inspect_timeline {tx_id, range:{start_ms:max(0, A-34), end_ms:A+34}, view:{type:"render"}, presentation:"frames", quality:"low", sampling:{type:"uniform", max_frames:2}, save:true, include_images:false}` and Read both frames: kept footage on both sides, no black.
   9. `commit_project_edit {tx_id, change_summary:"Cut 12.3 s (1:01.9 to 1:14.2) from Scene 3 across camera, mic and screen."}`. The permission prompt is the approval; declined means abort and stop.
7. Verify after the commit: `get_project_overview {project_id, slices:["project","scenes"]}` -> the new `duration_ms` and scene bounds match the expectation.
8. Chapters. If `<project name> Agent/chapters/chapters.json` exists and any chapter starts after `A`: `node $BORUMI_PLUGIN_ROOT/scripts/chapters.mjs shift --chapters <that file> --cuts <receipts>/cuts.json`, then run `/borumi:chapters <that file>` so the cards and `youtube-chapters.txt` match the new times (cards moved with the overlays only when overlays were trimmed; the file must match either way). Tell the user this happened.
9. Report: `Cut 12.3s from Scene 3 (1:01.9-1:14.2). Project 12:04 -> 11:52.` plus the two seam frame paths. End with the next action.

## The position checker (used by /borumi:cut, /borumi:silences and /borumi:retakes)

Expected segments after ripple cuts on one layer: every kept span `[a, b]` of an old segment maps to `[a - removedBefore(a), b - removedBefore(b)]`. Content layers (camera, mic, screen) split into one piece per kept span, verified: a camera clip `0-9500` cut at `1000-2000` becomes `0-1000` and `1000-8500`. Overlay and control layers shrink instead: an overlay `500-2500` becomes `500-1500`. The checker compares the fresh read with that expectation:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { mergeRanges, makeRemovedBefore, keepSpans } from "'"$BORUMI_PLUGIN_ROOT"'/scripts/lib/intervals.mjs";
const [beforeF, afterF, cutsF, layerList, w0, w1] = process.argv.slice(1);
const J = (f) => JSON.parse(readFileSync(f, "utf8"));
const before = J(beforeF), after = J(afterF), cuts = mergeRanges(J(cutsF).ranges), rb = makeRemovedBefore(cuts);
const map = ([a, b]) => [a - rb(a), b - rb(b)];
const layerOf = (tl, id) => tl.layers.find((l) => l.id === id) || { category: "content", segments: [] };
const lo = Number(w0), hi = Number(w1), nlo = lo - rb(lo), nhi = hi - rb(hi);
let bad = 0;
for (const id of layerList.split(",")) {
  const L = layerOf(before, id), expected = [];
  for (const s of L.segments) {
    if (s.end_ms <= lo || s.start_ms >= hi) continue;
    const kept = keepSpans(s.start_ms, s.end_ms, cuts);
    if (!kept.length) continue;
    if (L.category === "content") kept.forEach((k) => expected.push(map(k)));
    else expected.push(map([kept[0][0], kept[kept.length - 1][1]]));
  }
  const got = layerOf(after, id).segments.map((s) => [s.start_ms, s.end_ms]).filter(([a, b]) => b > nlo && a < nhi);
  expected.sort((x, y) => x[0] - y[0]); got.sort((x, y) => x[0] - y[0]);
  const same = expected.length === got.length && expected.every((r, i) => Math.abs(r[0] - got[i][0]) <= 1 && Math.abs(r[1] - got[i][1]) <= 1);
  console.log(`${same ? "ok      " : "MISMATCH"} ${id} expected ${JSON.stringify(expected)} got ${JSON.stringify(got)}`);
  if (!same) bad++;
}
process.exit(bad ? 1 : 0);
' <receipts>/before.json <receipts>/after-narration.json <receipts>/cuts.json camera_1,microphone_1 <W0> <W1>
```

`before.json` is the read taken right after `begin_project_edit`; run the checker after every trim call with that call's layer ids and the newest read. Exit 1 means abort. A `layout` that was cut twice (once with its screen, once on its own) shows up here as a MISMATCH on `layout`, which is the drift this rule exists to catch.

## Failure handling

Every error goes to `<receipts>/index.md` (which call, the arguments, the error text) before it is reported; then act on the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked. A trim that did not verify is never reported as done.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>` (for example `mcp__plugin_borumi_borumi__trim_timeline`). `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate.
- Codex or any host without the plugin MCP: run the same calls through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once; a transaction lives on that connection), and ask for a yes in chat before `commit_project_edit`.
