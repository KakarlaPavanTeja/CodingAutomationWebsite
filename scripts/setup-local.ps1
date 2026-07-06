# One-command local dev setup for Windows (PowerShell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -Yes
#   powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -InstallSystemDeps -Yes
param(
    [switch]$Yes,
    [switch]$InstallSystemDeps
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$SecretsFile = Join-Path $Root "scripts\team-secrets.env"
$VenvDir = Join-Path $env:USERPROFILE ".codingautomation-venv"

function Write-Info($msg)  { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Has-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    if (-not (Has-Command "node")) { return "0" }
    return (node -v).TrimStart("v")
}

function Get-PythonAny {
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
            return @{ Exe = $c.Exe; Args = $c.Args; Version = $verOut.Trim() }
        } catch { }
    }
    return $null
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
        Write-Warn "winget not found — install $label manually: https://nodejs.org/ or https://www.python.org/"
        return $false
    }
    Write-Info "Installing $label via winget..."
    winget install --id $id -e --accept-source-agreements --accept-package-agreements --silent 2>$null
    if ($LASTEXITCODE -ne 0) {
        winget install --id $id -e --accept-source-agreements --accept-package-agreements
    }
    return $true
}

function Install-WindowsSystemDeps {
    $nodeVer = Get-NodeVersion
    $pySuitable = Get-PythonSuitable

    if (-not (Has-Command "git")) {
        Install-WingetPackage "Git.Git" "Git" | Out-Null
    }

    if (-not (Has-Command "node") -or [version]$nodeVer -lt [version]"20.0.0") {
        if (Has-Command "node") { Write-Warn "Node.js v$nodeVer found — installing LTS (20+)..." }
        Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    if (-not $pySuitable) {
        $pyAny = Get-PythonAny
        if ($pyAny) { Write-Warn "Python $($pyAny.Version) found — need 3.11+..." }
        Install-WingetPackage "Python.Python.3.11" "Python 3.11" | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                    [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    if (-not (Has-Command "psql")) {
        Write-Info "PostgreSQL not found — install manually if you need a local DB:"
        Write-Info "  https://www.postgresql.org/download/windows/"
    }

    Write-Ok "System dependency install attempted — restart PowerShell if git/node/python still not found"
}

function Collect-PrerequisiteIssues {
    $script:PrereqIssues = @()
    $nodeVer = Get-NodeVersion

    if (-not (Has-Command "git")) { $script:PrereqIssues += "git: not installed" }
    if (-not (Has-Command "node")) { $script:PrereqIssues += "nodejs: not installed (need v20+)" }
    elseif ([version]$nodeVer -lt [version]"20.0.0") { $script:PrereqIssues += "nodejs: v$nodeVer installed (need v20+)" }
    if (-not (Has-Command "npm")) { $script:PrereqIssues += "npm: not installed" }
    if (-not (Get-PythonSuitable)) {
        $pyAny = Get-PythonAny
        if ($pyAny) { $script:PrereqIssues += "python3: v$($pyAny.Version) installed (need v3.11+)" }
        else { $script:PrereqIssues += "python3: not installed (need v3.11+)" }
    }
}

function Fix-PrerequisitesIfNeeded {
    Collect-PrerequisiteIssues
    if ($script:PrereqIssues.Count -eq 0) { return }

    Write-Host ""
    Write-Warn "Prerequisite issues found:"
    foreach ($issue in $script:PrereqIssues) { Write-Host "  • $issue" }
    Write-Host ""

    if ($Yes -or $InstallSystemDeps) {
        Install-WindowsSystemDeps
        Collect-PrerequisiteIssues
        if ($script:PrereqIssues.Count -gt 0) {
            Write-Warn "Still unresolved — restart PowerShell, then re-run setup."
            foreach ($issue in $script:PrereqIssues) { Write-Host "  • $issue" }
            Write-Fail "Prerequisites not met."
        }
        return
    }

    $answer = Read-Host "Fix missing/outdated tools automatically (winget)? (Y/n)"
    if ($answer -eq "" -or $answer -match "^[Yy]") {
        Install-WindowsSystemDeps
        Collect-PrerequisiteIssues
        if ($script:PrereqIssues.Count -gt 0) { Write-Fail "Prerequisites not met — restart PowerShell and re-run." }
        return
    }

    Write-Fail "Prerequisites not met. Re-run with: -InstallSystemDeps -Yes"
}

function Import-TeamSecrets {
    if (-not (Test-Path $SecretsFile)) {
        Write-Fail "Missing scripts/team-secrets.env — ask team lead, or: Copy-Item scripts/team-secrets.env.example scripts/team-secrets.env"
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

Write-Host ""
Write-Host "========================================"
Write-Host "  Coding Automation — Local Setup"
Write-Host "========================================"
Write-Host ""

Write-Info "Step 1/5 — Checking prerequisites..."
Fix-PrerequisitesIfNeeded

$py = Get-PythonSuitable
if (-not $py) { Write-Fail "Python 3.11+ not available." }
$pyExe = $py.Exe; $pyArgs = $py.Args; $pyVer = $py.Version
$nodeVer = Get-NodeVersion

Write-Ok "git $(git --version)"
Write-Ok "node v$nodeVer"
Write-Ok "npm v$(npm -v)"
Write-Ok "python $pyVer"
Write-Host ""

Write-Info "Step 2/5 — Loading secrets & configuring..."
$team = Import-TeamSecrets

foreach ($key in @("OPENROUTER_API_KEY", "CRON_SECRET", "ADMIN_SECRET_KEY")) {
    if (-not $team[$key]) { Write-Fail "$key missing in team-secrets.env" }
}

$defaultDb = "postgresql://postgres@localhost:5432/codingautomation"
$defaultAppUrl = if ($team["APP_URL"]) { $team["APP_URL"] } else { "http://localhost:5001" }

if ($Yes) {
    $DATABASE_URL = $defaultDb
    $APP_URL = $defaultAppUrl
} else {
    $inputDb = Read-Host "DATABASE_URL [$defaultDb]"
    $DATABASE_URL = if ([string]::IsNullOrWhiteSpace($inputDb)) { $defaultDb } else { $inputDb }
    $inputApp = Read-Host "APP_URL [$defaultAppUrl]"
    $APP_URL = if ([string]::IsNullOrWhiteSpace($inputApp)) { $defaultAppUrl } else { $inputApp }
}

$OPENROUTER_API_KEY = $team["OPENROUTER_API_KEY"]
$CRON_SECRET = $team["CRON_SECRET"]
$ADMIN_SECRET_KEY = $team["ADMIN_SECRET_KEY"]
$RESEND_API_KEY = $team["RESEND_API_KEY"]
$OPENROUTER_BASE_URL = $team["OPENROUTER_BASE_URL"]
Write-Ok "Secrets loaded"
Write-Host ""

Write-Info "Step 3/5 — Python virtual environment..."
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

Write-Info "Step 4/5 — Writing .env.local..."
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
    "OPENROUTER_API_KEY=$OPENROUTER_API_KEY"
    "ADMIN_SECRET_KEY=$ADMIN_SECRET_KEY"
    "DATABASE_URL=$DATABASE_URL"
    "CRON_SECRET=$CRON_SECRET"
)
if ($RESEND_API_KEY) { $lines += "RESEND_API_KEY=$RESEND_API_KEY" }
if ($OPENROUTER_BASE_URL) { $lines += "OPENROUTER_BASE_URL=$OPENROUTER_BASE_URL" }
$lines += "PORT=5001"
$lines += "INTERNAL_API_URL=http://127.0.0.1:5001"
$lines += "APP_URL=$APP_URL"
$lines += "NEXT_PUBLIC_APP_URL=$APP_URL"
$lines | Set-Content -Path $envFile -Encoding UTF8
Write-Ok "Wrote .env.local"
Write-Host ""

Write-Info "Step 5/6 — npm install & database sync..."
Fix-NpmForLocal
npm install --no-audit --no-fund
Write-Ok "npm packages installed"
npm run db:push
Write-Ok "Database schema synced"
Write-Host ""

$usersExport = Join-Path $Root "scripts\team-users-export"
$usersJson = Join-Path $usersExport "json\users.json"
if (Test-Path $usersJson) {
    Write-Info "Step 6/6 — Importing Replit users (logins only)..."
    npx tsx scripts/import-team-users.mts --from $usersExport
    Write-Ok "Team users imported — use your Replit email + password"
} else {
    Write-Info "Step 6/6 — Team users import"
    Write-Warn "Missing scripts/team-users-export/json/users.json — ask team lead"
}

Write-Host ""
Write-Host "========================================"
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "  npm run dev"
Write-Host "  → http://localhost:5001"
Write-Host ""
if (Test-Path $usersJson) {
    Write-Host "  Log in with your Replit email + password"
} else {
    Write-Host "  Sign up: /signup  (admin secret in .env.local)"
}
Write-Host ""
