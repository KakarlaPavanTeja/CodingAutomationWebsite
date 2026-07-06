# Local Setup Guide

Run the whole app on your own machine — no Replit. Postgres runs in **Docker**
(identical on Windows / macOS / Linux, no password/login headaches), files are
stored on your local disk, and you create your own account.

> The Replit database is **not** imported. You start with an empty DB and sign up fresh.

---

## Prerequisites

The setup script can auto-install Node and Python for you, but **Docker you must
install yourself** (it needs a GUI installer on Windows/macOS):

| Tool | Version | Notes |
|------|---------|-------|
| **Docker** | latest | **Windows/macOS:** [Docker Desktop](https://www.docker.com/products/docker-desktop/). **Linux:** Docker Engine. Must be **running** before setup. |
| Node.js | 20+ | Auto-installed if missing |
| Python | 3.11+ | Auto-installed if missing |
| Git | any | Auto-installed if missing |

**Before running setup, start Docker** and wait until it reports *running*
(whale icon steady on Windows/macOS).

---

## One-time setup

### 1. Clone

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
```

### 2. API keys (from team lead)

```bash
cp scripts/team-secrets.env.example scripts/team-secrets.env
# Edit scripts/team-secrets.env — OPENROUTER_API_KEY, CRON_SECRET, ADMIN_SECRET_KEY
```

> Do **not** put a `DATABASE_URL` in this file — setup configures the local Docker DB.

### 3. Run setup

**macOS / Linux:**

```bash
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh --yes
```

On a fresh Linux box that also needs Node/Python/Docker installed:

```bash
./scripts/setup-local.sh --install-system-deps --yes
```

**Windows (PowerShell):**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -Yes
# add -InstallSystemDeps to also install Node/Python via winget
```

The script will:
1. check/install Node, Python, Git
2. verify Docker is running
3. start Postgres in Docker (`docker compose up -d db`)
4. create the Python venv and install pipeline deps
5. write `.env.local`
6. `npm install` and push the DB schema

### 4. Start the app

```bash
npm run build && npm run start
```

Or for development (first page load can take 1–2 min to compile):

```bash
npm run dev
```

Open **http://localhost:5001/signup** and create your account.
For an **admin** account, use `ADMIN_SECRET_KEY` from `scripts/team-secrets.env`.

---

## What runs where

| Piece | Where |
|-------|-------|
| Web app | Node on your machine, port **5001** |
| Database | **Postgres in Docker** (`codingautomation-db` container, port 5432) |
| Python pipeline | venv at `~/.codingautomation-venv` |
| Your login & problems | Local Docker Postgres |
| Uploaded files | `.local-object-storage/` on your machine |

Nothing connects to Replit in local mode.

---

## Daily use

```bash
npm run db:up        # start Postgres (if not already running)
npm run dev          # development
# or: npm run build && npm run start
```

Database controls:

```bash
npm run db:up        # start Postgres container
npm run db:down      # stop it (your data is kept)
npm run db:logs      # tail Postgres logs
npm run db:reset     # WIPE the database and start fresh
```

Docker Desktop keeps the container across reboots (`restart: unless-stopped`),
so usually you don't need `db:up` again after the first setup.

---

## Troubleshooting

### `Cannot connect to the Docker daemon` / "Docker is not running"

Start Docker Desktop (Windows/macOS) and wait until it says *running*, or on
Linux: `sudo systemctl start docker`. Then re-run setup.

### Linux: `permission denied` talking to Docker

You were just added to the `docker` group — **log out and back in** (or reboot),
or prefix commands with `sudo` for this session. Setup handles this automatically
by falling back to `sudo docker`.

### Port 5432 already in use

You have another Postgres running. Either stop it, or run on a different port:

```bash
# macOS/Linux
DB_PORT=5433 ./scripts/setup-local.sh --yes
```

```powershell
# Windows
$env:DB_PORT=5433; powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -Yes
```

Setup writes the matching `DATABASE_URL` into `.env.local` automatically.

### `db:push` reports nothing / schema errors

Reset the database and re-push:

```bash
npm run db:reset
npm run db:push
```

### Dev server shows "Ready" but the browser spins

Wait 1–2 minutes on the **first** page load, or use production mode:

```bash
npm run build && npm run start
```

### Want a completely clean slate

```bash
docker compose down -v      # deletes the DB volume
./scripts/setup-local.sh --yes
```
