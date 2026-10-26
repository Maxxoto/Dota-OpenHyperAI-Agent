# Installs THIS fork (git clone) into Dota 2.
#
# The quick-install-oha scripts install the Steam Workshop copy: they link
# only bots/ from the workshop item. This fork also ships game/ (addon scripts
# and the FretBots auto-start loader) and needs both folders linked from the
# clone. Existing folders are renamed with a timestamp, never deleted.
#
# Symlinks need Developer Mode or an elevated shell; junctions are used when
# symlink creation is denied.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File quick-install-fork.ps1
#   powershell -ExecutionPolicy Bypass -File quick-install-fork.ps1 -VScripts "D:\Steam\steamapps\common\dota 2 beta\game\dota\scripts\vscripts"
param(
    [string]$RepoRoot = "",
    [string]$VScripts = ""
)

$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "FAILED: $msg" -ForegroundColor Red; exit 1 }

if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path }
if (-not $VScripts) {
    $steam = $null
    try { $steam = (Get-ItemProperty "HKCU:\Software\Valve\Steam" -ErrorAction Stop).SteamPath } catch {}
    if (-not $steam) { try { $steam = (Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Valve\Steam" -ErrorAction Stop).InstallPath } catch {} }
    if (-not $steam) { $steam = "C:\Program Files (x86)\Steam" }
    $VScripts = Join-Path $steam "steamapps\common\dota 2 beta\game\dota\scripts\vscripts"
}

if (-not (Test-Path (Join-Path $RepoRoot "bots\hero_selection.lua"))) { Fail "Repo root not found: $RepoRoot" }
if (-not (Test-Path (Join-Path $RepoRoot "game\gameinit.lua"))) { Fail "game\ not found in $RepoRoot" }
if (-not (Test-Path $VScripts)) { Fail "vscripts not found: $VScripts (pass -VScripts)" }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Link-Or-Junction($name, $target) {
    $path = Join-Path $VScripts $name
    if (Test-Path $path) {
        $leaf = "$name.old_$stamp"
        Write-Host "Renaming existing $name -> $leaf"
        Rename-Item -LiteralPath $path -NewName $leaf
    }
    try {
        New-Item -ItemType SymbolicLink -Path $path -Target $target | Out-Null
    } catch {
        Write-Host "Symbolic link failed ($($_.Exception.Message)); trying junction..."
        cmd /c mklink /J "$path" "$target" | Out-Null
    }
    if (-not (Test-Path $path)) { Fail "could not link $name" }
}

Link-Or-Junction "bots" (Join-Path $RepoRoot "bots")
Link-Or-Junction "game" (Join-Path $RepoRoot "game")

# The permanent config tier lives inside the clone's game\Customize (gitignored).
$cust = Join-Path $RepoRoot "game\Customize"
if (-not (Test-Path $cust)) {
    New-Item -ItemType Directory -Path $cust -Force | Out-Null
    Copy-Item (Join-Path $RepoRoot "bots\Customize\general.lua") $cust
    Write-Host "Created $cust with a copy of general.lua"
}

foreach ($f in @("bots\hero_selection.lua", "game\gameinit.lua", "game\fretbots_autostart.lua")) {
    if (-not (Test-Path (Join-Path $VScripts $f))) { Fail "verification failed for $f" }
}

$llmLua = Join-Path $cust "llm.lua"
if (-not (Test-Path $llmLua)) {
    Copy-Item (Join-Path $RepoRoot "bots\Customize\llm.example.lua") $llmLua
    Write-Host "Created $llmLua from llm.example.lua"
}
$key = Read-Host "Paste Groq API key for the LLM advisor (Enter to skip)"
if ($key) {
    $t = [IO.File]::ReadAllText($llmLua)
    $t = $t.Replace('APIKey = ""', 'APIKey = "' + $key + '"')
    [IO.File]::WriteAllText($llmLua, $t)
    Write-Host "Groq key written to $llmLua"
} else {
    Write-Host "No key set. Edit $llmLua and fill in APIKey later."
}

Write-Host ""
if (Test-Path $llmLua) {
    Write-Host "LLM config: $llmLua"
    Select-String -Path $llmLua -Pattern "APIKey|Model|Enable" | ForEach-Object { Write-Host "  $($_.Line.Trim())" }
} else {
    Write-Host "WARNING: $llmLua was not created" -ForegroundColor Yellow
}
Write-Host "Install complete." -ForegroundColor Green
Write-Host "Lobby: Custom Lobby, Local Host, Local Dev Script, Enable Cheats."
Write-Host "FretBots needs once per game: sv_cheats 1; script_reload_code bots/fretbots"
