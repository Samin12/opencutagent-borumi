---
name: silences
description: "Borumi: detect the dead air in a scene or the whole open Borumi project, preview the cut list with totals, and remove the silences in one targeted trim per edit set. Triggers: /borumi:silences, remove silences, cut the dead air, tighten the pacing, remove the pauses in scene 2, make it brisker, cut the gaps."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:silences

Loudness-free silence removal on Borumi's own speech detection (`detect_speech`), targeted at the microphone layers. Preview with totals, then one trim call per edit set, verified position by position. Nothing changes before the yes and the commit prompt.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:silences                         the whole project, scene by scene
/borumi:silences scene 3
/borumi:silences scene 3 --min-ms 700 --keep-ms 150
/borumi:silences all --pacing brisk
/borumi:silences scene 3 --narration-only
```

Controls:
- `--min-ms` (default 700): only silences at least this long are cut.
- `--keep-ms` (default 150): air left on each side of a cut, so words never lose their first or last letters. Not applied on a side that touches a scene edge (nothing to protect there).
- `--pacing relaxed|natural|balanced|brisk|rapid` sets both from the presets: relaxed 1000/200, natural 700/170, balanced 500/150, brisk 300/120, rapid 120/80. A preset overrides the two flags.
- `--narration-only`: cut camera and mic only; screen layers and overlays stay (the synchronization case).

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `editing_trimming`; `editing_synchronization` when a screen layer is its own edit set under the ranges.

## Procedure

1. Project and scope. `list_open_projects` -> the active project (several open and none active: ask which, stop). `get_project_overview {project_id, slices:["project","scenes"]}` and `get_scenes {project_id}`. Scope = the named scene, or every scene when omitted or `all`. Receipts: `<dirname(project.path)>/<project name> Agent/receipts/silences-<stamp>/` (write `index.md` first).
2. Layers. `get_timeline {project_id, range:<scope>, detail:"summary"}` -> `<receipts>/timeline-summary.json`: the microphone layer ids (`kind:"microphone"`), and from `scenes[].edit_spans` the edit sets active in the scope (narration set, `screen_N`, overlays, `layout`). Long projects: one read per scene.
3. Detect, per scene in scope: `detect_speech {project_id, range:{start_ms:<scene start>, end_ms:<scene end>}, activity:"silence", target:{type:"layers", layer_ids:[<microphone ids>]}}` -> append every range to `<receipts>/silences.json` as `{"ranges":[[s,e], ...]}` (project ms; the leading and trailing edges are included by Borumi).
4. Cut list. The rule (implemented in `scripts/lib/silence.mjs previewSilences`): keep silences `>= min`, shrink each by `keep` on both sides except on a side that touches a scene edge or the scope edge, merge touching results. Run it once for the scope:
   ```bash
   node --input-type=module -e '
   import { readFileSync, writeFileSync } from "node:fs";
   import { previewSilences, pacingToMinKeep } from "'"$BORUMI_PLUGIN_ROOT"'/scripts/lib/silence.mjs";
   const [silF, outF, pacing, minMs, keepMs, rangeStart, rangeEnd, edges] = process.argv.slice(1);
   const p = pacingToMinKeep(pacing) || { minMs: Number(minMs), keepMs: Number(keepMs) };
   const r = previewSilences(JSON.parse(readFileSync(silF, "utf8")).ranges, { minMs: p.minMs, keepMs: p.keepMs, rangeStart: Number(rangeStart), rangeEnd: Number(rangeEnd), sceneEdges: edges ? edges.split(",").map(Number) : [] });
   writeFileSync(outF, JSON.stringify(r, null, 1));
   console.log(JSON.stringify({ count: r.count, totalMs: r.totalMs, pct: r.pct, longest: r.longest, top5: r.top5, minMs: r.minMs, keepMs: r.keepMs }));
   ' <receipts>/silences.json <receipts>/cuts.json "<pacing or ->" 700 150 <scope start> <scope end> "<every scene start and end in the scope, comma separated>"
   ```
   `<receipts>/cuts.json` carries `ranges` in project ms: that is the trim list and the input to the position checker and to `chapters.mjs shift`. Nothing to cut (`count` 0): say so and stop.
5. Preview, then STOP and wait for a yes. One summary line plus the five longest; the full list is in `<receipts>/cuts.json` and is shown only on request ("show all", capped at 200 rows in chat):
   ```
   Scene 3: 43 silences, 38.2s (12%), longest 2.1s at 1:04; camera, mic and screen cut together (overlays: 2 cards move).
   Longest: 1:04 2.1s | 3:12 1.8s | 0:41 1.6s | 2:50 1.5s | 5:07 1.4s
   Project 12:04 -> 11:26.
   ```
   With `--narration-only`: `narration only; screen and overlays stay`. Whole project: one summary line per scene and a total.
6. Transaction. One `trim_timeline` call per edit set with ALL ranges of the scope (Borumi applies them in original coordinates; never shift them yourself), in the base skill's order, re-reading after each call:
   1. `begin_project_edit {project_id}` -> `tx_id`; re-read the scope window `[W0, W1]` = `[<scope start>, <scope end>]` (plus the next scene's start when the scope is not the whole project) with `tx_id`, `detail:"segments"`, `segment_fields:["all"]` -> `<receipts>/before.json`. Too large: one read per scene, check per scene.
   2. Narration: `trim_timeline {tx_id, timeline_hash, ranges:<cuts.json ranges>, ripple:true, target:{type:"layers", layer_ids:[<camera ids and microphone ids of the narration set>]}}`. Re-read -> `<receipts>/after-narration.json`. Run the position checker from `/borumi:cut` ("The position checker") with those layer ids over `[W0, W1]`.
   3. Unless `--narration-only`: each `screen_N` active in the scope, same ranges, `layer_ids:["screen_N"]`; re-read, check that layer. A layout that overlapped a cut must have followed the screen.
   4. Unless `--narration-only`: one overlay layer when any overlay is active in the scope (overlays ripple as one group); re-read, check every overlay layer.
   5. `layout` only if a layout still sits at its old position after the screen trims; otherwise leave it.
   6. Duration check: the new `duration_ms` must be the old one minus `totalMs` (narration-only: only when narration was the longest content). If the drop is smaller than `totalMs` and the checker disagrees, Borumi applied the ranges one after another: `abort_project_edit`, then redo the transaction with one range per call, last range first (descending), same edit-set order, checking after each.
   7. Any mismatch: `abort_project_edit`, write it to `<receipts>/index.md`, report which layer, stop. No partial commits.
   8. Look at two seams (the longest cut and the first cut): `inspect_timeline {tx_id, range:{start_ms:t-34, end_ms:t+34}, view:{type:"render"}, presentation:"frames", quality:"low", sampling:{type:"uniform", max_frames:2}, save:true, include_images:false}` where `t` is each cut's mapped start; Read the frames.
   9. `commit_project_edit {tx_id, change_summary:"Remove 43 silences (38.2 s) from Scene 3 across camera, mic and screen."}`. Declined means abort and stop.
7. Verify after the commit: `get_project_overview {project_id, slices:["project","scenes"]}` -> `duration_ms` and scene bounds as expected. Write the final numbers to `<receipts>/index.md`.
8. Chapters: if `<project name> Agent/chapters/chapters.json` exists and any chapter starts after the first cut: `node $BORUMI_PLUGIN_ROOT/scripts/chapters.mjs shift --chapters <file> --cuts <receipts>/cuts.json`, then run `/borumi:chapters <file>` to re-place the cards and rewrite `youtube-chapters.txt`. Tell the user.
9. Report: `Removed 43 silences (38.2s) from Scene 3. Project 12:04 -> 11:26.` plus the seam frame paths. Whole project: one line per scene and the total. End with the next action.

## Tuning from feedback

- "Too choppy" or breaths got clipped: raise `--keep-ms` (200) or `--min-ms` (1000), or `--pacing relaxed`; rerun.
- "Still slow": `--pacing brisk` (300/120) or `rapid` (120/80). Below 300 ms the cuts start landing between words of one sentence; say so.
- The command only ever cuts what `detect_speech` calls silence on the microphone layers; music and system sound never drive a cut.

## Failure handling

Every error goes to `<receipts>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked. A trim that did not verify is never reported as done.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`. `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate.
- Codex or any host without the plugin MCP: run the same calls through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once), and ask for a yes in chat before `commit_project_edit`.
