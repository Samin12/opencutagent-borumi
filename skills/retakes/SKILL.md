---
name: retakes
description: "Borumi: find the repeated takes, false starts and duplicate lines in a scene of the open Borumi project, judge keep or cut per sentence, show the grouped decisions, then cut every discarded take in one verified transaction. Triggers: /borumi:retakes, remove retakes, cut the false starts, remove my duplicate takes, clean up the restarts in scene 2, keep only the best take."
allowed-tools: Bash(node:*) Bash(python3:*) Read Write Edit Glob Grep Agent mcp__plugin_borumi_borumi__get_guides mcp__plugin_borumi_borumi__list_open_projects mcp__plugin_borumi_borumi__get_project_overview mcp__plugin_borumi_borumi__get_scenes mcp__plugin_borumi_borumi__get_timeline mcp__plugin_borumi_borumi__get_transcript mcp__plugin_borumi_borumi__request_transcriptions mcp__plugin_borumi_borumi__detect_speech mcp__plugin_borumi_borumi__inspect_timeline mcp__plugin_borumi_borumi__begin_project_edit mcp__plugin_borumi_borumi__trim_timeline mcp__plugin_borumi_borumi__abort_project_edit
disable-model-invocation: true
---
Load skills/borumi-editing/SKILL.md (read "$BORUMI_PLUGIN_ROOT/skills/borumi-editing/SKILL.md", see Host notes for how your host resolves $BORUMI_PLUGIN_ROOT) if not already loaded.

# /borumi:retakes

You are the judge. Borumi gives the words with project-time milliseconds; `segments.mjs` tiles them into one segment per sentence, pause, cut-off word, immediate repeat or capitalised restart; you decide keep or cut per segment with the rubric below; the planner turns the cuts into edge-safe ranges; one transaction applies them. Nothing changes before the grouped table gets a yes and the commit prompt is accepted.

`$BORUMI_PLUGIN_ROOT` is the plugin folder (two levels above this file). Scripts run as `node $BORUMI_PLUGIN_ROOT/scripts/<script>.mjs`. Tool names are Borumi's own (see Host notes).

## Syntax

```
/borumi:retakes scene 2
/borumi:retakes                       one scene at a time, in order; each scene gets its own preview and commit
/borumi:retakes scene 2 --pad-lead-ms 250 --pad-tail-ms 300
/borumi:retakes scene 2 --narration-only
```

## Guides to fetch first

`get_guides` with no arguments once per session, then one id per call: `project_edits`, `editing`, `editing_transcripts`, `editing_trimming`; `editing_synchronization` when a screen layer is its own edit set under the cuts.

## Procedure

