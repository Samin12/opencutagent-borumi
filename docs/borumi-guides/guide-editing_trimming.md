# Timeline trimming

This guide assumes `project_edits` and `editing` have already been retrieved.

## Find cuts

- **Silence:** Call `detect_speech` with `tx_id` and `activity: "silence"`, targeting the relevant
  microphone or system sound layers or Segments. Returned ranges cover selected audio only;
  timeline gaps without that audio are not silence.
- **False starts and repeated takes:** Read transcript blocks to compare attempts, then words for
  precise boundaries. The later complete attempt is often the keeper, but confirm it from context.
- **Visual criteria:** Use `inspect_timeline` only when the cut depends on visible content. Inspect a
  narrow range with low quality and as few frames as possible.

## Apply cuts

- Call `trim_timeline` with `tx_id`, confirmed Project-time ranges, and the latest `timeline_hash`.
  `ripple` defaults to `true`; set it to `false` to leave removed intervals empty without explicit
  downstream shifts.
- When ranges come from speech detection or the transcript, target the narration edit set. Never
  apply them to an independent screen layer.
- Omit `target` only when all affected content shares one edit set. When independent edit sets
  overlap a range, trim each one separately; grouped members are edited together.
- Batch confirmed ranges that share a target. Then reread and verify the transaction before further
  edits or commit.

## Restore edges

- Use `untrim_segments` with positive, bounded `left_ms` or `right_ms` values. Durations are in
  Project time; Borumi converts them through each Segment's playback speed.
- Source bounds clamp each effective edit group to its smallest available extension. Check
  `clamped`, then reread the transaction when `changed` is true.
- `ripple` defaults to `true`. With `false`, restored edges may overlap following Segments.

Deleting a Scene-defining tail, or trimming or restoring one, can still change the Scene duration
and move later Scenes even when `ripple` is `false`.

If sub-agents are available, delegate false-start, repeated-Take, and visual range detection. Give
each sub-agent a bounded range and ask it to return only confirmed Project-time ranges and concise
evidence, keeping transcript- and frame-heavy analysis out of the main context.
