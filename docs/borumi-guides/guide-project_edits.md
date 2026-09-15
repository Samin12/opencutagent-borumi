# Project edits

Every Project content change, including Script and timeline changes, must use an isolated
transaction:

1. Call `begin_project_edit` with the Project ID.
2. Use its `tx_id` for every supported read and change in that edit. Do not mix in `project_id`.
3. Verify the complete staged result, then call `commit_project_edit` with `tx_id` and a short
   `change_summary` describing the user-visible changes in one sentence.
4. Call `abort_project_edit` instead if the edit cannot be completed or verified.

`copy_scenes`, `copy_segments`, and `import_media` can continue asynchronously. Poll their status
tool until completion before verifying or committing. A transaction cannot commit while one of
these operations is still running.

## Keep edits small

Split broad requests into a sequence of small, coherent Project edits. Each transaction should
produce one independently useful result that the user can approve or reject without accepting
unrelated changes.

- Prefer one transaction per task and bounded scope. For example, trim one Scene or range and
  commit it, then begin another transaction for its Layout changes.
- Do not keep one transaction open for an entire multi-part request or combine unrelated trimming,
  Layout, Canvas, Script, caption, and Media changes merely to reduce the number of commits.
- Keep tightly coupled changes together when committing only part would leave the Project
  incomplete or inconsistent.

After every commit, begin a new transaction from the latest Project state and reread the affected
data and timeline hash before continuing. If commit approval is declined, abort that transaction
before starting another.

The summary may be shown to the user when the MCP client requests approval. Make it concrete, cover
the complete transaction, and do not use generic text such as "Apply the changes." For example:
`Remove three silent sections and add captions to Scene 2.`

Commit and abort close the transaction. A commit conflict also closes it; begin a new transaction
instead of reusing its `tx_id`.
