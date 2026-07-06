# One-command local dev setup for Windows (PowerShell). The app connects to the
# shared cloud (Neon) database via DATABASE_URL in team-secrets.env — no local Postgres.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -Yes
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -InstallSystemDeps -Yes
#
# Before running (one-time):
#   1. git clone <repo> && cd CodingAutomationWebsite
#   2. Copy-Item scripts/team-secrets.env.example scripts/team-secrets.env
#      then fill in OPENROUTER_API_KEY, ADMIN_SECRET_KEY, CRON_SECRET and the shared
#      DATABASE_URL (ask your team lead).
param(
    [switch]$Yes,
    [switch]$InstallSystemDeps
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$SecretsFile = Join-Path $Root "scripts\team-secrets.env"
$VenvDir = Join-Path $env:USERPROFILE ".codingautomation-venv"
$DbName = "codingautomation"
$DbPort = if ($env:DB_PORT) { $env:DB_PORT } else { "5432" }
$DatabaseUrlDefault = "postgresql://postgres:postgres@localhost:$DbPort/$DbName"

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

function Ensure-Docker {
    if (-not (Has-Command "docker")) {
        Write-Fail @"
Docker Desktop is required but was not found.
Install it: https://www.docker.com/products/docker-desktop/
Then start Docker Desktop (wait until the whale icon is steady) and re-run this script.
"@
    }
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail @"
Docker is installed but the daemon is not running.
Open Docker Desktop, wait until it reports 'running', then re-run this script.
"@
    }
    docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Docker Compose v2 not available. Update Docker Desktop to a recent version."
    }
    Write-Ok "Docker ready"
}

function Import-TeamSecrets {
    if (-not (Test-Path $SecretsFile)) {
        Write-Fail "Missing scripts/team-secrets.env - ask team lead, or: Copy-Item scripts/team-secrets.env.example scripts/team-secrets.env"
    }
    $map = @{}
    Get-Content $SecretsFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $map[$line.Substring(0, $eq).Trim()] = $line.Substring($eq + 1).Trim()
    }
    Write-Ok "Loaded scripts/team-secrets.env"
    return $map
}

function Fix-NpmForLocal {
    $lockFile = Join-Path $Root "package-lock.json"
    if ((Test-Path $lockFile) -and (Select-String -Path $lockFile -Pattern "package-firewall.replit.local" -Quiet)) {
        Write-Info "Fixing Replit-only npm URLs in package-lock.json..."
        (Get-Content $lockFile -Raw) -replace 'http://package-firewall.replit.local/npm/', 'https://registry.npmjs.org/' |
            Set-Content $lockFile -NoNewline
        Write-Ok "Patched package-lock.json"
    }
    "registry=https://registry.npmjs.org/" | Set-Content (Join-Path $Root ".npmrc.local") -Encoding UTF8
    $env:NPM_CONFIG_USERCONFIG = Join-Path $Root ".npmrc.local"
}

function Start-Database {
    Write-Info "Starting Postgres in Docker (service 'db', port $DbPort)..."
    $env:DB_PORT = $DbPort
    docker compose up -d db
    if ($LASTEXITCODE -ne 0) { Write-Fail "Failed to start Postgres container. Check: docker compose logs db" }

    Write-Info "Waiting for Postgres to become healthy..."
    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        docker compose exec -T db pg_isready -U postgres -d $DbName *> $null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { Write-Fail "Postgres did not become ready in time. Check: docker compose logs db" }
    Write-Ok "Postgres is ready on localhost:$DbPort (db=$DbName, user=postgres)"
}

