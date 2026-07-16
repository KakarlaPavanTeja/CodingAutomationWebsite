# Check local dev prerequisites (Git, Node 20+, npm, Python 3.11+).
# All credentials and config live in .env.local — copy .env.example and fill it in.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -Yes
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -InstallSystemDeps -Yes
#
# Before running the app:
#   1. Copy-Item .env.example .env.local  (fill in DATABASE_URL, API keys, etc.)
#   2. npm install
#   3. py -3.11 -m venv $env:USERPROFILE\.codingautomation-venv; pip install -r pipeline/requirements.txt
#   4. npm run dev
param(
    [switch]$Yes,
    [switch]$InstallSystemDeps
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

function Write-Info($msg)  { Write-Host "-> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "OK $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "X  $msg" -ForegroundColor Red; exit 1 }

function Has-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
}

function Get-NodeVersion {
    if (-not (Has-Command "node")) { return "0" }
    return (node -v).TrimStart("v")
}

function Get-PythonSuitable {
    foreach ($c in @(
        @{ Exe = "py"; Args = @("-3.13") },
        @{ Exe = "py"; Args = @("-3.12") },
        @{ Exe = "py"; Args = @("-3.11") },
        @{ Exe = "py"; Args = @("-3") },
        @{ Exe = "python"; Args = @() },
        @{ Exe = "python3"; Args = @() }
    )) {
        if (-not (Has-Command $c.Exe)) { continue }
        try {
            $verOut = & $c.Exe @($c.Args) -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $majorMinor = ($verOut.Trim() -split "\.")[0..1] -join "."
            if ([version]$majorMinor -ge [version]"3.11") {
                return @{ Exe = $c.Exe; Args = $c.Args; Version = $verOut.Trim() }
            }
        } catch { }
    }
    return $null
}

function Install-WingetPackage($id, $label) {
    if (-not (Has-Command "winget")) {
        Write-Warn "winget not found - install $label manually, then re-run."
        return
    }
    Write-Info "Installing $label via winget..."
    winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        winget install --id $id -e --accept-source-agreements --accept-package-agreements
    }
    Refresh-Path
}

function Install-WindowsSystemDeps {
    if (-not (Has-Command "git")) { Install-WingetPackage "Git.Git" "Git" }
    $nodeVer = Get-NodeVersion
    if (-not (Has-Command "node") -or [version]$nodeVer -lt [version]"20.0.0") {
        Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
    }
    if (-not (Get-PythonSuitable)) {
        Install-WingetPackage "Python.Python.3.11" "Python 3.11"
    }
    Write-Ok "System dependency install attempted - restart PowerShell if a tool is still not found."
}

function Collect-PrerequisiteIssues {
    $issues = @()
    if (-not (Has-Command "git")) { $issues += "git: not installed" }
    $nodeVer = Get-NodeVersion
    if (-not (Has-Command "node")) { $issues += "nodejs: not installed (need v20+)" }
    elseif ([version]$nodeVer -lt [version]"20.0.0") { $issues += "nodejs: v$nodeVer installed (need v20+)" }
    if (-not (Has-Command "npm")) { $issues += "npm: not installed" }
    if (-not (Get-PythonSuitable)) { $issues += "python3: need v3.11+" }
    return $issues
}

function Fix-PrerequisitesIfNeeded {
    $issues = Collect-PrerequisiteIssues
    if ($issues.Count -eq 0) { return }

    Write-Host ""
    Write-Warn "Prerequisite issues found:"
    foreach ($i in $issues) { Write-Host "  * $i" }
    Write-Host ""

    $doInstall = $Yes -or $InstallSystemDeps
    if (-not $doInstall) {
        $answer = Read-Host "Install missing tools automatically (winget)? (Y/n)"
        $doInstall = ($answer -eq "" -or $answer -match "^[Yy]")
    }
    if (-not $doInstall) { Write-Fail "Prerequisites not met. Re-run with: -InstallSystemDeps -Yes" }

    Install-WindowsSystemDeps
    $issues = Collect-PrerequisiteIssues
    if ($issues.Count -gt 0) {
        Write-Warn "Still unresolved - close and reopen PowerShell, then re-run setup:"
        foreach ($i in $issues) { Write-Host "  * $i" }
        Write-Fail "Prerequisites not met."
    }
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Coding Automation - Dependency Check"
Write-Host "========================================"
Write-Host ""

Write-Info "Checking prerequisites..."
Fix-PrerequisitesIfNeeded
$py = Get-PythonSuitable
if (-not $py) { Write-Fail "Python 3.11+ not available." }
Write-Ok "git $(git --version)"
Write-Ok "node v$(Get-NodeVersion)"
Write-Ok "npm v$(npm -v)"
Write-Ok "python $($py.Version)"
Write-Host ""

$envFile = Join-Path $Root ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Warn ".env.local not found - copy .env.example and fill in your credentials before starting the app:"
    Write-Host "  Copy-Item .env.example .env.local"
} else {
    Write-Ok ".env.local present"
}

Write-Host ""
Write-Host "========================================"
Write-Host "Prerequisites OK" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "  Next steps (if you haven't already):"
Write-Host "    Copy-Item .env.example .env.local   # fill in DATABASE_URL, API keys, AWS creds"
Write-Host "    npm install"
Write-Host "    py -3.11 -m venv `$env:USERPROFILE\.codingautomation-venv"
Write-Host "    `$env:USERPROFILE\.codingautomation-venv\Scripts\pip install -r pipeline/requirements.txt"
Write-Host "    npm run dev                         # http://localhost:5001"
Write-Host ""
