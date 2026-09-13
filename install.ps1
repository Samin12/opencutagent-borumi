<#
OpenCutAgent installer for Windows (PowerShell). Idempotent: run it again after
a `git pull` and it only redoes what changed, so it doubles as the updater.

  .\install.ps1            install or update everything
  .\install.ps1 -Check     report what is installed and what is missing, change nothing

One-line install (clones into $HOME\OpenCutAgent, or $env:OPENCUTAGENT_DIR):
  irm https://raw.githubusercontent.com/leonardogrig/opencutagent/main/install.ps1 | iex

Every line of the report starts with [ok], [did], [fix] or [note] so a person
or a Claude Code session (the /setup skill) can read it and act on the [fix] lines.
No admin rights are needed: the panel is linked with a directory junction.
#>
param([switch]$Check)

$ErrorActionPreference = "Continue"
$RepoUrl = "https://github.com/leonardogrig/opencutagent.git"
$ExtId   = "com.opencutagent.panel"
$ExtDir  = Join-Path $env:APPDATA "Adobe\CEP\extensions"
$script:Missing = 0

function Ok($m)   { Write-Host "[ok]   $m" }
function Did($m)  { Write-Host "[did]  $m" }
function Note($m) { Write-Host "[note] $m" }
function Fix($m)  { Write-Host "[fix]  $m"; $script:Missing++ }

# Tools installed a moment ago are not on this session's PATH yet; re-read it.
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  foreach ($d in @("$env:ProgramFiles\nodejs", "$env:LOCALAPPDATA\Programs\nodejs", "$env:USERPROFILE\.local\bin", "$env:APPDATA\npm")) {
    if ((Test-Path $d) -and ($env:Path -notlike "*$d*")) { $env:Path += ";$d" }
  }
}
Refresh-Path

# ---------------------------------------------------------------- repo root
$Root = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot "server\index.js"))) { $Root = $PSScriptRoot }
if (-not $Root) {
  $Root = if ($env:OPENCUTAGENT_DIR) { $env:OPENCUTAGENT_DIR } else { Join-Path $HOME "OpenCutAgent" }
  if (Test-Path (Join-Path $Root "server\index.js")) {
    if ($Check) { Ok "Repo at $Root" }
    else {
      Push-Location $Root; git pull --ff-only -q 2>$null
      if ($LASTEXITCODE -eq 0) { Did "Updated the repo at $Root" } else { Note "Could not git pull in $Root (local changes?). Continuing with what is there." }
      Pop-Location
    }
  } elseif ($Check) {
    Fix "No OpenCutAgent clone at $Root. Run without -Check to clone it, or run this script from inside a clone."
    Write-Host ""; Write-Host "$script:Missing thing(s) to fix."; exit 1
  } else {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fix "git is missing. Install it: winget install Git.Git   then re-run."; exit 1 }
    git clone -q $RepoUrl $Root
    if ($LASTEXITCODE -eq 0) { Did "Cloned OpenCutAgent into $Root" } else { Fix "git clone failed (network?)"; exit 1 }
  }
}
Write-Host "OpenCutAgent at: $Root"
if ($Check) { Write-Host "(check only, nothing will be changed)" }
Write-Host ""

$HaveWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)

# ---------------------------------------------------------------- Node >= 18
function Node-Major { try { $v = (& node -v 2>$null); if ($v -match '^v(\d+)') { [int]$Matches[1] } else { 0 } } catch { 0 } }
if ((Get-Command node -ErrorAction SilentlyContinue) -and ((Node-Major) -ge 18)) {
  Ok "Node.js $(& node -v)"
} elseif (-not $Check -and $HaveWinget) {
  Write-Host "Installing Node.js with winget (this can take a minute)..."
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if ((Get-Command node -ErrorAction SilentlyContinue) -and ((Node-Major) -ge 18)) { Did "Installed Node.js $(& node -v)" }
  else { Fix "Node.js 18+ is missing and the winget install did not take. Install it from https://nodejs.org, open a NEW PowerShell window, and re-run." }
} else {
  Fix "Node.js 18+ is missing. Install it with: winget install OpenJS.NodeJS.LTS   (or from https://nodejs.org), open a new PowerShell window, then re-run this script."
}

# ---------------------------------------------------------------- ffmpeg
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  $fv = (& ffmpeg -version 2>$null | Select-Object -First 1) -replace '^ffmpeg version (\S+).*', '$1'
  Ok "ffmpeg $fv"
} elseif (-not $Check -and $HaveWinget) {
  Write-Host "Installing ffmpeg with winget (this can take a few minutes)..."
  winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Did "Installed ffmpeg" }
  else { Fix "ffmpeg is missing and the winget install did not take. Install it (https://www.gyan.dev/ffmpeg/builds/), put its bin folder on PATH, open a new PowerShell window, and re-run." }
} else {
  Fix "ffmpeg is missing. Install it with: winget install Gyan.FFmpeg   then open a new PowerShell window and re-run this script."
}

# ---------------------------------------------------------------- Claude Code
$claudeCmd = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeCmd -and (Test-Path "$env:USERPROFILE\.local\bin\claude.exe")) { $claudeCmd = "$env:USERPROFILE\.local\bin\claude.exe" }
if ($claudeCmd) {
  $cv = (& claude --version 2>$null | Select-Object -First 1) -replace '\s*\(Claude Code\)', ''
  Ok "Claude Code $cv"
  Note "Make sure it is signed in: run 'claude' once in a terminal (AI features run on your Claude subscription)."
} else {
  Fix "Claude Code is missing (needed for every AI feature). Install: irm https://claude.ai/install.ps1 | iex   then run 'claude' once to sign in, and re-run this script."
}

