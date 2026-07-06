#!/usr/bin/env bash
# One-command local dev setup (Ubuntu / Linux / macOS).
#
# Usage:
#   ./scripts/setup-local.sh                      # interactive (Enter = defaults)
#   ./scripts/setup-local.sh --yes                # non-interactive (needs team-secrets.env)
#   ./scripts/setup-local.sh --install-system-deps # auto-fix missing OR wrong-version system tools
#
# Before running (one-time):
#   1. git clone <repo> && cd CodingAutomationWebsite
#   2. Place scripts/team-secrets.env (ask team lead)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SECRETS_FILE="$ROOT/scripts/team-secrets.env"
VENV_DIR="${HOME}/.codingautomation-venv"
AUTO_YES=false
INSTALL_SYSTEM=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
    --install-system-deps) INSTALL_SYSTEM=true ;;
    --help|-h)
      sed -n '2,12p' "$0"
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

version_ge() {
  local want="$1" have="$2"
  [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -n1)" = "$want" ]
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

node_version() {
  node -v 2>/dev/null | sed 's/^v//' || echo "0"
}

# Any python3 on PATH (even if too old)
python_bin_any() {
  for c in python3.13 python3.12 python3.11 python3; do
    if has_cmd "$c"; then echo "$c"; return; fi
  done
  echo ""
}

# python3 binary that meets 3.11+ requirement
python_bin_suitable() {
  local c ver major minor
  for c in python3.13 python3.12 python3.11 python3; do
    if ! has_cmd "$c"; then continue; fi
    if "$c" -c 'import sys; exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
      echo "$c"; return
    fi
  done
  echo ""
}

python_version() {
  local bin="$1"
  "$bin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' 2>/dev/null || echo "?"
}

is_ubuntu() {
  [ -f /etc/os-release ] && grep -qiE 'ubuntu|debian|pop!_os|linux mint' /etc/os-release
}

confirm_or_auto() {
  local prompt="$1"
  if [ "$AUTO_YES" = true ] || [ "$INSTALL_SYSTEM" = true ]; then
    return 0
  fi
  local answer=""
  read -r -p "$prompt (Y/n): " answer
  [[ "${answer:-Y}" =~ ^[Yy]$ ]]
}

install_ubuntu_node() {
  local current="$1"
  if [ "$current" = "0" ]; then
    info "Installing Node.js 20..."
  else
    warn "Node.js v$current found — upgrading to v20..."
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
}

install_ubuntu_python() {
  info "Installing Python 3.11+..."
  sudo apt-get install -y python3 python3-pip python3-venv python3-dev 2>/dev/null || true
  if [ -z "$(python_bin_suitable)" ]; then
    info "Default python3 too old — installing python3.11 via deadsnakes..."
    sudo apt-get install -y software-properties-common
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt-get update -qq
    sudo apt-get install -y python3.11 python3.11-venv python3.11-dev
  fi
}

bootstrap_local_postgres() {
  # Unix-socket peer auth works when the OS user has a matching Postgres role.
  # TCP (postgresql://user@localhost:5432/...) often requires a password and breaks login.
  if ! has_cmd psql; then
    return 0
  fi
  info "Configuring local Postgres role + database for $USER ..."
  if is_ubuntu; then
    sudo -u postgres createuser -s "$USER" 2>/dev/null || true
    sudo -u postgres createdb -O "$USER" codingautomation 2>/dev/null || \
      createdb codingautomation 2>/dev/null || true
  else
    createuser -s "$USER" 2>/dev/null || \
      psql postgres -c "CREATE USER \"$USER\" SUPERUSER;" 2>/dev/null || true
    createdb -O "$USER" codingautomation 2>/dev/null || \
      psql postgres -c "CREATE DATABASE codingautomation OWNER \"$USER\";" 2>/dev/null || true
  fi
}

is_socket_db_url() {
  local db_url="$1"
  [[ "$db_url" == postgresql:///* ]] || [[ "$db_url" == *"?host=/var/run/postgresql"* ]] || [[ "$db_url" == *"?host=/tmp"* ]]
}

local_socket_db_url() {
  local socket_dir="/var/run/postgresql"
  if [ ! -d "$socket_dir" ] && [ -d /tmp ]; then
    socket_dir="/tmp"
  fi
  echo "postgresql://${USER}@localhost/codingautomation?host=${socket_dir}"
}

install_ubuntu_postgres() {
  if ! has_cmd psql; then
    info "Installing PostgreSQL..."
    sudo apt-get install -y postgresql postgresql-contrib
  else
    info "Ensuring PostgreSQL is running..."
  fi
  sudo systemctl enable postgresql 2>/dev/null || true
  sudo systemctl start postgresql 2>/dev/null || true
  bootstrap_local_postgres
}

install_ubuntu_system_deps() {
  local fix_git=false fix_node=false fix_python=false fix_pg=false
  local node_ver py_any py_suitable

  node_ver="$(node_version)"
  py_any="$(python_bin_any)"
  py_suitable="$(python_bin_suitable)"

  has_cmd git || fix_git=true
  if ! has_cmd node || ! version_ge "20.0.0" "$node_ver"; then fix_node=true; fi
  if [ -z "$py_suitable" ]; then fix_python=true; fi
  if ! has_cmd psql; then fix_pg=true; fi

  info "Updating system packages (sudo required)..."
  sudo apt-get update -qq

  if [ "$fix_git" = true ] || [ "$fix_node" = true ] || [ "$fix_python" = true ] || [ "$fix_pg" = true ]; then
    sudo apt-get install -y curl ca-certificates build-essential
  fi

  if [ "$fix_git" = true ]; then
    info "Installing git..."
    sudo apt-get install -y git
  fi

  if [ "$fix_node" = true ]; then
    install_ubuntu_node "$node_ver"
  fi

  if [ "$fix_python" = true ]; then
    if [ -n "$py_any" ]; then
      warn "Python $(python_version "$py_any") found — need 3.11+"
    fi
    install_ubuntu_python
  fi

  if [ "$fix_pg" = true ]; then
    install_ubuntu_postgres
  else
    install_ubuntu_postgres  # still ensure service is running
  fi

  ok "System dependencies ready"
}

collect_prerequisite_issues() {
  PREREQ_ISSUES=()
  local node_ver py_any py_suitable

  if ! has_cmd git; then
    PREREQ_ISSUES+=("git: not installed")
  fi

  if ! has_cmd node; then
    PREREQ_ISSUES+=("nodejs: not installed (need v20+)")
  else
    node_ver="$(node_version)"
    if ! version_ge "20.0.0" "$node_ver"; then
      PREREQ_ISSUES+=("nodejs: v$node_ver installed (need v20+)")
    fi
  fi

  if ! has_cmd npm; then
    PREREQ_ISSUES+=("npm: not installed")
  fi

  py_suitable="$(python_bin_suitable)"
  py_any="$(python_bin_any)"
  if [ -z "$py_suitable" ]; then
    if [ -n "$py_any" ]; then
      PREREQ_ISSUES+=("python3: v$(python_version "$py_any") installed (need v3.11+)")
    else
      PREREQ_ISSUES+=("python3: not installed (need v3.11+)")
    fi
  fi
}

fix_prerequisites_if_needed() {
  collect_prerequisite_issues

  if [ "${#PREREQ_ISSUES[@]}" -eq 0 ]; then
    return 0
  fi

  echo ""
  warn "Prerequisite issues found:"
  for issue in "${PREREQ_ISSUES[@]}"; do
    echo "  • $issue"
  done
  echo ""

  if is_ubuntu; then
    if confirm_or_auto "Fix missing/outdated tools automatically (apt)?"; then
      install_ubuntu_system_deps
      collect_prerequisite_issues
      if [ "${#PREREQ_ISSUES[@]}" -gt 0 ]; then
        warn "Still unresolved after apt fix:"
        for issue in "${PREREQ_ISSUES[@]}"; do echo "  • $issue"; done
        fail "Could not fix all prerequisites automatically."
      fi
      return 0
    fi
    echo ""
    echo "  Run with auto-fix:"
    echo "    ./scripts/setup-local.sh --install-system-deps"
    echo ""
    fail "Prerequisites not met — fix manually or re-run with --install-system-deps"
  fi

  fail "Prerequisites not met. Install Node 20+, Python 3.11+, Git, then re-run."
}

verify_prerequisites() {
  PYTHON_CMD="$(python_bin_suitable)"
  [ -n "$PYTHON_CMD" ] || fail "Python 3.11+ not available after setup."

  NODE_VER="$(node_version)"
  PY_VER="$(python_version "$PYTHON_CMD")"

  if ! version_ge "20.0.0" "$NODE_VER"; then
    fail "Node.js 20+ required (found v$NODE_VER)."
  fi

  ok "git $(git --version | awk '{print $3}')"
  ok "node v$NODE_VER"
  ok "npm v$(npm -v)"
  ok "python $PY_VER ($PYTHON_CMD)"
}

check_prerequisites() {
  fix_prerequisites_if_needed
  verify_prerequisites
}

fix_npm_for_local() {
  if [ -f package-lock.json ] && grep -q 'package-firewall.replit.local' package-lock.json 2>/dev/null; then
    info "Fixing Replit-only npm URLs in package-lock.json..."
    if [[ "$(uname -s)" == "Darwin" ]]; then
      sed -i '' 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
    else
      sed -i 's|http://package-firewall.replit.local/npm/|https://registry.npmjs.org/|g' package-lock.json
    fi
    ok "Patched package-lock.json for local npm registry"
  fi
  echo "registry=https://registry.npmjs.org/" > .npmrc.local
  export NPM_CONFIG_USERCONFIG="$ROOT/.npmrc.local"
}

ensure_postgres() {
  local db_url="$1"
  if ! has_cmd psql; then
    warn "psql not found — skipping DB connectivity check"
    return
  fi
  if psql "$db_url" -c 'SELECT 1' >/dev/null 2>&1; then
    ok "PostgreSQL connection OK"
    return
  fi
  warn "Cannot connect to: $db_url"
  if is_socket_db_url "$db_url"; then
    bootstrap_local_postgres
    if psql "$db_url" -c 'SELECT 1' >/dev/null 2>&1; then
      ok "PostgreSQL connection OK (after bootstrap)"
      return
    fi
  fi
  local dbname
  dbname="$(echo "$db_url" | sed -n 's|.*/\([^?]*\)$|\1|p')"
  if [ -n "$dbname" ] && has_cmd createdb; then
    info "Attempting to create database '$dbname'..."
    if createdb "$dbname" 2>/dev/null; then
      ok "Created database '$dbname'"
      if psql "$db_url" -c 'SELECT 1' >/dev/null 2>&1; then
        ok "PostgreSQL connection OK"
        return
      fi
    fi
  fi
  fail "PostgreSQL connection failed.

Use unix-socket auth (no password) in .env.local:
  DATABASE_URL=postgresql://\$USER@localhost/codingautomation?host=/var/run/postgresql

Then create your local role + database:
  # Ubuntu
  sudo systemctl start postgresql
  sudo -u postgres createuser -s \$USER
  sudo -u postgres createdb -O \$USER codingautomation

  # macOS (Homebrew)
  createuser -s \$USER
  createdb codingautomation

Re-run: ./scripts/setup-local.sh --yes

Do NOT use postgresql://user@localhost:5432/... — that causes auth_failed on login."
}

load_team_secrets() {
  if [ -f "$SECRETS_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$SECRETS_FILE"
    set +a
    # Local setup always uses local Postgres — never Replit or TCP URLs from secrets.
    unset DATABASE_URL
    ok "Loaded scripts/team-secrets.env"
  else
    fail "Missing scripts/team-secrets.env — ask team lead, or: cp scripts/team-secrets.env.example scripts/team-secrets.env"
  fi
}

prompt_or_default() {
  local label="$1" default="$2" var_name="$3"
  if [ "$AUTO_YES" = true ]; then
    printf -v "$var_name" '%s' "$default"
    return
  fi
  local input=""
  read -r -p "$label [$default]: " input
  printf -v "$var_name" '%s' "${input:-$default}"
}

echo ""
echo "========================================"
echo "  Coding Automation — Local Setup"
echo "========================================"
echo ""

info "Step 1/5 — Checking prerequisites..."
check_prerequisites
echo ""

info "Step 2/5 — Loading secrets & configuring..."
load_team_secrets

DEFAULT_DB="$(local_socket_db_url)"  # explicit unix socket — works in psql and Node
DEFAULT_APP_URL="${APP_URL:-http://localhost:5001}"

[ -n "${OPENROUTER_API_KEY:-}" ] || fail "OPENROUTER_API_KEY missing in team-secrets.env"
[ -n "${CRON_SECRET:-}" ]        || fail "CRON_SECRET missing in team-secrets.env"
[ -n "${ADMIN_SECRET_KEY:-}" ]    || fail "ADMIN_SECRET_KEY missing in team-secrets.env"

DATABASE_URL="$DEFAULT_DB"
ok "DATABASE_URL=$DATABASE_URL (local unix socket — not Replit)"
ok "Secrets loaded (OPENROUTER_API_KEY, CRON_SECRET, ADMIN_SECRET_KEY)"
if [ "$AUTO_YES" = false ]; then
  read -r -p "APP_URL [$DEFAULT_APP_URL]: " APP_URL_INPUT
  APP_URL="${APP_URL_INPUT:-$DEFAULT_APP_URL}"
else
  APP_URL="$DEFAULT_APP_URL"
fi
echo ""

ensure_postgres "$DATABASE_URL"
echo ""

info "Step 3/5 — Python virtual environment..."
info "Location: $VENV_DIR (outside repo — avoids Turbopack build issues)"
if [ ! -d "$VENV_DIR" ]; then
  "$PYTHON_CMD" -m venv "$VENV_DIR"
  ok "Created venv"
else
  warn "Reusing existing venv"
fi

VENV_PYTHON="$VENV_DIR/bin/python3"
[ -x "$VENV_PYTHON" ] || fail "venv python not found at $VENV_PYTHON"

"$VENV_PYTHON" -m pip install --upgrade pip --quiet
"$VENV_PYTHON" -m pip install -r pipeline/requirements.txt --quiet
ok "Python packages installed"
echo ""

info "Step 4/5 — Writing .env.local..."
ENV_FILE="$ROOT/.env.local"
if [ -f "$ENV_FILE" ] && [ "$AUTO_YES" = false ]; then
  read -r -p ".env.local exists. Overwrite? (y/N): " OVERWRITE
  [[ "$OVERWRITE" =~ ^[Yy]$ ]] || fail "Aborted."
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
elif [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
fi

{
  echo "# Generated by scripts/setup-local.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "PIPELINE_ROOT=$ROOT/pipeline"
  echo "PYTHON_PATH=$VENV_PYTHON"
  echo "OPENROUTER_API_KEY=$OPENROUTER_API_KEY"
  echo "ADMIN_SECRET_KEY=$ADMIN_SECRET_KEY"
  echo "DATABASE_URL=$DATABASE_URL"
  echo "CRON_SECRET=$CRON_SECRET"
  [ -n "${RESEND_API_KEY:-}" ] && echo "RESEND_API_KEY=$RESEND_API_KEY"
  [ -n "${OPENROUTER_BASE_URL:-}" ] && echo "OPENROUTER_BASE_URL=$OPENROUTER_BASE_URL"
  echo "PORT=5001"
  echo "INTERNAL_API_URL=http://127.0.0.1:5001"
  echo "APP_URL=$APP_URL"
  echo "NEXT_PUBLIC_APP_URL=$APP_URL"
} > "$ENV_FILE"
ok "Wrote .env.local"
echo ""

info "Step 5/6 — npm install & database sync..."
fix_npm_for_local

if ! npm install --no-audit --no-fund; then
  echo ""
  fail "npm install failed. Common fixes:
  • Check internet connection
  • Delete node_modules and retry: rm -rf node_modules && npm install
  • If you see 'package-firewall.replit.local', pull latest code and re-run this script"
fi
ok "npm packages installed"

npm run db:push
ok "Database schema synced"
echo ""

USERS_EXPORT="$ROOT/scripts/team-users-export"
if [ -f "$USERS_EXPORT/json/users.json" ]; then
  info "Step 6/6 — Importing Replit users (logins only)..."
  npx tsx scripts/import-team-users.mts --from "$USERS_EXPORT"
  ok "Team users imported — use your Replit email + password to log in"
else
  info "Step 6/6 — Team users import"
  warn "Missing scripts/team-users-export/json/users.json"
  warn "Ask team lead for the export zip → extract to scripts/team-users-export/"
  warn "Or sign up at /signup after setup"
fi
echo ""

echo "========================================"
echo -e "${GREEN}Setup complete!${NC}"
echo "========================================"
echo ""
echo "  npm run dev"
echo "  → http://localhost:5001"
echo ""
if [ -f "$USERS_EXPORT/json/users.json" ]; then
  echo "  Log in with your Replit email + password"
else
  echo "  Sign up: /signup  (admin secret → ADMIN_SECRET_KEY in .env.local)"
fi
echo ""