1. Project and scene. `list_open_projects` -> the active project (several open and none active: ask, stop). `get_project_overview {project_id, slices:["project","scenes","transcripts"]}`, `get_scenes {project_id}` -> `<receipts>/scenes.json`. Receipts: `<dirname(project.path)>/<project name> Agent/receipts/retakes-<stamp>/` (write `index.md` first). Work one scene per transaction.
2. Transcript readiness: `transcripts.pending_media_count == 0` and `ready_media_count >= 1`. Otherwise `request_transcriptions {project_id}`, wait `poll_after_ms` (`python3 -c "import time; time.sleep(3)"`), poll the overview slice again; a failed or unavailable count after the request is reported once and stops the command.
3. Read the scene: `get_transcript {project_id, range:{start_ms:A, end_ms:B}, mode:"words"}` -> `<receipts>/words.json`. `get_timeline {project_id, range, detail:"summary"}` -> the microphone and camera ids of the narration set and the other edit sets. `detect_speech {project_id, range, activity:"silence", target:{type:"layers", layer_ids:[<microphone ids>]}}` -> `<receipts>/silences.json` (the planner snaps cut edges into these gaps).
4. Segments: `node $BORUMI_PLUGIN_ROOT/scripts/segments.mjs list --words <receipts>/words.json --start-ms A --end-ms B --scenes <receipts>/scenes.json --out <receipts>/segments.json`. It prints `[i] m:ss text` lines (project time); word-empty stretches carry `⟦cut: no speech⟧` (pre-marked, not your call) and very short ones `⟦flag: very short⟧`. Read every line. More than 200 lines: read the file in chunks; never sample.
5. Earlier decisions: if `<project name> Agent/receipts/retakes-scene<position>-decisions.json` exists from a previous run and its segment texts match the new list index by index, start from those marks and say so; otherwise start fresh.
6. Judge every segment with the rubric below. More than 50 segments: split into chunks of 36 that overlap by 14 (chunk k starts at index 22k). Delegate each chunk to a subagent with the rubric, the chunk's lines, and the instruction to return `[{"index", "decision":"keep"|"cut", "group", "reason"}]` for every index in the chunk. Where chunks overlap, the later chunk's decision wins (it sees how the run ends). Then read the group boundaries yourself once more.
7. Write `<receipts>/decisions.json` as `[{"index": 12, "decision": "cut", "group": "g3", "reason": "restart of the line kept at 15"}, ...]` (keepers may be omitted; keep is the default; pre-marked no-speech tiles stay cut).
8. Plan: `node $BORUMI_PLUGIN_ROOT/scripts/segments.mjs plan --segments <receipts>/segments.json --decisions <receipts>/decisions.json --silences <receipts>/silences.json --pad-lead-ms 250 --pad-tail-ms 300 --out <receipts>/cuts.json` -> `{ranges, spans, summary}`: each run of consecutive cut tiles becomes one range whose edges sit in the nearest detected silence gap, else padded 250 ms before the first kept word and 300 ms after the last; runs never cross a scene boundary.
9. Preview, then STOP and wait for a yes:
   ```
   Scene 2: 23 of 61 segments cut in 9 groups, 1:42 removed. Project 12:04 -> 10:22. Camera, mic and screen cut together.
   g1  keep [7]  "n8n now has a set of skills that instructs Codex how to use their MCP to..."   cut [2-6]
   g2  keep [14] "So this is my prompt: create a workflow..."                                    cut [11-13]
   ...
   ```
   Flips ("keep 12", "cut 40-44") update `decisions.json`; re-run step 8 and show the table again.