# ---------------------------------------------------------------- engine dependencies
$ServerDir = Join-Path $Root "server"
if ($Check) {
  if ((Test-Path (Join-Path $ServerDir "node_modules\ws")) -and (Test-Path (Join-Path $ServerDir "node_modules\@modelcontextprotocol"))) { Ok "Engine dependencies installed (server\node_modules)" }
  else { Fix "Engine dependencies are not installed. Run: cd `"$ServerDir`"; npm install" }
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location $ServerDir
  & npm install --no-audit --no-fund --loglevel=error | Out-Null
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -eq 0) { Did "Engine dependencies installed (server\node_modules)" } else { Fix "npm install failed in $ServerDir. Run it by hand to see the error." }
} else {
  Fix "npm is missing (it comes with Node.js). Install Node.js, then run: cd `"$ServerDir`"; npm install"
}

# ---------------------------------------------------------------- CEP developer mode
# Premiere only loads unsigned panels with PlayerDebugMode on. CSXS.11 = Premiere 2024, CSXS.12 = 2025/2026.
foreach ($v in 11, 12) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  $cur = $null
  try { $cur = (Get-ItemProperty -Path $key -Name PlayerDebugMode -ErrorAction Stop).PlayerDebugMode } catch {}
  if ("$cur" -eq "1") { Ok "Premiere developer mode on (CSXS.$v)" }
  elseif ($Check) { Fix "Premiere developer mode is off for CSXS.$v. Run: reg add HKCU\Software\Adobe\CSXS.$v /v PlayerDebugMode /t REG_SZ /d 1 /f" }
  else {
    try {
      if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
      New-ItemProperty -Path $key -Name PlayerDebugMode -Value "1" -PropertyType String -Force | Out-Null
      Did "Turned on Premiere developer mode (CSXS.$v)"
    } catch { Fix "Could not write $key PlayerDebugMode: $($_.Exception.Message)" }
  }
}

# ---------------------------------------------------------------- panel link (junction, no admin needed)
# A LINK, never a copy: the panel finds the engine by walking up from its own real path.
$Link   = Join-Path $ExtDir $ExtId
$Target = Join-Path $Root "cep-panel"
function Link-Target($p) { try { (Get-Item $p -Force).Target | Select-Object -First 1 } catch { $null } }
$existing = Get-Item $Link -Force -ErrorAction SilentlyContinue
$linkedRight = $existing -and $existing.Attributes -band [IO.FileAttributes]::ReparsePoint -and ((Link-Target $Link) -ieq $Target)
if ($linkedRight) { Ok "Panel linked into Premiere ($Link)" }
elseif ($Check) { Fix "Panel is not linked into Premiere. Run: New-Item -ItemType Junction -Path `"$Link`" -Target `"$Target`"" }
else {
  New-Item -ItemType Directory -Path $ExtDir -Force | Out-Null
  if ($existing) {
    if ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) { cmd /c rmdir "$Link" | Out-Null }
    else { $bak = "$Link.bak-$(Get-Date -Format yyyyMMddHHmmss)"; Move-Item $Link $bak; Note "Moved an old copy of the panel aside to $bak" }
  }
  try { New-Item -ItemType Junction -Path $Link -Target $Target | Out-Null; Did "Linked the panel into Premiere ($Link)" }
  catch { Fix "Could not create the junction at ${Link}: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- .mcp.json (chat control from Claude Code)
$Mcp = Join-Path $Root ".mcp.json"
$fwd = ($Root -replace '\\', '/') + "/server/index.js"
if (Test-Path $Mcp) {
  if ((Get-Content $Mcp -Raw) -like "*$fwd*") { Ok ".mcp.json points at this clone" }
  else { Note ".mcp.json exists but does not point at $fwd (fine if you moved things on purpose)." }
} elseif ($Check) {
  Note "No .mcp.json yet (only needed to drive the panel from a Claude Code chat)."
} else {
  @"
{
  "mcpServers": {
    "premiere": {
      "type": "stdio",
      "command": "node",
      "args": ["$fwd"],
      "timeout": 600000
    }
  }
}
"@ | Set-Content -Path $Mcp -Encoding UTF8
  Did "Wrote .mcp.json so a Claude Code chat opened in $Root can drive the panel"
}

# ---------------------------------------------------------------- summary
Write-Host ""
if ($script:Missing -gt 0) {
  Write-Host "$script:Missing thing(s) to fix (the [fix] lines above). Fix them and run this script again."
  exit 1
}
if (Get-Process "Adobe Premiere Pro" -ErrorAction SilentlyContinue) { Note "Premiere Pro is running: quit and reopen it so it picks up the panel." }
Write-Host @"
All set. Next:
  1. Start (or restart) Premiere Pro and open a project.
  2. Window > Extensions > OpenCutAgent. The panel starts its own engine.
  3. Click the pulse icon in the panel header: every item should have a green dot.
  4. Retakes tab needs an ElevenLabs key: add it from the gear icon. Remove Silences needs nothing.
"@
