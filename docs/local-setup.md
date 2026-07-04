# Local Setup Guide

Run the app on your machine instead of Replit — much faster for development.

**Two steps total** (after cloning the repo).

---

## Step 1 — Clone + add team secrets

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
```

Get `scripts/team-secrets.env` from your team lead (Slack DM / 1Password — **never commit it**).

Or copy the template and fill it in:

```bash
cp scripts/team-secrets.env.example scripts/team-secrets.env
```

---

## Step 2 — Run one setup command

```bash
./scripts/setup-local.sh
```

That's it. The script checks prerequisites and **offers to fix anything missing or outdated** (e.g. Node v18 → v20, Python 3.10 → 3.11).

Skip the prompt (auto-fix everything on Ubuntu):

```bash
./scripts/setup-local.sh --install-system-deps
```

Fully non-interactive (auto-fix + no prompts):

```bash
./scripts/setup-local.sh --install-system-deps --yes
```

### Windows

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

### Start the app

```bash
npm run dev
```

Open **http://localhost:5001** → sign up at `/signup` (use admin secret from team lead).

---

## What the script does automatically

| Step | Action |
|------|--------|
| 1 | Checks **Git**, **Node 20+**, **Python 3.11+**, **npm** |
| 1b | If missing **or wrong version** → offers apt upgrade (Ubuntu) |
| 2 | Loads `scripts/team-secrets.env` |
| 3 | Creates Python venv at `~/.codingautomation-venv` |
| 4 | Writes `.env.local` |
| 5 | Fixes Replit npm registry issue + runs `npm install` |
| 6 | Runs `npm run db:push` (database tables) |

**Example — wrong versions detected:**

```
! Prerequisite issues found:
  • nodejs: v18.19.0 installed (need v20+)
  • python3: v3.10.12 installed (need v3.11+)

Fix missing/outdated tools automatically (apt)? (Y/n):
```

Press **Y** (or use `--install-system-deps` to skip the question).

---

## Prerequisites

| Tool | Required version |
|------|------------------|
| Git | any recent |
| Node.js | **20+** |
| Python | **3.11+** |
| PostgreSQL | optional (local DB) |

**Check manually:**

```bash
git --version && node -v && npm -v && python3 --version
```

---

## Troubleshooting

### `npm error EAI_AGAIN package-firewall.replit.local`

Pull latest and re-run:

```bash
git pull
./scripts/setup-local.sh
```

### `nodejs: v18 installed (need v20+)`

```bash
./scripts/setup-local.sh --install-system-deps
```

### `python3: v3.10 installed (need v3.11+)`

Same — the script installs `python3.11` via deadsnakes PPA on Ubuntu.

### DB connection fails

```bash
sudo systemctl start postgresql
createdb codingautomation
```

### `Missing scripts/team-secrets.env`

Ask team lead for the file, place at `scripts/team-secrets.env`.

### Port 5001 in use

```bash
npx next dev -p 5002 -H 0.0.0.0
```

---

## Daily workflow

```bash
git pull
npm run dev
```

If schema changed: `npm run db:push` once after pulling.
