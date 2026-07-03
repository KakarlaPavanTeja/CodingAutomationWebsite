# One-shot local dev setup for Windows (PowerShell).
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
#
# Pre-fill shared secrets: copy scripts/team-secrets.env.example → scripts/team-secrets.env
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$SecretsFile = Join-Path $Root "scripts\team-secrets.env"
$VenvDir = Join-Path $env:USERPROFILE ".codingautomation-venv"

function Write-Info($msg)  { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

function Test-Command($name) {
    if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
        Write-Fail "Missing required command: $name"
    }
}

function Import-TeamSecrets {
    if (-not (Test-Path $SecretsFile)) {
        Write-Warn "No scripts/team-secrets.env found — you'll enter all values manually"
        Write-Warn "Tip: cp scripts/team-secrets.env.example scripts/team-secrets.env"
        return @{}
    }
    $map = @{}
    Get-Content $SecretsFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $eq = $line.IndexOf("=")
        if ($eq -lt 1) { return }
        $key = $line.Substring(0, $eq).Trim()
        $val = $line.Substring($eq + 1).Trim()
        $map[$key] = $val
    }
    Write-Ok "Loaded shared secrets from scripts/team-secrets.env"
    return $map
}

function Get-PythonCommand {
    $candidates = @(
        @{ Exe = "py"; Args = @("-3.11") },
        @{ Exe = "py"; Args = @("-3") },
        @{ Exe = "python"; Args = @() },
        @{ Exe = "python3"; Args = @() }
    )
    foreach ($c in $candidates) {
        if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
        try {
            $verOut = & $c.Exe @($c.Args) -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')" 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $majorMinor = ($verOut.Trim() -split "\.")[0..1] -join "."
            if ([version]$majorMinor -ge [version]"3.11") {
                return @{ Exe = $c.Exe; Args = $c.Args; Version = $verOut.Trim() }
            }
        } catch { }
    }
    Write-Fail "Python 3.11+ required. Install from https://www.python.org/downloads/ (check 'Add to PATH')."
}

function Read-WithDefault($label, $default) {
    $input = Read-Host "$label [$default]"
    if ([string]::IsNullOrWhiteSpace($input)) { return $default }
    return $input
}

function Read-SecretRequired($label) {
    do {
        $secure = Read-Host $label -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    } while ([string]::IsNullOrWhiteSpace($plain))
    return $plain
}

Write-Host ""
Write-Host "========================================"
Write-Host "  Coding Automation — Local Setup"
Write-Host "========================================"
Write-Host ""

Write-Info "Checking prerequisites..."

Test-Command "git"
Test-Command "node"
Test-Command "npm"

$nodeVer = (node -v).TrimStart("v")
if ([version]$nodeVer -lt [version]"20.0.0") {
    Write-Fail "Node.js 20+ required (found v$nodeVer). Install: https://nodejs.org/"
}

$py = Get-PythonCommand
$pyExe = $py.Exe
$pyArgs = $py.Args
$pyVer = $py.Version

Write-Ok "git $(git --version)"
Write-Ok "node v$nodeVer"
Write-Ok "npm v$(npm -v)"
Write-Ok "python $pyVer"
Write-Host ""

$team = Import-TeamSecrets
Write-Host ""

$defaultDb = if ($team["DATABASE_URL"]) { $team["DATABASE_URL"] } else { "postgresql://postgres@localhost:5432/codingautomation" }
$defaultAppUrl = if ($team["APP_URL"]) { $team["APP_URL"] } else { "http://localhost:5001" }

Write-Info "Configure environment (press Enter to accept defaults in brackets)."
Write-Host ""

$DATABASE_URL = Read-WithDefault "DATABASE_URL" $defaultDb

if ($team["OPENROUTER_API_KEY"]) {
    $OPENROUTER_API_KEY = $team["OPENROUTER_API_KEY"]
    Write-Ok "Using OPENROUTER_API_KEY from team-secrets.env"
} else {
    $OPENROUTER_API_KEY = Read-SecretRequired "OPENROUTER_API_KEY"
}

if ($team["CRON_SECRET"]) {
    $CRON_SECRET = $team["CRON_SECRET"]
    Write-Ok "Using CRON_SECRET from team-secrets.env"
} else {
    $CRON_SECRET = Read-Host "CRON_SECRET (leave blank to auto-generate)"
    if ([string]::IsNullOrWhiteSpace($CRON_SECRET)) {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $CRON_SECRET = [BitConverter]::ToString($bytes).Replace("-", "").ToLower()
        Write-Ok "Generated CRON_SECRET"
    }
}

if ($team["ADMIN_SECRET_KEY"]) {
    $ADMIN_SECRET_KEY = $team["ADMIN_SECRET_KEY"]
    Write-Ok "Using ADMIN_SECRET_KEY from team-secrets.env"
} else {
    $ADMIN_SECRET_KEY = Read-SecretRequired "ADMIN_SECRET_KEY"
}

$RESEND_API_KEY = $team["RESEND_API_KEY"]
$OPENROUTER_BASE_URL = $team["OPENROUTER_BASE_URL"]
$APP_URL = Read-WithDefault "APP_URL" $defaultAppUrl

Write-Host ""

Write-Info "Creating Python virtual environment at $VenvDir ..."
Write-Info "(outside the repo — avoids Turbopack symlink issues during build)"
$venvPython = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
    if ($pyArgs.Count -gt 0) {
        & $pyExe @pyArgs -m venv $VenvDir
    } else {
        & $pyExe -m venv $VenvDir
    }
    Write-Ok "Created $VenvDir"
} else {
    Write-Warn "Reusing existing $VenvDir"
}

Write-Info "Installing Python dependencies..."
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -r pipeline/requirements.txt --quiet
Write-Ok "Python packages installed"
Write-Host ""

$envFile = Join-Path $Root ".env.local"
if (Test-Path $envFile) {
    $overwrite = Read-Host ".env.local already exists. Overwrite? (y/N)"
    if ($overwrite -notmatch "^[Yy]$") {
        Write-Fail "Aborted — .env.local was not changed."
    }
    $backup = "$envFile.bak.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $envFile $backup
    Write-Ok "Backed up existing .env.local"
}

Write-Info "Writing .env.local..."
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
$lines += ""
$lines += "# Local file storage (no Replit bucket needed)"

$lines | Set-Content -Path $envFile -Encoding UTF8
Write-Ok "Wrote .env.local"
Write-Host ""

Write-Info "Installing npm dependencies (this may take a minute)..."
npm install --no-audit --no-fund
Write-Ok "npm packages installed"
Write-Host ""

Write-Info "Syncing database schema (npm run db:push)..."
npm run db:push
Write-Ok "Database schema synced"
Write-Host ""

Write-Host "========================================"
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host "========================================"
Write-Host ""
Write-Host "Start the dev server:"
Write-Host "  npm run dev"
Write-Host ""
Write-Host "Then open:"
Write-Host "  http://localhost:5001"
Write-Host ""
Write-Host "Sign up at /signup — admin secret: (see ADMIN_SECRET_KEY in .env.local)"
Write-Host ""
