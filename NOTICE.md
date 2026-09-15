# Notice

This repository is a port. The animation kit and the editing engine it grew out of come from
**OpenCutAgent** by Leonardo Grigorio: https://github.com/leonardogrig/opencutagent

OpenCutAgent is licensed under MIT with the Commons Clause condition (see `LICENSE`, kept verbatim
from upstream). That license covers everything carried over from it and, by extension, the
derivative work in this repository. In short: use it, change it, share it, but do not sell it or
a product built substantially on it. That right stays with the upstream author.

## What came from OpenCutAgent

- `animation-kit/`: the Remotion project (engine under `src/`, the `excalidraw`, `n8n` and `leo`
  style packages, the inlined fonts, the frame-aware scripts, `remotion.config.ts`). Only the
  wording that named Premiere Pro and the old server changed; the code is upstream's.
- `scripts/lib/`: pure helpers ported from the upstream server (interval math, duration
  formatting, the sentence segmentation rules, the pacing presets).
- The retake judgement rubric and the transaction discipline in `skills/`, rewritten for Borumi.
- `docs/LESSONS.md`: the upstream Premiere-era history is kept below the Borumi section for
  reference.

## What this repository adds

The Claude Code plugin around Borumi's own MCP server: the slash commands, the placement planner,
the job scripts, the Python session client, the tests and the documentation. Copyright for those
parts: Samin Yasar, 2026, offered under the same license terms as upstream so the whole tree
carries one license.

## Third-party components

- **Borumi** is a separate macOS product with its own license; this plugin drives its MCP
  server and is not affiliated with or endorsed by its makers. Borumi is a trademark of its
  owner.
- **Remotion** (https://www.remotion.dev) renders every animation locally. It is free for
  individuals, non-profits and companies of three people or fewer; larger for-profit companies
  need their own Remotion license. See https://www.remotion.dev/docs/license.
- **rough.js**, **React** and the other npm packages pinned in `animation-kit/package.json` are
  used under their own licenses.
- **ffmpeg** is used for probing, contact sheets and remuxing under its own license.
- The fonts under `animation-kit/public/fonts` (Excalifont, Inter) ship under their own font
  licenses; they are inlined into the renders as data URIs.
- The `n8n` style reproduces n8n's older brand look. The n8n name, logo geometry and palette belong
  to n8n; the style only draws the logo when a user asks for it.
- Claude and Claude Code are trademarks of Anthropic; the plugin runs on the user's own Claude
  Code login.
