# Importing Media

Import local Media only inside a Project edit transaction:

1. Call `begin_project_edit` for the open Project if no edit transaction exists yet.
2. Call `import_media` with the transaction ID and an absolute path to each required local file.
3. If an import returns `queued` or `running`, wait at least `poll_after_ms`, then call
   `get_media_import_status`. Do not poll imports that already returned `completed`, `failed`, or
   `canceled`.
4. Use each completed Media ID in the same transaction with `add_segments`, `update_canvas`,
   Music, or Overlay operations.
5. Reread the transaction and verify its timeline and Canvas before committing.
6. Commit to retain every imported Media and its copied file, or abort to remove all Media
   imported into the transaction.

`cancel_media_import` is idempotent for known imports. Canceling an import that already completed
does not remove its staged Media. Commit or abort the transaction normally. Aborting always
removes every Media imported into that transaction, including completed imports.

Borumi copies each source file. Later changes to the original file do not affect the imported
Media. Supported formats are MP4, MOV, GIF, MP3, WAV, M4A, JPG, JPEG, and PNG.
