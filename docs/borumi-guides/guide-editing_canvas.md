# Canvas editing

Canvas settings apply to the complete Project, never one Scene or Project-time range.

## Workflow

1. Begin a Project edit transaction, then call `get_project_overview` with its `tx_id` and
   `slices: ["canvas"]`.
2. Change the Canvas format before making Layout adjustments that depend on its aspect ratio.
3. When changing both format and background, send both in one `update_canvas` call.
4. After changing the format, inspect representative rendered frames from the transaction. Check
   Layouts, crops, overlays, captions, and important visual details.
5. Read the `canvas` overview slice again to verify the exact staged values.
6. Commit only after verification. Otherwise, abort the transaction.

## Guidelines

- Wallpapers can be read through the Canvas overview but can currently be changed only in the
  Borumi app.
- An image background requires an image Media ID returned by Borumi. Retrieve and follow
  `importing_media` before using an external image.
- Canvas format controls the Project composition. Export settings control the final output
  resolution and frame rate.
