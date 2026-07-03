# Local Setup Guide

Run the app on your machine instead of Replit. The UI and Python pipeline run locally, so development is much faster.

**Time needed:** ~15 minutes (first time)

---

## Quick start (automated)

If you already have **Node.js 20+**, **Python 3.11+**, and **Git** installed:

### 1. Get shared team secrets

Ask your team lead for `scripts/team-secrets.env`, or create it:

```bash
cp scripts/team-secrets.env.example scripts/team-secrets.env
# edit scripts/team-secrets.env with shared keys
```

This file contains shared keys (`OPENROUTER_API_KEY`, `ADMIN_SECRET_KEY`, `CRON_SECRET`) and is **gitignored** — share it securely (Slack DM, 1Password, etc.), never via git.

### 2. Run the setup script

The script will:
- Load shared secrets from `scripts/team-secrets.env`
- Ask only for your local `DATABASE_URL` (defaults to `postgresql://YOU@localhost:5432/codingautomation`)
- Create Python venv at `~/.codingautomation-venv` (outside repo — avoids Turbopack build issues)
- Write `.env.local`, install deps, and sync the DB schema

### Ubuntu / Linux / macOS

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
./scripts/setup-local.sh
```

Or:

```bash
npm run setup:local
```

### Windows (PowerShell)

```powershell
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

After setup finishes:

```bash
npm run dev
```

Open **http://localhost:5001**

---

## Step 1 — Install prerequisites

You need these tools before running the setup script (or manual setup):

| Tool | Version | Check it works |
|------|---------|----------------|
| **Node.js** | 20 or newer | `node -v` |
| **npm** | comes with Node | `npm -v` |
| **Python** | 3.11 or newer | `python3 --version` (Ubuntu) / `py -3.11 --version` (Windows) |
| **Git** | any recent version | `git --version` |

### Ubuntu / Linux

**1. Update packages**

```bash
sudo apt update && sudo apt upgrade -y
```

**2. Install Git**

```bash
sudo apt install -y git
```

**3. Install Node.js 20**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should show v20.x or higher
```

**4. Install Python 3.11+**

```bash
sudo apt install -y python3 python3-pip python3-venv
python3 --version   # should show 3.11 or higher
```

If your Ubuntu version ships an older Python, use deadsnakes:

```bash
sudo apt install -y software-properties-common
sudo add-apt-repository -y ppa:deadsnakes/ppa
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3.11-dev
python3.11 --version
```

**5. Optional — local Postgres** (skip if using shared Replit DB)

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb coding_automation
```

---

### Windows

**1. Install Git**

Download and run the installer from https://git-scm.com/download/win  
Use default options; ensure **"Git from the command line"** is enabled.

**2. Install Node.js 20**

Download the **LTS (20.x)** installer from https://nodejs.org/  
Run it and check **"Automatically install necessary tools"** if prompted.

Verify in **PowerShell**:

```powershell
node -v
npm -v
```

**3. Install Python 3.11+**

Download from https://www.python.org/downloads/  
**Important:** on the first installer screen, check **"Add python.exe to PATH"**.

Verify in **PowerShell**:

```powershell
py -3.11 --version
```

**4. Optional — local Postgres** (skip if using shared Replit DB)

Download from https://www.postgresql.org/download/windows/ and run the installer.  
Remember the password you set for the `postgres` user.

---

## Step 2 — Clone the repo

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
```

---

## Step 3 — Run the setup script (recommended)

The script asks for these values:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | ✅ | Postgres connection string (ask team lead) |
| `OPENROUTER_API_KEY` | ✅ | From https://openrouter.ai/keys |
| `CRON_SECRET` | ✅ | Auto-generated if you press Enter |
| `ADMIN_SECRET_KEY` | ✅ | Ask team lead — needed for admin signup |
| `RESEND_API_KEY` | optional | Password-reset emails only |
| `OPENROUTER_BASE_URL` | optional | Defaults to openrouter.ai |
| `APP_URL` | optional | Defaults to `http://localhost:5001` |

**Ubuntu / Linux / macOS:**

```bash
./scripts/setup-local.sh
```

**Windows:**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
```

The script also sets `PYTHON_PATH` to your `.venv` Python so pipeline steps use the correct environment.

---

## Manual setup (alternative)

If you prefer to do it by hand instead of the script:

### Create Python virtual environment

**Ubuntu / Linux / macOS:**

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r pipeline/requirements.txt
```

