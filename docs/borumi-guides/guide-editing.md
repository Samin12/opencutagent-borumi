# Timeline editing

Before editing the timeline, retrieve `project_edits` if it has not already been retrieved.

## Workflow

1. If the Canvas format or background needs to change, retrieve and follow the `editing_canvas`
   guide first. Make aspect-ratio-specific Layout adjustments only after changing the Canvas
   format.
2. Before trimming or synchronization, retrieve and follow the `editing_transcripts` guide.
3. After completing the transcript phase, begin a transaction for timeline editing. Call
   `get_project_overview` with `tx_id`, then call `get_timeline` with summary detail for the
   `content` layers. Each Scene's `edit_spans` divides the range by active content; each inner
   `edit_sets` array contains layer IDs grouped for that span. Separate arrays mean the layers can
   be edited independently. Judge each span by its active layers.
4. Before trimming, retrieve the `editing_trimming` guide if needed.
5. If narration and screen content are in separate edit sets, retrieve the
   `editing_synchronization` guide, then trim and align them independently. Never apply
   narration-derived ranges to the screen or treat identical cuts as synchronization. Skip this
   phase where the relevant layers share an edit set.

## Segment operations

Use these tools when an edit targets exact persisted Segments. Structural selection operations
expand edit groups automatically unless explicitly opted out via `expand_groups: false` (which only some operations support). Property updates
always target only the exact Segment ID:

- Use `add_segments` to add Takes, existing Project Media, overlays, or control Segments. Every
  addition uses exact Project-time placement. Source-backed additions reference existing Take or
  Media IDs. Retrieve and follow `importing_media` before adding external Media. A successful call
  is structural, so reread the transaction before another hash-guarded edit. Before creating a
  Segment, retrieve `editing_segment_<type>_add` for its exact schema, examples, and usage tips.
- Use `copy_segments` to insert existing Segments from another open Project, or duplicate them in
  the same Project. Their relative timing, source offsets, edit groups, Takes, Clips, and required
  Media are preserved. Edit groups expand by default; set `expand_groups: false` only when the
  user explicitly wants the exact Segment IDs. Poll `get_copy_status` until the operation is
  complete, then reread the transaction before another hash-guarded edit.
- Use `untrim_segments` to restore content at the left or right edge of one or more Segments.
- Use `split_segments` to divide an exact Segment and its linked members at one or more absolute
  Project times. Submit all boundaries for the same Segment in one entry.
- Use `delete_segments` to remove one or more Segments. Keep `expand_groups` enabled for normal
  structural edits. Set it to `false` only when the user explicitly intends to remove individual
  members of an edit group. Set `ripple` to control whether eligible following content closes the removed
  range gap.
- Use `move_timeline_segments` to move one selection as a unit. Use `at_time` for placement that
  preserves the source gap. Use `before_segment` and `after_segment` only to reorder video or audio
  content. The destination Segment must belong to one of the selected content families. Use
  `at_time` for overlays, music, sound effects, and control Segments.
- Use `update_segments` to change the non-timing properties returned by `get_timeline`. Do not use
  it to change timing, ordering, grouping, or identity fields. Before updating a Segment, retrieve
  `editing_segment_<type>_update` for its exact schema, examples, and usage tips.

## Guidelines

- Read progressively: use `get_timeline` for structure, `get_transcript` for spoken content,
  `detect_speech` for speech or silence, and `inspect_timeline` only for visual evidence.
- For the first visual inspection of a range, use a low-quality `contact_sheet`. Use `frames` for a
  precise moment, higher-quality evidence, or an image that must be saved individually.
- Visual inspection is expensive. Use it only when necessary. Inspect `render` for the composition
  or `layer_source` for one original visual layer, using the narrowest useful range and lowest
  useful quality.
- For long Projects, work Scene by Scene or in smaller ranges.
- Use the latest `timeline_hash` from a transaction read. Read the transaction again after each
  structural timeline change before making another hash-guarded edit. A successful
  `update_segments` call changes properties only, so its input hash remains valid.
- Property updates must declare the Segment `type` and use a partial `properties` object from
  `get_timeline`. Do not include timing, ordering, grouping, Scene, Clip, Media, or Source identity
  fields.
- Use `copy_scenes` when complete Scenes should be inserted from another open Project, or
  duplicated in the same Project. It preserves the Scene contents and transfers required Media.
  Poll `get_copy_status` until the operation is complete, then reread the transaction.
- Before choosing or changing a Layout, video clip, overlay, screen blur, highlight transition,
  retrieve and follow the `editing_transitions` guide.
- Before adding or changing sound effects, retrieve and follow the `editing_sound_effects` guide.
- Before adding or changing cursor appearance or behavior, retrieve and follow the
  `editing_cursors` guide.
- RGBA color channels are integers from `0` to `255`, including alpha. For example, black at
  approximately 35% opacity is `{"r":0,"g":0,"b":0,"a":90}`.
