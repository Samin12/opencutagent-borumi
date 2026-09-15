# UI navigation

- Call `get_ui_state` when a request refers to the current Project, Project tool, Edit playhead,
  Scene, selected Clips, or selected range.
- Creating, opening, duplicating, or renaming a Project does not select it. When the user asks to
  open and show a closed Project, call `open_project`, wait for it to succeed, then call
  `focus_project`.
- Use `focus_project` only to show a Project that is already open.
- Do not focus a Project opened only for background MCP work.
- Use `set_active_project_tool` only to show Script, Record, or Edit. Selecting Record never starts
  recording.
- UI navigation does not edit Project content and never belongs inside an edit transaction.
- Do not retry `focus_project` or `set_active_project_tool` while recording or a recording countdown
  is active. Ask the user to finish or cancel the recording in Borumi.
- Use `inspect_timeline`, not Borumi's interactive UI, to inspect rendered frames.