**Windows (PowerShell):**

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r pipeline/requirements.txt
```

> Activate the venv (`source .venv/bin/activate` or `.\.venv\Scripts\Activate.ps1`) whenever you install Python packages manually.

### Install npm dependencies

```bash
npm install
```

### Create `.env.local`

Create `.env.local` in the project root (never commit this file):

```bash
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
OPENROUTER_API_KEY=sk-or-...
CRON_SECRET=your-random-secret-here
ADMIN_SECRET_KEY=your-admin-secret-here
RESEND_API_KEY=re_...
APP_URL=http://localhost:5001
PYTHON_PATH=/full/path/to/project/.venv/bin/python3
```

**Ubuntu example `PYTHON_PATH`:**

```
PYTHON_PATH=/home/you/CodingAutomationWebsite/.venv/bin/python3
```

**Windows example `PYTHON_PATH`:**

```
PYTHON_PATH=C:\Users\you\CodingAutomationWebsite\.venv\Scripts\python.exe
```

Generate a random `CRON_SECRET`:

```bash
# Ubuntu / macOS
openssl rand -hex 32

# Windows PowerShell
-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_})
```

> **Important:** If multiple people use the **same shared database**, everyone must use the **same `CRON_SECRET`**.

Do **not** set `DEFAULT_OBJECT_STORAGE_BUCKET_ID` — files are stored under `.local-object-storage/` automatically.

### Sync database schema

```bash
npm run db:push
```

---

## Step 4 — Start the dev server

```bash
npm run dev
```

Open **http://localhost:5001**

Press `Ctrl+C` to stop.

---

## Step 5 — Create your account

1. Go to **http://localhost:5001/signup**
2. Fill in your details
3. Choose your role:
   - **Admin** — enter `ADMIN_SECRET_KEY`. You can use the app immediately.
   - **Problem setter** — an existing admin must approve you at **Admin → Users**.

---

## Step 6 — Verify everything works

- [ ] Home page loads at http://localhost:5001
- [ ] You can log in
- [ ] You can create a problem (**Problems → New**)
- [ ] You can upload `problem.md` and `solution.py`
- [ ] You can start a pipeline step (needs valid `OPENROUTER_API_KEY`)

---

## Daily workflow

```bash
cd CodingAutomationWebsite
git pull
npm install       # only if package.json changed
npm run dev
```

If `src/lib/db/schema.ts` changed, run `npm run db:push` once after pulling.

**Ubuntu — activate venv when installing Python deps manually:**

```bash
source .venv/bin/activate
pip install -r pipeline/requirements.txt
```

**Windows:**

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r pipeline/requirements.txt
```

---

## Useful commands

| Command | What it does |
|---------|--------------|
| `npm run setup:local` | Run automated setup (Ubuntu/Linux/macOS) |
| `npm run dev` | Start dev server on port **5001** |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Sync database schema |
| `npm run db:studio` | Open database browser |
| `npm run test:json` | Run Python pipeline unit tests |

---

## Troubleshooting

### `DATABASE_URL is not set`

Ensure `.env.local` is in the project root. Restart `npm run dev` after editing it.

### Database connection fails

- **Shared Replit DB:** confirm the connection string and IP allowlist (ask team lead).
- **Local Postgres (Ubuntu):** `sudo systemctl status postgresql`
- **Local Postgres (Windows):** check the PostgreSQL service is running in Services.

### `OPENROUTER_API_KEY is not set`

Add the key to `.env.local` and restart the dev server.

### Pipeline step fails immediately

1. Check Python: `python3 --version` (Ubuntu) / `py -3.11 --version` (Windows)
2. Check `PYTHON_PATH` in `.env.local` points to `.venv` Python
3. Reinstall deps: `pip install -r pipeline/requirements.txt` (with venv active)
4. Check pipeline logs in the UI

### Port 5001 already in use

```bash
npx next dev -p 5002 -H 0.0.0.0
```

### Windows: "running scripts is disabled"

Run PowerShell as your user and allow the setup script once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Or use the `-ExecutionPolicy Bypass` flag shown above.

### Admin signup says "Invalid admin secret key"

The signup form value must exactly match `ADMIN_SECRET_KEY` in `.env.local`.

---

## What runs where

```
Your machine
├── Next.js app      →  http://localhost:5001
├── Python pipeline  →  .venv/ (spawned when you run pipeline steps)
├── File storage     →  .local-object-storage/
└── Database         →  shared Replit Postgres  OR  local Postgres
```

---

## Need help?

1. Check this doc's troubleshooting section
2. Ask in the team chat
3. Compare your `.env.local` with a teammate who has it working (never paste secrets in public channels)
