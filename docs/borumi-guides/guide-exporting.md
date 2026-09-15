# Exporting

1. Finish and commit Project edits before starting the final export.
2. Use a video preset for ordinary exports:
   - `fast` for a quick review.
   - `balanced` for the normal final export.
   - `best` when the user prioritizes output quality over export time.
3. Use `custom` when the user or destination specifies dimensions or FPS.
4. Custom dimensions resize the existing composition and must preserve its aspect ratio. Export
   does not crop, stretch, reframe, or rearrange Layout content.
5. Omit the video range for the complete Project, use a Scene range for one Scene, and use a time
   range for an arbitrary Project-time section.
6. After starting video, verify the returned width, height, and FPS. After starting audio, verify
   the returned format, sample rate, and channel layout. Cancel promptly if they are unsuitable.
7. Before exporting a transcript, confirm that relevant transcription is ready. If it is missing,
   call `request_transcriptions` with `project_id`, wait at least `poll_after_ms`, and poll committed
   Project state before exporting. Use transcript `srt` for subtitle uploads, `txt` for plain text,
   and `md` for a transcript grouped by Scene.
8. Poll `get_export_status` no more frequently than `poll_after_ms`. Missing or unchanged progress
   is not failure and must not cause a duplicate export.
9. Call `cancel_export` only when the export is unsuitable, superseded, or explicitly canceled.
10. Report the artifact path only after `status` is `completed`.
