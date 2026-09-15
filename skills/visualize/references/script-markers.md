# Script markers

The scene Script in Borumi (`script_markdown`, read with `get_scenes`, writable with `update_scenes` after the `scripting` guide) can carry the visual plan next to the narration. The convention comes from OpenCutAgent's `project/script.md` and `script_advanced.md`; the visualize skill reads it and injects it into the job brief. Writing markers into the Script from the plugin is deferred to v0.2; reading them works now.

## The markers

| Marker | Meaning | What reaches the brief |
|---|---|---|
| `(ANIMATION: ...)` on its own line after a block of narration | The core idea for the visual under that block. May span lines up to the closing parenthesis. | `- Animation beat: <text, whitespace collapsed>` |
| `[IMAGE: refs/<file>]` followed by prose and a `Source: <url>` line | A reference screenshot the animation is built around: "look at the region named, build around what is actually on screen" | `- [IMAGE: refs/<file>] <the prose that follows, joined>` then `  Source: <url>` |
| `[SHOW TABLE n]` followed by a Markdown table | The edit cuts to that table | `- [SHOW TABLE n]` then the table rows, indented, verbatim |
| `[OPEN: <url>, <region>]` | The page to show while recording (the older `script.md` form, before screenshots existed) | Nothing on its own; the plugin does not browse. Ask for the screenshot or an `[IMAGE:]` line when the visual depends on it. |

Blocks are separated by blank lines. A beat belongs to the narration block(s) directly above it, up to the previous marker.

## How the brief is built (`job.mjs create --script-text <file> [--user-brief "..."]`)

`scripts/lib/brief.mjs extractScriptBeats` pulls every marker out of the scene Script, in order, and `planLines` writes them under `## The user's plan for this beat`:

```
## The user's plan for this beat
The user asked for: <the --user-brief text, when given>

From the scene Script in Borumi:
- Animation beat: the table with every "2x" cell dimmed, and the single "0.5x" cell lit up.
- [IMAGE: refs/03a-pricing-fable-5-1.jpg] The Fable 5.1 model page, Pricing card. Rows: Input $10 / MTok ... Cache read $0.25 / MTok.
  Source: https://platform.claude.com/docs/en/models/fable-5-1/overview
- [SHOW TABLE 2]
  | Per million tokens | Fable 5.1 | Opus 5 | Fable vs Opus |
  |---|---|---|---|
  | Input (uncached) | $10.00 | $5.00 | 2x |
  | Cache read | $0.25 | $0.50 | 0.5x |
```

A Script with no markers is quoted instead (its first 60 lines, prefixed `>`), so the design still sees the written version of the narration. No Script and no user brief: the section is absent.

Every marker of the scene goes in, not only the ones near the selected range: a scene Script is short, and the beat that belongs to the range is the one whose narration block matches the selected words in `## The narration you are animating`. The design step picks that beat; the others are context. When the range covers several blocks with their own beats, build them in Script order. The narration in the Script is the written version; the transcript is what was actually said. Sync to the transcript, follow the Script for the idea.

## Reference images

`create` does not copy images by itself. Before creating the job, resolve every `[IMAGE: refs/<file>]` the target beat names: look in `<project name> Agent/refs/` first, then next to the file the Script was pasted from, then ask. Pass each found file as `--ref <path>` on `create` (or later with `job.mjs refs <jobId> --add <path>...`); it lands in `src/jobs/<jobId>/refs/` with `-1`, `-2` suffixes on name clashes, and the design step Reads every file in that folder. A missing image is reported by name; the beat text still goes in.

## Example Script (from the Fable 5.1 cost video)

```
Every line is double, except cache reads.

Fable is 25 cents, Opus is 50. The expensive model is half price on that one line.

(ANIMATION: the table with every "2x" cell dimmed, and the single "0.5x" cell lit up.)


And that line is most of what Claude Code does.

It resends the entire conversation every turn. System prompt, CLAUDE.md, tools, every file it read, every result.

(ANIMATION: a chat conversation growing turn by turn. Each new turn, the whole stack above it flashes as it gets resent. First flash labeled "cache write", every next flash labeled "cache read".)
```

`/borumi:visualize "the part where I say every line is double"` resolves to the first block's range; the brief lists both beats, and the design builds the dimmed-table beat because that is the narration inside the range.

## Writing tips for the Script (for the user)

- One `(ANIMATION: ...)` per idea, placed right after the sentences it illustrates. Describe the picture, the change over time, and the one thing to emphasize; skip colours and fonts, the style handles those.
- Keep `[IMAGE:]` prose factual: what is on screen, which row or bar to point at, where the numbers are. Put the `Source:` line right under it.
- Tables under `[SHOW TABLE n]` should hold only the rows the narration cites; the animation shows at most one table at a time.
- No em dashes in on-screen text; the kit refuses them in labels.
