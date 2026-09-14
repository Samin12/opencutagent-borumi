# OpenCutAgent

Edit video on the **live Adobe Premiere Pro timeline** with Claude.

OpenCutAgent is a Premiere Pro panel that cuts your footage the way an editor does: transcribe what is said, find the dead air, the filler, the false starts and the duplicate takes, and remove them from your real sequence. The AI judgment is always **Claude**. There is no other model behind it.

You install it once, restart Premiere, and open the panel. Everything else starts by itself: the panel launches its own local engine in the background the moment it opens, and shuts it down when you close it. There is no terminal to keep open and no server to babysit.

The AI runs on your own **Claude Code** login (your Claude subscription, no per-token bill). Transcription, the one paid piece, uses your own **ElevenLabs** key and is billed only for what is actually on the timeline. Nothing goes through anyone's server but yours. There is also an optional hosted mode (the **Self-hosted** switch in the panel settings turns it off) where transcription and the AI run on an OpenCutAgent account instead; this README describes the default, self-hosted setup.

One tab is free either way: **Remove Silences** measures loudness locally with ffmpeg. No key, no network, no account.

## What it does

- **Remove Silences** tab (free): loudness-based dead-air removal. Waveform with a draggable threshold, live-recomputing silence zones, pacing presets, margins, and an AI threshold suggestion.
- **Retakes** tab: transcript-based cleanup. The timeline is transcribed once (cached forever, only the source ranges actually on the timeline are billed) and listed as spoken segments. Claude marks duplicate takes, false starts and filler as Cut; you review, override, protect, then apply.
- **Soft Apply:** instead of deleting, lays colored markers on the timeline (one hue per retake group, green over the suggested keeper) so you can pick final takes by hand.
- **Fast apply:** big cut lists skip in-place razoring and rebuild the tightened sequence through Premiere's own XML round-trip. A 2-hour timeline with 2000+ cuts applies in seconds, with effects and transforms preserved.
- **Export transcript:** saves the kept speech as a YouTube-ready `.srt` whose caption times match the tightened video.
- **Live sync:** the panel follows Premiere's playhead, highlights the segment under it, and clicking a segment seeks the timeline.
- **Animation** tab: select a run of neighboring segments and chat with a Claude agent that builds a hand-drawn [Remotion](https://www.remotion.dev) animation for exactly that part of the narration (it gets the transcript with word-level timing and accepts reference images). The clip is rendered and placed on **V2** over the selected range automatically, as solid b-roll or as a transparent overlay (ProRes 4444 alpha). Chats, renders and sources are saved next to your `.prproj` in an "OpenCutAgent Animations" folder.
- **Chat control (optional):** talk to Claude Code ("remove the silences", "cut the duplicate takes") and watch the marks land live in the panel through MCP tools.

## How it works

```
Premiere Pro
└─ OpenCutAgent panel (cep-panel/)  ──evalScript──►  premiere.jsx (all timeline edits)
        │ WebSocket, 127.0.0.1:3001
        ▼
   local engine (server/, Node)  ──►  ffmpeg, transcription, cut planning, renders
        │                        ──►  AI: OpenCutAgent cloud  OR  your `claude` login
        ▲ MCP (optional)
   Claude Code chat (ppro_* tools)
```

- The **panel** is a small web page running inside Premiere. It only draws state and forwards timeline operations to `cep-panel/host/premiere.jsx`, the one file that touches Premiere's scripting API.
- The **engine** (`server/`) does the real work: hosts the local WebSocket the panel talks to, runs ffmpeg for loudness and audio extraction, transcribes, computes every cut list, renders animations, and either calls the OpenCutAgent cloud or spawns the `claude` CLI headlessly for the AI decisions. It also exposes the timeline as MCP tools for Claude Code.
- The **skills** (`.claude/skills/`) teach Claude the editing workflows. The same text is used by the headless calls, so both paths behave the same.

### What happens when you open the panel

1. The panel tries to connect to the engine on `127.0.0.1:3001` (the port is read from `~/.editagent/bridge-port` if it was ever moved).
2. If nothing answers, the panel starts the engine itself: it resolves its own install folder back to your clone of this repo, finds Node (Homebrew, `/usr/local`, nvm, or PATH on macOS; the standard install folders on Windows) and spawns `node server/index.js`. The pulse icon in the header pulses while that happens and turns green a moment later.
3. The engine widens its own PATH so ffmpeg, npm and `claude` are found even though Premiere launched it from the Dock, with no shell profile.
4. Closing the panel stops the engine it started. An engine started by something else (Claude Code, or you in a terminal) is left alone: the panel only starts one after a failed connect, so there is exactly one engine per machine and it never fights an existing one.

Premiere's own transcript is not readable from any API, so transcription runs on the **source media**: transcribe once, cache, map onto the timeline. A re-edit or reload never re-bills. The full picture (reconcile, the fast-apply ladder, chunked AI analysis) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Prerequisites

- **Adobe Premiere Pro 2024 to 2026** (CEP loads on current 26.x), macOS or Windows.
- **Node.js 18 or newer.** The engine runs on it. The installer adds it when missing (Homebrew or winget).
- **ffmpeg.** Loudness, audio extraction, renders. The installer adds it when missing.
- **[Claude Code](https://claude.ai/code)** installed and signed in. Every AI feature (the AI buttons, the Animation tab, chat control) runs through it on your Claude subscription. The installer tells you if it is missing but does not install it for you.
- **ElevenLabs API key** with the `speech_to_text` scope ([elevenlabs.io](https://elevenlabs.io)). Only for the Retakes tab (about $0.22 per hour of audio with Scribe v2). Added from the panel settings, not by hand.

Scanning audio, manual thresholds, manual keep/cut and every apply path work with nothing but Node and ffmpeg.

## Install

Nothing is compiled. The panel is a folder Premiere loads straight from your clone, and the engine is a Node program the panel starts by itself. Installing means: get the clone, install two npm dependencies, turn on Premiere's developer mode (it only loads unsigned panels with it on), and link the panel folder into Premiere's extensions folder. The install script does all of it and prints a check-by-check report. Pick one of three ways in.

### A. One line (macOS or Windows)

**macOS** (Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/leonardogrig/opencutagent/main/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/leonardogrig/opencutagent/main/install.ps1 | iex
```

The script clones the repo into `~/OpenCutAgent` (set `OPENCUTAGENT_DIR` to choose another folder), installs Node and ffmpeg if they are missing (Homebrew on macOS, winget on Windows, no admin rights needed), runs `npm install` for the engine, turns on developer mode, links the panel, and writes `.mcp.json`. It ends with either "All set" or a list of `[fix]` lines that name the exact command to run. Run it again any time; it only redoes what changed, so it is also the updater after a `git pull`.

### B. Let Claude do it

If you already use Claude Code, clone the repo, open Claude Code inside it and type `/setup`:

```bash
git clone https://github.com/leonardogrig/opencutagent.git
cd opencutagent
claude
```

The `setup` skill runs the same script in check mode, installs what it reports missing (asking before anything system-wide), runs it for real, verifies with the test suite, and tells you what to click next. The same skill is the troubleshooter later: "the panel is not showing" or "ffmpeg is red in Health" and it works from the script's report instead of guessing.

### C. By hand

Replace `/path/to/opencutagent` (or `C:\path\to\opencutagent`) with wherever you clone the repo.

1. **Clone and install the engine's dependencies**

   ```bash
   git clone https://github.com/leonardogrig/opencutagent.git
   cd opencutagent/server
   npm install
   ```

   This is the step people forget. Without it the engine cannot start and the panel sits on "Starting server…" forever.

2. **Turn on Premiere's developer mode for panels** (once; CSXS.11 covers Premiere 2024, CSXS.12 covers 2025 and 2026)

   macOS:

   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   defaults write com.adobe.CSXS.12 PlayerDebugMode 1
   ```

   Windows (PowerShell):

   ```powershell
   reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
   reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```

3. **Link the panel into Premiere's extensions folder.** Link, do not copy: the panel finds the engine by walking up from its own folder to the clone. A copy cannot find it.

   macOS:

   ```bash
   mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
   ln -s /path/to/opencutagent/cep-panel \
         ~/Library/Application\ Support/Adobe/CEP/extensions/com.opencutagent.panel
   ```

   Windows (PowerShell; a junction needs no admin rights):

   ```powershell
   New-Item -ItemType Junction `
     -Path "$env:APPDATA\Adobe\CEP\extensions\com.opencutagent.panel" `
     -Target "C:\path\to\opencutagent\cep-panel"
   ```

### Then open it

Restart Premiere, open a project and a sequence, then **Window ▸ Extensions ▸ OpenCutAgent**. The panel starts its engine on its own. Click the **pulse icon** in the panel header: the Health dropdown lists everything the panel needs (engine, Premiere host script, Node, ffmpeg, Claude Code) with a green or red dot each, and a red row says what to do. If no ElevenLabs key is set yet, an extra row offers to add one. Then click **Scan Audio** in the Remove Silences tab: the waveform appears within a few seconds.

## First run: keys and settings

Open the panel settings (the gear icon in the header).

- **ElevenLabs**: click **Add API key** and paste your key. The panel stores it in the repo's `.env` for you. Only needed for the Retakes tab; the first time you click Transcribe without a key, this dialog opens on its own.
- **Model / Effort**: which Claude model the AI buttons use. The list comes live from your `claude` CLI, so it always shows what your subscription offers.
- **Sync with Claude Code**: off by default. Leave it off unless you want chat control (next section).
- **Self-hosted**: on by default, and what this README describes. Turning it off switches the AI and transcription to a hosted OpenCutAgent account (Google sign-in from the panel). The mode is stored per machine in `~/.opencutagent/cloud.json`, not in the repo. Cloud mode still needs the local engine, Node and ffmpeg, and the Animation tab still needs the `claude` CLI installed.

## Optional: drive it from a Claude Code chat (Sync mode)

Self-hosted only. Instead of clicking the AI buttons you talk to Claude Code, and Claude edits the timeline through MCP tools while the panel shows the marks live.

1. Copy the MCP config and point it at your clone:

   ```bash
   cd /path/to/opencutagent
   cp .mcp.json.example .mcp.json     # Windows: copy .mcp.json.example .mcp.json
   ```

   ```json
   {
     "mcpServers": {
       "premiere": {
         "type": "stdio",
         "command": "node",
         "args": ["/absolute/path/to/opencutagent/server/index.js"],
         "timeout": 600000
       }
     }
   }
   ```

   Use an **absolute** path; Claude Code does not expand `${VAR}` in `.mcp.json`. On Windows write it with forward slashes, for example `C:/path/to/opencutagent/server/index.js`.

2. Start Claude Code **from the repo folder** so it loads `.mcp.json` and the bundled skills, and approve the `premiere` server when asked:

   ```bash
   cd /path/to/opencutagent
   claude
   ```

3. Open the panel in Premiere (or leave it open; it reconnects on its own) and turn **Sync with Claude Code** on in the settings. Start the Claude Code session before the panel when you can: its engine then owns the port and the panel simply connects to it instead of starting a second one.

Then ask: *"what's on the timeline?"*, *"remove the silences"*, *"analyze the retakes and cut the duplicates"*, *"trim V1.2 so it ends at 00:00:18:00"*. The `premiere-edit` skill runs a read, propose, confirm, execute, verify loop and previews destructive cuts before applying.

Prefer it available from any folder? Register it globally with `claude mcp add premiere --scope user -- node /path/to/opencutagent/server/index.js` and symlink the skills into `~/.claude/skills/`.

### Who starts the engine

One engine per machine, listening on port 3001 (or `PREMIERE_BRIDGE_PORT`), operating on whatever sequence is active in Premiere. Three ways to start it, all collision-safe:

1. **Opening the panel** starts it when nothing is listening. This is the normal case.
2. **Claude Code** starts it through `.mcp.json` when a session opens in the repo (Sync mode).
3. **By hand:** `npm start` from the repo root (`npm stop` ends it), or double-click `start-opencutagent.command` on macOS. Useful when you want to see the engine's log.

After changing engine code, restart whatever started it (there is no hot reload): reopen the panel, or in Claude Code run `/mcp` and reconnect `premiere`.

## Use it: Remove Silences (loudness-based, free)

1. Open a project and a sequence, open the panel, click **Scan Audio**. The engine measures each clip's loudness (ffmpeg, cached per source) and the panel draws the waveform with silences highlighted and a draggable **Noise Threshold** line.
2. **Tune live**: drag the threshold, edit the ms fields (minimum silence length, keep-talk, margins), or pick a pacing preset. The zones recompute instantly. The meter is normalized to the recording's own peak, so threshold values behave the way you expect from other silence tools.
3. **Suggest threshold** (optional): Claude reads the measured loudness stats and picks a threshold that fits the recording.
4. Pick the **Silence Management** mode: *Remove* (ripple, close gaps), *Keep gaps* (lift), *Mute*, or *Keep*.
5. **Remove Silences**. Undo restores the timeline.

## Use it: Retakes (transcript-based)

1. **Transcribe**: transcribes the timeline (cached; only the source ranges actually used on the timeline are billed) and lists indexed spoken segments, each starting as Keep. Stretches with no speech are auto-marked Cut. A project you already transcribed reloads from cache for free the next time you open the panel.
2. **Analyze w/ Claude**: Claude reads the transcript and marks duplicate takes, false starts and filler as Cut, keeping the most complete pass of each beat. Long timelines are analyzed in overlapping chunks for reliability.
3. **Review**: click a segment to expand; flip **Keep ⇄ Cut**, or **Protect** it so nothing ever cuts it. Overrides show a *Manual* badge. The list follows the playhead; clicking a segment's time seeks Premiere.
4. Optional extras before applying:
   - **Soft Apply** lays colored markers instead of deleting (green = suggested keeper); **Clear markers** removes only OpenCutAgent's markers.
   - **Remove pauses longer than [ms]** (on by default, 250 ms) also shrinks every stretch of no speech longer than your setting inside the kept speech, leaving about 0.12 s of air on each side.
   - **Remove fillers (um, uh)** (on by default) also cuts filler words out of kept segments.
   - **Export transcript** saves the kept speech as an `.srt`.
5. **Apply All**. Every cut point is placed in the quiet between words, refined against the recording's loudness, so a kept sentence never starts mid-word. "Remove gaps when applying" picks ripple vs lift. Large ripple applies (100+ cuts) build a **new sequence named `<sequence> - tightened`** through XML round-trip (fast, effects preserved); the original is untouched, so "undo" there is deleting the new sequence. Smaller applies edit in place and support **Undo last apply** and Cmd+Z.

## Use it: Animation

1. Run **Transcribe** in the Retakes tab, then in the Animation tab pick a run of neighboring segments to animate over. Or start a **raw animation** with no transcript; it lands at the playhead with the length you choose.
2. Choose a style and an output size, describe what you want, attach reference images if you like, and send. The agent builds the animation, renders it and places it on V2 over the selected range. You can keep chatting to refine it; every render gets a new versioned file.
3. Optional: give the agent **web access** with the two toggle buttons beside the chat box, next to the image button. Each is on or off per message, you can use either, both or neither, and they work in Self-hosted mode only. With both off (the default) the agent knows only what you tell it and what is in its workspace, and nothing leaves your machine except the chat itself.
   - **Web search** (globe): the agent can search the web and read public pages, the same WebSearch and WebFetch tools Claude Code has. Useful when a brand color, a logo, a product's wording or a fact has to be right.
   - **Your Chrome** (browser window): the agent can open pages in your own browser through the [Claude in Chrome](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) extension, logged in as you, and look at them (screenshots, page text) to reproduce a real interface faithfully, for example the dashboard of the product you are teaching. It only looks and reads: it is told never to submit forms, change settings, send, buy, delete or type credentials, and to stop and tell you when a page asks for a login or a CAPTCHA. It works in tabs it opens itself and leaves your other tabs alone.

   **Connecting your Chrome** is a one-time step done with Claude Code itself, because the panel's agent is the same `claude` CLI: install the extension from the Chrome Web Store (Chrome, Edge, Brave, Arc and other Chromium browsers work; not WSL), then run `claude --chrome` once in a terminal, signed in with the same Claude login the panel uses, and press Enter at the intro. That writes the browser bridge for that login. The panel's Health dropdown (pulse icon in the header) shows a "Claude in Chrome" row that turns green when it is connected; until then the browser toggle is ignored for the turn and the chat tells you once. Claude in Chrome needs a Claude Pro, Max, Team or Enterprise login (sign in with `/login`; it does not work with an API key or a `claude setup-token` token). Every lookup is a normal turn on your Claude subscription, exactly as in Claude Code.

The first animation on a machine takes a few extra minutes: the engine copies the Remotion kit to `~/.opencutagent/animation-kit`, runs `npm install` there, and Remotion downloads its own headless Chromium (a few hundred MB). The panel reports the progress; later runs skip all of it.

## The AI: one judge, two transports

The AI decisions (which take to keep, what threshold counts as silence, what to draw) are always made by Claude. The settings pick how the call is made:

- **Headless (default):** the AI buttons spawn `claude -p` in the background on your Claude subscription. The call is a pure judgment oracle: segment data in, JSON decision out, with no tools and no access to Premiere, your files or the network. A stray `ANTHROPIC_API_KEY` in your environment is scrubbed so nothing silently bills per token.
- **Sync:** the buttons defer to your open Claude Code chat, where Claude drives the `ppro_*` tools and pushes results into the panel live.
- **Cloud (Self-hosted switch off):** the engine sends the segment data to the OpenCutAgent service with your account token and gets JSON decisions back. The Animation agent still runs locally through the `claude` CLI but bills through the account.

All three write the same engine state and render identically in the panel.

## MCP tools

| Tool | What it does |
|---|---|
| `ppro_get_timeline_state` | Read the sequence: clips (ids like `V1.2`), source paths, timecodes, gaps, `revision`. |
| `ppro_identify_segments` | Transcribe a clip's source (cached) into phrases / silences / fillers at timeline timecodes. |
| `ppro_trim_clip` | Set absolute new edges for one clip (idempotent). |
| `ppro_remove_gaps` | Ripple-close empty gaps. |
| `ppro_remove_silences` | Transcribe, build a cut list (silences + fillers), ripple-delete. Use `dry_run: true` first. |
| `ppro_analyze_audio_levels` | Measure timeline loudness (ffmpeg, no transcription): noise-floor/speech stats + suggested threshold. |
| `ppro_remove_silences_by_level` | Loudness-based silence removal from chat: threshold, cut list, ripple/lift/mute. `dry_run` first. |
| `ppro_get_retake_segments` | Transcribe into indexed segments for Claude to analyze for retakes/duplicates. |
| `ppro_mark_retakes` | Record keep/cut decisions; pushes them live to the panel. |
| `ppro_apply_retakes` | Apply the current marks (ripple/lift-delete the Cut segments). |
| `ppro_run_script` | Escape hatch: run arbitrary ExtendScript. |

## Verify the install

```bash
cd /path/to/opencutagent/server
npm run check     # parses every module and flags missing imports
npm test          # unit + feature + smoke tests (no Premiere or API key needed)
npm run smoke     # boots the engine and lists its MCP tools over stdio
```

Then open the panel: the pulse icon in the header should be green, and its Health dropdown all green. Click **Scan Audio**.

From a terminal, `./install.sh --check` (Windows: `.\install.ps1 -Check`) prints the same prerequisites plus the install state (developer mode, panel link, engine dependencies) without changing anything.

## Troubleshooting

Start with the **pulse icon** in the panel header (the Health dropdown) or `./install.sh --check`: both show what is missing and the fix. Or open Claude Code in the repo and type `/setup`. The usual suspects:

- **The pulse icon keeps pulsing, or the Engine row says "Waiting for server".** The engine is being started but crashes at boot. Almost always `npm install` was never run in `server/`. Run `node server/index.js` in a terminal from the repo root to see the real error, fix it, then reopen the panel.
- **"Server not found. Run: node server/index.js".** The panel could not find `server/index.js` next to its own folder, which happens when `cep-panel` was **copied** into the extensions folder instead of linked. Replace the copy with a symlink or junction (Install step 3), or start the engine by hand each time.
- **"Node not found".** Install Node ([nodejs.org](https://nodejs.org) or `brew install node`) and reopen the panel. The panel looks in the Homebrew, `/usr/local`, nvm and standard Windows locations, then on PATH.
- **"Not in Premiere".** You opened `index.html` in a normal browser. That is fine for looking at the UI, but the panel only works inside Premiere.
- **Panel not in the Extensions menu.** Re-check the developer-mode commands (step 2) and that the link points at `cep-panel/`. Restart Premiere.
- **"You're in cloud mode but not signed in" or "Couldn't reach the OpenCutAgent cloud".** The Self-hosted switch was turned off. Open the settings and turn it back on (or sign in, if you have a hosted account).
- **"Unknown RPC method …" after updating the code.** An engine running the old code still owns the port, usually one started by a second Claude Code window in the repo. Keep one window, then `/mcp` and reconnect `premiere`, or restart the session. A stray engine can be found with `lsof -nP -iTCP:3001 -sTCP:LISTEN` (Windows: `netstat -ano | findstr :3001`) and killed by PID.
- **"EvalScript error."** `premiere.jsx` did not load; close and reopen the panel.
- **Port 3001 busy.** Set `PREMIERE_BRIDGE_PORT` in `.env`; the panel reads the negotiated port from `~/.editagent/bridge-port`.
- **ffmpeg not found although it is installed.** Set `FFMPEG_BIN` to its full path in the settings' Advanced section (or in `.env`).
- **Transcription fails in Self-hosted mode.** Confirm the ElevenLabs key is set and has the **speech_to_text** scope. The Remove Silences tab needs neither a key nor network.
- **AI buttons say "OAuth session expired" in Self-hosted mode.** The engine is using a different Claude login folder than the one you signed in to. Run `claude` in a terminal and type `/login`, or set `EDITAGENT_CLAUDE_CONFIG_DIR` in the Advanced settings to the folder you use.
- **A "Translation Report" alert during a big apply.** Benign: Premiere logs source-interpretation entries it re-derives on import. The report lands in `.cache/rebuild/` if you want to read it.

## Good to know

OpenCutAgent is built for the common case: talking-head footage on a normal A/V timeline. Two automatic behaviors worth knowing about:

- **Big applies build a new sequence.** Large ripple applies rebuild the tightened cut through Premiere's own XML round-trip (seconds instead of minutes, effects and transforms preserved); the original sequence is left untouched as a backup.
- **The fast path steps aside when it must.** Timelines with titles/graphics or speed-changed clips are applied by the slower in-place razor path instead. Everything still applies either way.

The transcription engine is pluggable (ElevenLabs Scribe v2 today); the engine interface in `server/transcription/transcribe.js` accepts a Deepgram/Whisper drop-in.

## Before you rely on it: disclaimers, data, and third-party licenses

**Keep backups.** OpenCutAgent razors, deletes and moves clips on your live timeline, creates new sequences, and can overwrite footage on a chosen video track. Some of that cannot be undone in a single step. Your original camera files are never modified or deleted, but project structure and edit decisions are. Work on a copy of anything you cannot afford to lose.

**Check the AI's work.** Transcription misrecognises words. Retake analysis keeps takes it should cut and cuts takes it should keep. Silence detection can trim quiet speech. Review every automated change before you deliver work to anyone. Nothing here is a guarantee of accuracy or fitness for your purpose.

**No warranty.** The software is provided as-is, without warranty of any kind, and the author is not liable for lost or damaged projects, sequences, renders or media. See [LICENSE](LICENSE).

**What leaves your machine.** Your video files, project file and rendered animations never leave your computer in either mode. What does leave, and where it goes, depends on the mode:

| Mode | What is sent | To whom |
| --- | --- | --- |
| Self-hosted (own keys) | Audio of the timeline sections you transcribe; transcript text and your prompts. With the Animation web toggles on: the agent's searches, the public pages it reads and, with "Your Chrome", what it sees in the tabs it opens in your browser | Directly to *your* ElevenLabs account and *your* Claude login. Nothing reaches the author. |
| Cloud | The same audio and text | The OpenCutAgent service, then onward to its transcription and AI providers. See the hosted [Privacy Policy](https://opencutagent.com/privacy) and [Terms](https://opencutagent.com/terms). |

Transcripts and audio extracts are cached on your own disk under `.cache/`. Clear them any time from the panel's settings (Storage, then Clear cache).

**Third-party licenses are your responsibility.**

- **Adobe Premiere Pro**: you need your own Adobe license. OpenCutAgent is an independent project, not affiliated with, endorsed by or sponsored by Adobe. Adobe and Premiere Pro are trademarks of Adobe Inc.
- **Remotion** (the Animation tab renders locally with it): free for individuals, non-profits and companies of three people or fewer. **Larger for-profit companies need their own Remotion license.** That agreement is between you and Remotion; it is not granted by this project and no fee here covers it. See [remotion.dev/docs/license](https://www.remotion.dev/docs/license).
- **FFmpeg**: used for audio analysis and encoding under its own open-source license.
- **ElevenLabs and Anthropic**: in Self-hosted mode you use your own accounts, under their terms.
- Other names (Claude, Anthropic, ElevenLabs, OpenRouter, Remotion, n8n) are trademarks of their respective owners and are used only to describe compatibility.

**The animation assistant runs a coding agent on your machine.** It writes and runs code in its own workspace (`~/.opencutagent/animation-kit`) to build each animation. Only enable it on a machine where that is acceptable to you. With the "Your Chrome" toggle on it can also open pages in your signed-in browser; it is instructed to look and read only, but it is an AI agent acting in your browser, so keep an eye on it and leave the toggle off when you do not need it.

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces talk, the fast-apply ladder, the design rules.
- [CONTRIBUTING.md](CONTRIBUTING.md): dev setup, tests, reload matrix, platform gotchas.
- `install.sh` / `install.ps1`: the installer and updater; `--check` / `-Check` reports without changing anything. `.claude/skills/setup/` is the Claude Code skill that drives it.
- [cep-panel/DESIGN.md](cep-panel/DESIGN.md): the panel's design system.

## License

[MIT with Commons Clause](LICENSE). In short: free to use, modify, and share for yourself or your team, but you may not sell OpenCutAgent or offer it (or a product/service substantially built on it) commercially. That right is reserved by the author.