function Schema-Exists {
    $out = docker compose exec -T db psql -U postgres -d $DbName -tAc "select 1 from information_schema.tables where table_schema='public' and table_name='users' limit 1" 2>$null
    return ($out -match "1")
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Coding Automation - Local Setup (Shared Cloud DB)"
Write-Host "========================================"
Write-Host ""

Write-Info "Step 1/5 - Checking prerequisites..."
Fix-PrerequisitesIfNeeded
$py = Get-PythonSuitable
if (-not $py) { Write-Fail "Python 3.11+ not available." }
$pyExe = $py.Exe; $pyArgs = $py.Args
Write-Ok "git $(git --version)"
Write-Ok "node v$(Get-NodeVersion)"
Write-Ok "npm v$(npm -v)"
Write-Ok "python $($py.Version)"
Write-Host ""

Write-Info "Step 2/5 - Loading secrets & configuring..."
$team = Import-TeamSecrets
foreach ($key in @("OPENROUTER_API_KEY", "CRON_SECRET", "DATABASE_URL")) {
    if (-not $team[$key]) { Write-Fail "$key missing in team-secrets.env - set the shared cloud (Neon) connection string (see scripts/team-secrets.env.example)." }
}
# ADMIN_SECRET_KEY is optional — only needed to self-register a NEW admin at signup.
if (-not $team["ADMIN_SECRET_KEY"]) { Write-Warn "ADMIN_SECRET_KEY not set — optional; existing accounts (including admins) work without it." }

$DATABASE_URL = $team["DATABASE_URL"]
$defaultAppUrl = if ($team["APP_URL"]) { $team["APP_URL"] } else { "http://localhost:5001" }
if ($Yes) {
    $APP_URL = $defaultAppUrl
} else {
    $inputApp = Read-Host "APP_URL [$defaultAppUrl]"
    $APP_URL = if ([string]::IsNullOrWhiteSpace($inputApp)) { $defaultAppUrl } else { $inputApp }
}
Write-Ok "DATABASE_URL set from team-secrets (shared cloud database)"
Write-Ok "Secrets loaded (OPENROUTER_API_KEY, CRON_SECRET, ADMIN_SECRET_KEY)"
Write-Host ""

Write-Info "Step 3/5 - Python virtual environment..."
Write-Info "Location: $VenvDir (outside repo)"
$venvPython = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    if ($pyArgs.Count -gt 0) { & $pyExe @pyArgs -m venv $VenvDir }
    else { & $pyExe -m venv $VenvDir }
    Write-Ok "Created venv"
} else {
    Write-Warn "Reusing existing venv"
}
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r pipeline/requirements.txt --quiet
Write-Ok "Python packages installed"
Write-Host ""

Write-Info "Step 4/5 - Writing .env.local & installing npm packages..."
$envFile = Join-Path $Root ".env.local"
if (Test-Path $envFile) {
    if (-not $Yes) {
        $overwrite = Read-Host ".env.local exists. Overwrite? (y/N)"
        if ($overwrite -notmatch "^[Yy]$") { Write-Fail "Aborted." }
    }
    Copy-Item $envFile "$envFile.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
}
$lines = @(
    "# Generated by scripts/setup-local.ps1 on $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')"
    "PIPELINE_ROOT=$Root\pipeline"
    "PYTHON_PATH=$venvPython"
    "OPENROUTER_API_KEY=$($team['OPENROUTER_API_KEY'])"
    "DATABASE_URL=$DATABASE_URL"
    "CRON_SECRET=$($team['CRON_SECRET'])"
)
if ($team["ADMIN_SECRET_KEY"]) { $lines += "ADMIN_SECRET_KEY=$($team['ADMIN_SECRET_KEY'])" }
if ($team["RESEND_API_KEY"]) { $lines += "RESEND_API_KEY=$($team['RESEND_API_KEY'])" }
if ($team["OPENROUTER_BASE_URL"]) { $lines += "OPENROUTER_BASE_URL=$($team['OPENROUTER_BASE_URL'])" }
$lines += "PORT=5001"
$lines += "INTERNAL_API_URL=http://127.0.0.1:5001"
$lines += "APP_URL=$APP_URL"
$lines += "NEXT_PUBLIC_APP_URL=$APP_URL"
$lines | Set-Content -Path $envFile -Encoding UTF8
Write-Ok "Wrote .env.local"

Fix-NpmForLocal
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Fail "npm install failed. Try: Remove-Item -Recurse -Force node_modules; npm install" }
Write-Ok "npm packages installed"
Write-Host ""

Write-Info "Step 5/5 - Database..."
Write-Ok "Using shared cloud database - schema is managed centrally (no local DB, no db:push)."
Write-Host ""

Write-Host "========================================"
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "  npm run build; npm run start    # recommended (fast, stable)"
Write-Host "  npm run dev                     # development (slow first load)"
Write-Host "  -> http://localhost:5001/signup  (admin secret in .env.local)"
Write-Host ""
Write-Host "  Database: shared cloud (Neon) - configured via DATABASE_URL in .env.local."
Write-Host ""
