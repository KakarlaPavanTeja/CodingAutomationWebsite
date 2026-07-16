#!/usr/bin/env bash
# Check local dev prerequisites (Git, Node 20+, npm, Python 3.11+).
# All credentials and config live in .env.local — copy .env.example and fill it in.
#
# Usage:
#   ./scripts/setup-local.sh
#   ./scripts/setup-local.sh --yes
#   ./scripts/setup-local.sh --install-system-deps --yes
#
# Before running the app:
#   1. cp .env.example .env.local  (fill in DATABASE_URL, API keys, etc.)
#   2. npm install
#   3. python3 -m venv ~/.codingautomation-venv && pip install -r pipeline/requirements.txt
#   4. npm run dev
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

AUTO_YES=false
INSTALL_SYSTEM=false

for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=true ;;
    --install-system-deps) INSTALL_SYSTEM=true ;;
    --help|-h)
      sed -n '2,14p' "$0"
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
    warn "Unknown OS — install Node 20+, Python 3.11+, Git manually."
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

echo ""
echo "========================================"
echo "  Coding Automation — Dependency Check"
echo "========================================"
echo ""

info "Checking prerequisites..."
check_prerequisites
echo ""

if [ ! -f "$ROOT/.env.local" ]; then
  warn ".env.local not found — copy .env.example and fill in your credentials before starting the app:"
  echo "  cp .env.example .env.local"
else
  ok ".env.local present"
fi

echo ""
echo "========================================"
echo -e "${GREEN}Prerequisites OK${NC}"
echo "========================================"
echo ""
echo "  Next steps (if you haven't already):"
echo "    cp .env.example .env.local   # fill in DATABASE_URL, API keys, AWS creds"
echo "    npm install"
echo "    python3 -m venv ~/.codingautomation-venv"
echo "    ~/.codingautomation-venv/bin/pip install -r pipeline/requirements.txt"
echo "    npm run dev                  # http://localhost:5001"
echo ""