10. Transaction: exactly the trim routine of `/borumi:cut` step 6 with all `cuts.json` ranges in one `trim_timeline` call per edit set (narration first, then each `screen_N`, then one overlay layer, `layout` only if stranded; `--narration-only` skips the non-narration sets), the position checker from `/borumi:cut` after every call, two seam frames, then `commit_project_edit {tx_id, change_summary:"Remove 23 retakes (1:42) from Scene 2 across camera, mic and screen."}`. Any mismatch: abort, log, report, stop.
11. Verify after the commit: `get_project_overview {project_id, slices:["project","scenes"]}`. Persist the marks for re-runs: copy `decisions.json` (with each segment's text and time) to `<project name> Agent/receipts/retakes-scene<position>-decisions.json`.
12. Chapters: if `<project name> Agent/chapters/chapters.json` exists and any chapter starts after the first cut, `node $BORUMI_PLUGIN_ROOT/scripts/chapters.mjs shift --chapters <file> --cuts <receipts>/cuts.json`, then run `/borumi:chapters <file>`. Tell the user.
13. Report: `Removed 23 retakes (1:42) from Scene 2. Project 12:04 -> 10:22.` plus the seam frame paths. Next scene, or the next action.

## How to judge retakes (this is the whole game)

**The #1 pattern is the _serial restart_.** In a raw recording the speaker starts a line, stumbles or cuts off, and **restarts from the top**, getting a little further each time, until one clean pass. It looks like a staircase where each step repeats the opening words of the one before:

```
[2] n8n now has-                                              <- cut
[3] n8n now has a set of skills-                              <- cut
[4] n8n now has a set of skills that helps Claude-            <- cut
[5] n8n now has a set of skills that helps Claude understand... <- cut
 ...(a dozen more restarts)...
[11] n8n now has a set of skills that instructs Codex how to use their MCP to-   <- KEEP (best/most-complete pass)
```

**Rule: of a run of restarts of the same line, keep only the single most complete, fluent pass; cut ALL the others.** A run can be 3 restarts or 35; cut every one but the keeper.

**Signals a segment is a discarded take (cut it):**
- ends mid-word or with a dash `-`, or trails off / trails into a `(clears throat)`;
- **is a prefix of, or repeats the opening words of, a nearby segment** (the staircase);
- is immediately followed by the same phrase started over;
- standalone filler / throat-clears / "testing testing" / "blah blah"; ambient-noise lines like `(traffic)`, `(mouse clicking)`, `(sigh)`.

**The critical distinction: restart vs. next point.** Do **not** cut a segment just because it sounds similar to its neighbour. A *restart* re-attempts the **same** words; a *next point* moves **forward** with **new** content. Adjacent segments that are each complete and fluent but say **different things** are **both keepers**:

```
[160] So this is my prompt: create a workflow, a webhook trigger...   <- KEEP
[161] It then goes through an AI agent using OpenRouter,            <- KEEP (new content)
[162] Gemini 2.5 Flash, to answer the question.                     <- KEEP (new content)
[163] They get a response back from the webhook. Simple...          <- KEEP (new content)
[164] but it sh- but it sh-                                         <- cut (restart begins)
 ...                                                                <- cut
[171] but it should be enough for Claude to understand...           <- KEEP (clean pass of that line)
```

So a region can have **several keepers**: one clean pass per distinct point. (It is **not** "exactly one keep per beat.") When **no** take of a line is clean on its own, keep the **fewest consecutive** takes that together read as one fluent line (a clean first half + a clean second half) and cut the rest.

**Calibration: this is where it usually goes wrong.**
- **Be decisive about obvious restarts.** A segment ending in `-`, or that is a strict prefix of the next one, is almost always a discarded take: cut it. Keeping two or three versions of the same sentence "to be safe" *is the bug the user is trying to fix*; it leaves the duplicates on the timeline. Don't do it.
- **Reserve "keep when unsure" for genuine _content_ ambiguity** (is this a distinct point or a duplicate?), **not** for plain restarts. If you genuinely can't tell whether a fluent line duplicates another, keep it; the user reviews every mark. But a line that plainly restarts its neighbour is never the "unsure" case.
- **Stay thorough on long runs.** One line can be restarted 20 to 40 times in a row; cut every restart, not just the first few. Don't get lazy and leave the back half of a long run kept.

Efficiency: one big read and one decisions file beat many small calls. For hundreds of segments, generate the decisions with a script (define each beat as `[start, end]` plus its keeper, emit every non-keeper as cut) instead of hand-typing. Never re-request a transcript that is already ready.

## Failure handling

Every error goes to `<receipts>/index.md` before it is reported; then the row in the base skill's `references/recovery.md`. An open transaction is aborted before any question is asked. A trim that did not verify is never reported as done.

## Host notes

- Claude Code: `$BORUMI_PLUGIN_ROOT` is `${CLAUDE_PLUGIN_ROOT}`; Borumi tools are `mcp__plugin_borumi_borumi__<tool>`; the subagent tool is `Agent`. `commit_project_edit` is not pre-approved on purpose: its permission prompt carries the change summary and is the approval gate.
- Codex or any host without the plugin MCP: run the same calls through `python3 $BORUMI_PLUGIN_ROOT/scripts/borumi_mcp.py call <tool> '<json>'` on one daemon connection (`start` once), judge the chunks yourself in sequence, and ask for a yes in chat before `commit_project_edit`.
