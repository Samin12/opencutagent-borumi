# Scripting

Use the `project_edits` transaction workflow for every Scene or Script change.

1. Read the Project overview, begin an edit transaction, then call `get_scenes` with its `tx_id`.
2. For an imported monolithic Script, choose explicit Scene boundaries and prepare an ordered array
   of `{name, script_markdown}` objects. The server does not interpret headings or horizontal rules
   as Scene boundaries.
3. Use the smallest suitable atomic batch: create new Scenes, update only changed names or Scripts,
   and move Scenes only when their order must change.
4. Reread affected Scenes and verify their canonical Markdown, names, and order.
5. After a structural change, reread to obtain a current `timeline_hash` before another structural
   or Project-time edit. Updating only a name or Script does not invalidate the hash.
6. Commit only the verified transaction. Abort it if the intended final state cannot be verified.

Imported wording should remain faithful to the source. Headings can guide Scene boundaries, but
they are also valid Script content and must not be removed implicitly.

`script_markdown` replaces the complete Script. Omit it to leave the Script unchanged, pass a
string to replace it, or pass `null` to clear it. The supported Markdown includes paragraphs,
headings, ordered and unordered lists, nested lists, block quotes, fenced code blocks, bold,
italic, inline code, and strikethrough.

Scene names follow the same update convention: omit `name` to leave it unchanged, pass a
single-line string to replace it, or pass `null` to restore the generated display name.

Creating, moving, and deleting Scenes requires the current transaction `timeline_hash`. Reread
after a successful structural change before continuing. Moving multiple Scenes preserves their
existing Project order, regardless of input order.

Deleting a Scene can delete Takes and Scene-owned timeline content. Keep `delete_recordings` false
unless deletion of recorded Scenes is part of the user's request. Never delete a Scene with Takes
or replace a substantial Script unless the user requested that outcome and the staged final state
has been verified.
