#!/usr/bin/env bash
# One-command local dev setup (Linux / macOS). The app connects to the shared
# cloud (Neon) database via DATABASE_URL in .env.local — no local Postgres.
#
# Usage:
#   ./scripts/setup-local.sh                       # interactive (Enter = defaults)
#   ./scripts/setup-local.sh --yes                 # non-interactive (needs .env.local)
#   ./scripts/setup-local.sh --install-system-deps # auto-install missing Node / Python
#
# Before running (one-time):
#   1. git clone <repo> && cd CodingAutomationWebsite
<<<<<<< HEAD
#   2. cp scripts/team-secrets.env.example scripts/team-secrets.env
#      then fill in OPENROUTER_API_KEY, CRON_SECRET, DATABASE_URL, and the
#      AWS S3 credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#      AWS_REGION, AWS_BUCKET_NAME, AWS_OBJECT_KEY_PREFIX) — ask your team lead.
=======
#   2. cp .env.example .env.local
#      then fill in OPENROUTER_API_KEY, CRON_SECRET, the shared DATABASE_URL, and
#      the AWS S3 credentials (ask your team lead).
>>>>>>> main
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SECRETS_FILE="$ROOT/.env.local"
VENV_DIR="${HOME}/.codingautomation-venv"
DB_NAME="codingautomation"
DB_PORT="${DB_PORT:-5432}"
DATABASE_URL_DEFAULT="postgresql://postgres:postgres@localhost:${DB_PORT}/${DB_NAME}"
AUTO_YES=false
INSTALL_SYSTEM=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
    --install-system-deps) INSTALL_SYSTEM=true ;;
    --help|-h)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { echo -e "${BLUE}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

version_ge() {
  local want="$1" have="$2"
  [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -n1)" = "$want" ]
}

node_version() { node -v 2>/dev/null | sed 's/^v//' || echo "0"; }

python_bin_any() {
  for c in python3.13 python3.12 python3.11 python3; do
    if has_cmd "$c"; then echo "$c"; return; fi
  done
  echo ""
}

python_bin_suitable() {
  local c
  for c in python3.13 python3.12 python3.11 python3; do
    if ! has_cmd "$c"; then continue; fi
    if "$c" -c 'import sys; exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
      echo "$c"; return
    fi
  done
  echo ""
}

python_version() {
  "$1" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || echo "?"
}

is_ubuntu() {
  [ -f /etc/os-release ] && grep -qiE 'ubuntu|debian|pop!_os|linux mint' /etc/os-release
}
is_macos() { [ "$(uname -s)" = "Darwin" ]; }

confirm_or_auto() {
  local prompt="$1"
  if [ "$AUTO_YES" = true ] || [ "$INSTALL_SYSTEM" = true ]; then return 0; fi
  local answer=""
  read -r -p "$prompt (Y/n): " answer
  [[ "${answer:-Y}" =~ ^[Yy]$ ]]
}

# ---------------------------------------------------------------------------
# Docker
# ---------------------------------------------------------------------------
DOCKER="docker"

docker_daemon_ok() { $DOCKER info >/dev/null 2>&1; }

resolve_docker() {
  if ! has_cmd docker; then return 1; fi
  if docker_daemon_ok; then DOCKER="docker"; return 0; fi
  # Linux without docker group membership yet — try sudo.
  if sudo -n true 2>/dev/null || [ "$AUTO_YES" = true ] || [ "$INSTALL_SYSTEM" = true ]; then
    if sudo docker info >/dev/null 2>&1; then DOCKER="sudo docker"; return 0; fi
  fi
  return 1
}

has_compose() { $DOCKER compose version >/dev/null 2>&1; }

install_ubuntu_docker() {
  info "Installing Docker Engine + compose plugin (sudo required)..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io docker-compose-v2 2>/dev/null \
    || sudo apt-get install -y docker.io docker-compose-plugin
  sudo systemctl enable --now docker 2>/dev/null || true
  sudo usermod -aG docker "$USER" 2>/dev/null || true
  warn "Added $USER to the 'docker' group — a re-login is needed for password-less docker."
  warn "This run will use 'sudo docker' so setup can continue now."
}

ensure_docker() {
  if resolve_docker && has_compose; then
    ok "Docker ready ($($DOCKER --version | awk '{print $3}' | tr -d ,))"
    return
  fi
  if ! has_cmd docker; then
    if is_ubuntu && { [ "$INSTALL_SYSTEM" = true ] || confirm_or_auto "Docker not found. Install it now (apt)?"; }; then
      install_ubuntu_docker
      resolve_docker && has_compose && { ok "Docker ready"; return; }
    fi
    if is_macos; then
      fail "Docker Desktop is required. Install it: https://www.docker.com/products/docker-desktop/
Then open Docker Desktop (wait for it to say 'running') and re-run this script."
    fi
    fail "Docker is required but not installed.
Linux:  sudo apt-get install -y docker.io docker-compose-v2 && sudo systemctl enable --now docker
macOS:  install Docker Desktop, then re-run.
Then re-run: ./scripts/setup-local.sh --yes"
  fi
  # docker present but daemon not reachable
  fail "Docker is installed but the daemon is not running.
  • macOS: open Docker Desktop and wait until it reports 'running'.
  • Linux: sudo systemctl start docker   (and re-login if you were just added to the docker group)
Then re-run: ./scripts/setup-local.sh --yes"
}

# ---------------------------------------------------------------------------
# Node / Python auto-install
# ---------------------------------------------------------------------------
install_ubuntu_node() {
  info "Installing Node.js 20 (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

install_ubuntu_python() {
  info "Installing Python 3.11+..."
  sudo apt-get install -y python3 python3-pip python3-venv python3-dev 2>/dev/null || true
  if [ -z "$(python_bin_suitable)" ]; then
    sudo apt-get install -y software-properties-common
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt-get update -qq
    sudo apt-get install -y python3.11 python3.11-venv python3.11-dev
  fi
}

install_macos_brew_pkg() {
  local formula="$1" label="$2"
  if ! has_cmd brew; then
    warn "Homebrew not found — install $label manually, then re-run. https://brew.sh"
    return 1
  fi
  info "Installing $label via Homebrew..."
  brew install "$formula"
}

install_system_deps() {
  if is_ubuntu; then
    info "Updating apt & installing missing tools (sudo required)..."
    sudo apt-get update -qq
    sudo apt-get install -y curl ca-certificates build-essential git
    if ! has_cmd node || ! version_ge "20.0.0" "$(node_version)"; then install_ubuntu_node; fi
    if [ -z "$(python_bin_suitable)" ]; then install_ubuntu_python; fi
  elif is_macos; then
    has_cmd git  || install_macos_brew_pkg git git || true
    if ! has_cmd node || ! version_ge "20.0.0" "$(node_version)"; then
      install_macos_brew_pkg node "Node.js" || true
    fi
    if [ -z "$(python_bin_suitable)" ]; then
      install_macos_brew_pkg python@3.11 "Python 3.11" || true
    fi
  else
    warn "Unknown OS — install Node 20+, Python 3.11+, Git, Docker manually."
  fi
}

collect_prereq_issues() {
  PREREQ_ISSUES=()
  has_cmd git || PREREQ_ISSUES+=("git: not installed")
  if ! has_cmd node; then
    PREREQ_ISSUES+=("nodejs: not installed (need v20+)")
  elif ! version_ge "20.0.0" "$(node_version)"; then
    PREREQ_ISSUES+=("nodejs: v$(node_version) installed (need v20+)")
  fi
  has_cmd npm || PREREQ_ISSUES+=("npm: not installed")
  if [ -z "$(python_bin_suitable)" ]; then
    local any; any="$(python_bin_any)"
    if [ -n "$any" ]; then PREREQ_ISSUES+=("python3: v$(python_version "$any") (need v3.11+)")
    else PREREQ_ISSUES+=("python3: not installed (need v3.11+)"); fi
  fi
}

check_prerequisites() {
  collect_prereq_issues
  if [ "${#PREREQ_ISSUES[@]}" -gt 0 ]; then
    echo ""
    warn "Prerequisite issues found:"
    for i in "${PREREQ_ISSUES[@]}"; do echo "  • $i"; done
    echo ""
    if [ "$INSTALL_SYSTEM" = true ] || confirm_or_auto "Install missing tools automatically?"; then
      install_system_deps
      collect_prereq_issues
      if [ "${#PREREQ_ISSUES[@]}" -gt 0 ]; then
        warn "Still unresolved (a new shell may be needed for PATH updates):"
        for i in "${PREREQ_ISSUES[@]}"; do echo "  • $i"; done
        fail "Could not install all prerequisites automatically."
      fi
    else
      fail "Prerequisites not met. Install Node 20+, Python 3.11+, Git, then re-run."
    fi
  fi

  PYTHON_CMD="$(python_bin_suitable)"
  ok "git $(git --version | awk '{print $3}')"
  ok "node v$(node_version)"
  ok "npm v$(npm -v)"
  ok "python $(python_version "$PYTHON_CMD") ($PYTHON_CMD)"
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------
load_team_secrets() {
  [ -f "$SECRETS_FILE" ] || fail "Missing .env.local — create it, then fill in the required values:
  cp .env.example .env.local"
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
  # DATABASE_URL comes from .env.local (the shared cloud DB). Required.
  ok "Loaded .env.local"
}

# ---------------------------------------------------------------------------
# npm registry (strip Replit-only URLs)
# ---------------------------------------------------------------------------
fix_npm_for_local() {
  if [ -f package-lock.json ] && grep -q 'package-firewall.replit.local' package-lock.json 2>/dev/null; then
    info "Fixing Replit-only npm URLs in package-lock.json..."
    if is_macos; then
      sed -i '' 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
    else
      sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
    fi
    ok "Patched package-lock.json for local npm registry"
  fi
  echo "registry=https://registry.npmjs.org/" > .npmrc.local
  export NPM_CONFIG_USERCONFIG="$ROOT/.npmrc.local"
}

# ---------------------------------------------------------------------------
# Postgres via Docker
# ---------------------------------------------------------------------------
start_database() {
  info "Starting Postgres in Docker (service 'db', port $DB_PORT)..."
  DB_PORT="$DB_PORT" $DOCKER compose up -d db

  info "Waiting for Postgres to become healthy..."
  local tries=0
  until $DOCKER compose exec -T db pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      fail "Postgres did not become ready in time. Check: $DOCKER compose logs db"
    fi
    sleep 1
  done
  ok "Postgres is ready on localhost:$DB_PORT (db=$DB_NAME, user=postgres)"
}

schema_exists() {
  $DOCKER compose exec -T db psql -U postgres -d "$DB_NAME" -tAc \
    "select 1 from information_schema.tables where table_schema='public' and table_name='users' limit 1" \
    2>/dev/null | grep -q 1
}

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
echo ""
echo "========================================"
echo "  Coding Automation — Local Setup (Shared Cloud DB)"
echo "========================================"
echo ""

info "Step 1/5 — Checking prerequisites..."
check_prerequisites
echo ""

info "Step 2/5 — Loading secrets & configuring..."
load_team_secrets
[ -n "${OPENROUTER_API_KEY:-}" ] || fail "OPENROUTER_API_KEY missing in .env.local"
[ -n "${CRON_SECRET:-}" ]         || fail "CRON_SECRET missing in .env.local"
[ -n "${DATABASE_URL:-}" ]        || fail "DATABASE_URL missing in .env.local — set the shared cloud (Neon) connection string (see .env.example)."
# ADMIN_SECRET_KEY is optional — only needed to self-register a NEW admin at signup.
[ -n "${ADMIN_SECRET_KEY:-}" ]    || warn "ADMIN_SECRET_KEY not set — optional; existing accounts (including admins) work without it."
<<<<<<< HEAD
aws_s3_complete() {
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && \
  [ -n "${AWS_REGION:-}" ] && [ -n "${AWS_BUCKET_NAME:-}" ] && \
  [ -n "${AWS_OBJECT_KEY_PREFIX:-}" ]
}
if aws_s3_complete; then
  ok "AWS S3 storage configured (bucket: $AWS_BUCKET_NAME, prefix: $AWS_OBJECT_KEY_PREFIX)"
elif [ -n "${AWS_ACCESS_KEY_ID:-}${AWS_SECRET_ACCESS_KEY:-}${AWS_REGION:-}${AWS_BUCKET_NAME:-}${AWS_OBJECT_KEY_PREFIX:-}" ]; then
=======
# AWS S3 file storage is optional — falls back to .local-object-storage/ on disk.
aws_s3_complete() {
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && \
  [ -n "${AWS_REGION:-}" ] && [ -n "${AWS_BUCKET_NAME:-}" ]
}
if aws_s3_complete; then
  ok "AWS S3 storage configured (bucket: $AWS_BUCKET_NAME, prefix: ${AWS_OBJECT_KEY_PREFIX:-<none>})"
elif [ -n "${AWS_ACCESS_KEY_ID:-}${AWS_SECRET_ACCESS_KEY:-}${AWS_REGION:-}${AWS_BUCKET_NAME:-}" ]; then
>>>>>>> main
  warn "AWS S3 creds incomplete — file storage will fall back to .local-object-storage/"
else
  warn "AWS S3 not configured — file storage will use .local-object-storage/ on disk"
fi
DEFAULT_APP_URL="${APP_URL:-http://localhost:5001}"
if [ "$AUTO_YES" = false ]; then
  read -r -p "APP_URL [$DEFAULT_APP_URL]: " APP_URL_INPUT
  APP_URL="${APP_URL_INPUT:-$DEFAULT_APP_URL}"
else
  APP_URL="$DEFAULT_APP_URL"
fi
ok "DATABASE_URL set from .env.local (shared cloud database)"
ok "Secrets loaded (OPENROUTER_API_KEY, CRON_SECRET, ADMIN_SECRET_KEY)"
echo ""

info "Step 3/5 — Python virtual environment..."
info "Location: $VENV_DIR (outside repo — avoids Turbopack build issues)"
if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_CMD" -m venv "$VENV_DIR"; ok "Created venv"
else
  warn "Reusing existing venv"
fi
VENV_PYTHON="$VENV_DIR/bin/python3"
[ -x "$VENV_PYTHON" ] || fail "venv python not found at $VENV_PYTHON"
"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install -r pipeline/requirements.txt --quiet
ok "Python packages installed"
echo ""

info "Step 4/5 — Updating .env.local & installing npm packages..."
ENV_FILE="$ROOT/.env.local"
<<<<<<< HEAD
if [ -f "$ENV_FILE" ]; then
  if [ "$AUTO_YES" = false ]; then
    read -r -p ".env.local exists. Overwrite? (y/N): " OVERWRITE
    [[ "$OVERWRITE" =~ ^[Yy]$ ]] || fail "Aborted."
  fi
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
fi
{
  echo "# Generated by scripts/setup-local.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "PIPELINE_ROOT=$ROOT/pipeline"
  echo "PYTHON_PATH=$VENV_PYTHON"
  echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY"
  [ -n "${ADMIN_SECRET_KEY:-}" ] && echo "ADMIN_SECRET_KEY=$ADMIN_SECRET_KEY"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "CRON_SECRET=$CRON_SECRET"
  [ -n "${RESEND_API_KEY:-}" ] && echo "RESEND_API_KEY=$RESEND_API_KEY"
  [ -n "${OPENROUTER_BASE_URL:-}" ] && echo "OPENROUTER_BASE_URL=$OPENROUTER_BASE_URL"
  [ -n "${AWS_ACCESS_KEY_ID:-}" ] && echo "AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID"
  [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] && echo "AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY"
  [ -n "${AWS_REGION:-}" ] && echo "AWS_REGION=$AWS_REGION"
  [ -n "${AWS_BUCKET_NAME:-}" ] && echo "AWS_BUCKET_NAME=$AWS_BUCKET_NAME"
  [ -n "${AWS_OBJECT_KEY_PREFIX:-}" ] && echo "AWS_OBJECT_KEY_PREFIX=$AWS_OBJECT_KEY_PREFIX"
  echo "PORT=5001"
  echo "INTERNAL_API_URL=http://127.0.0.1:5001"
  echo "APP_URL=$APP_URL"
  echo "NEXT_PUBLIC_APP_URL=$APP_URL"
} > "$ENV_FILE"
ok "Wrote .env.local"
=======
cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"

# Upsert KEY=value into .env.local without disturbing the user's other lines
# (AWS creds, optional tuning vars, comments) — portable across macOS/Linux.
upsert_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  grep -vE "^[[:space:]]*${key}=" "$ENV_FILE" > "$tmp" 2>/dev/null || true
  echo "${key}=${val}" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
}
ensure_env() {  # add KEY=value only if not already present (uncommented)
  grep -qE "^[[:space:]]*$1=" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"
}

# Machine-specific paths computed during setup — always override.
upsert_env PIPELINE_ROOT "$ROOT/pipeline"
upsert_env PYTHON_PATH "$VENV_PYTHON"
# Sane local defaults — only if the user left them unset.
ensure_env PORT "5001"
ensure_env INTERNAL_API_URL "http://127.0.0.1:5001"
ensure_env APP_URL "$APP_URL"
ensure_env NEXT_PUBLIC_APP_URL "$APP_URL"
ok "Updated .env.local (PIPELINE_ROOT, PYTHON_PATH; preserved your other values)"
>>>>>>> main

fix_npm_for_local
if ! npm install --no-audit --no-fund; then
  fail "npm install failed. Try: rm -rf node_modules && npm install"
fi
ok "npm packages installed"
echo ""

info "Step 5/5 — Database..."
ok "Using shared cloud database — schema is managed centrally (no local DB, no db:push)."
echo ""

echo "========================================"
echo -e "${GREEN}Setup complete!${NC}"
echo "========================================"
echo ""
echo "  npm run build && npm run start    # recommended (fast, stable)"
echo "  npm run dev                       # development (slow first load)"
echo "  → http://localhost:5001/signup    (admin secret in .env.local)"
echo ""
echo "  Database: shared cloud (Neon) — configured via DATABASE_URL in .env.local."
echo ""
