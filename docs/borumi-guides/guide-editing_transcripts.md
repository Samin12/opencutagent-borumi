# Transcript editing

This guide assumes `project_edits` and `editing` have already been retrieved. Transcript correction
is the first editing phase, before trimming and synchronization.

## Workflow

1. Before beginning an edit transaction, call `get_project_overview` with `project_id` and inspect
   transcript availability. If relevant transcription is pending, wait and poll committed Project
   state. If it is unavailable or failed, call `request_transcriptions` once, wait at least
   `poll_after_ms`, and poll again. Omit `media_ids` to request all relevant timeline Media. If no
   Media was requested but relevant transcript content is still absent, use detailed
   `get_timeline` Media fields to identify specific audio Media and request those IDs. Report a
   repeated failure instead of retrying indefinitely.
2. Begin an edit transaction only after the relevant transcription is ready. Use its `tx_id` for
   every supported read and change in this phase, then repeat the availability check against the
   transaction snapshot.
3. Review spoken content economically with Project-time `get_transcript` in `blocks` mode using
   `tx_id`. Work Scene by Scene or in bounded ranges. Its results include text, layers, Segment IDs,
   Media IDs, and visible Media ranges. Deduplicate by Media ID; do not correct the same source once
   per timeline Segment.
4. Use detailed `get_timeline` Media fields only for an exhaustive audit or to find relevant
   microphone, system-sound, or imported-audio Media for which `get_transcript` returned no
   transcript. Follow every `range_too_large` suggestion.
5. For each questionable passage, call `get_media_transcript` in `words` mode with `tx_id` and the
   matching visible Media range.
6. Call `correct_media_transcript` with `start_ms` copied exactly from the first mistaken word tuple
   and `end_ms` copied exactly from the last. Do not inset or expand those boundaries. If the server
   cannot match either boundary, reread nearby words and try again with current tuple bounds.
   Inspect `previous_text`, then reread `changed_range` in `words` mode with a small amount of
   neighboring context.
7. Abort the complete transaction if any selection or result is wrong, ambiguous, or cannot be
   verified. Otherwise commit only after every correction has been reread and verified. If no
   correction is needed, abort the read-only transaction. Aborting discards earlier confirmed
   corrections too; replay them in a new transaction if needed.

## Correction rules

Make only minimal, faithful corrections. Fix clear transcription errors, spelling, capitalization,
product and proper names, and clearly wrong punctuation. Do not rewrite, reorder, summarize,
improve style, remove spoken disfluencies, or change the speaker's meaning.

Correct a name only when supported by transcript context, user-provided information, or Project
Script context already supplied to you. Leave uncertain text unchanged. MCP Script retrieval is not
available.
