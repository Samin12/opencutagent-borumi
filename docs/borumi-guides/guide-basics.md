# Borumi basics

Borumi creates videos in four stages:

- **Script:** Plan the structure, divide it into Scenes, and write the Script for each Scene.
- **Record:** Capture the camera, microphone, screen, and system sound for each scene independently.
- **Edit:** Refine the complete video with timeline, visual, and audio editing.
- **Export:** Export video or audio with settings suited to different targets.

## Glossary

- **Project:** The top-level video workspace containing Scenes, Media, and the timeline.
- **Scene:** An ordered, scripted section that can be recorded and edited independently.
- **Take:** One recording attempt for a Scene, grouping the Clips captured together.
- **Clip:** A Media track or range belonging to a Take. Timeline clip Segments reference it.
- **Segment:** A timed timeline item, such as a Clip, layout, caption, overlay, or effect.
- **Media:** An underlying recorded or imported asset, such as video, audio, or an image.

Borumi must be open when you use its MCP tools. Treat every ID as an opaque string and return it
exactly as provided.

## Project management

Creating, opening, duplicating, or renaming a Project does not change the Project shown in Borumi.
Use `focus_project` only when the user asks to show or switch to an open Project. Renaming preserves
whether the Project was open; open a closed renamed Project before focusing it.

Closing and deleting Projects are not available through the MCP. Do not substitute filesystem
operations or claim that either action succeeded.

## Relevant Guides

Depending on the task, retrieve these guides once per MCP connection with `get_guides`:

- **Project edits:** `project_edits` before changing any Project content.
- **Scripting:** Also retrieve `scripting` before creating, updating, moving, or deleting Scenes.
- **Timeline editing:** Also retrieve `editing` before editing the video or timeline.
- **Transcript editing:** Also retrieve `editing_transcripts` before correcting a Media transcript.
- **Exporting:** Retrieve `exporting` before final video, audio, or transcript delivery.
- **Canvas editing:** Also retrieve `editing_canvas` before changing the Project Canvas format or background.
- **Use cases:** `use_cases` when the user asks what can be done with the Borumi MCP.
- **UI navigation:** `ui_navigation` before reading or changing Borumi's visible Project or Project tool.
