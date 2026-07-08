# Local Setup Guide

Run the whole app on your own machine. It connects to the team's **shared cloud
Postgres (Neon)** via `DATABASE_URL` — **no local database, no Docker**. Uploaded
files are stored on your local disk, and you create your own account.

> Everyone shares the same cloud database, so the users and problems you see are
> the same as your teammates'.

---

## Prerequisites

The setup script can auto-install Node and Python for you. You only need Git and
an internet connection.

| Tool | Version | Notes |
|------|---------|-------|
| Git | any | Auto-installed if missing |
| Node.js | 20+ | Auto-installed if missing |
| Python | 3.11+ | Auto-installed if missing |

No Docker, no local Postgres — the database lives in the cloud.

---

## One-time setup

### 1. Clone

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
```

### 2. Secrets (from team lead)

```bash
cp scripts/team-secrets.env.example scripts/team-secrets.env
# Edit scripts/team-secrets.env — fill in the required values:
#   OPENROUTER_API_KEY, CRON_SECRET, DATABASE_URL
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_BUCKET_NAME,
#   AWS_OBJECT_KEY_PREFIX
# (ADMIN_SECRET_KEY is optional — only for self-registering a new admin.)
```

> `DATABASE_URL` is the shared Neon connection string — ask your team lead. It must
> end with `?sslmode=require`. Setup writes it into `.env.local` for you.

### 3. Run setup

**macOS / Linux:**

```bash
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh --yes
```

On a fresh Linux box that also needs Node/Python installed:

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
2. load secrets and validate `DATABASE_URL` is set
3. create the Python venv and install pipeline deps
4. write `.env.local`
5. `npm install`

There is **no** `db:push` — the shared database schema is managed centrally.

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

## What's available in the app

Once you're signed in (base URL `http://localhost:5001`):

| Page | Path | What it's for |
|------|------|---------------|
| Problems | `/problems` | Browse and manage CP-prep problems |
| Pipeline | `/pipeline` | Run the multi-step content generation pipeline |
| Outputs | `/outputs` | View the generated files for each problem |
| Guide | `/guide` | In-app usage guide |
| What's New | `/whats-new` | Recent changes / changelog |
| Settings | `/settings` | Your account settings |
| Admin | `/admin` | User management + LLM usage & cost tracking (**admins only**) |

Everything is backed by the **shared cloud database**, so problems, outputs, and
users are the same for the whole team.

---

## What runs where

| Piece | Where |
|-------|-------|
| Web app | Node on your machine, port **5001** |
| Database | **Shared cloud Postgres (Neon)** — via `DATABASE_URL` |
| Python pipeline | venv at `~/.codingautomation-venv` |
| Your login & problems | Shared cloud database (same for the whole team) |
| Uploaded files | **Shared AWS S3 bucket** when AWS creds are in `.env.local`; otherwise `.local-object-storage/` on your machine |

---

## Daily use

```bash
npm run dev          # development
# or: npm run build && npm run start
```

Nothing to start or stop for the database — it's always available in the cloud.

---

## Troubleshooting

### `DATABASE_URL missing in team-secrets.env`

You didn't fill in the shared database URL. Open `scripts/team-secrets.env`, paste
the `DATABASE_URL` your team lead gave you, then re-run setup.

### Can't connect to the database

- Make sure `DATABASE_URL` is copied exactly and ends with `?sslmode=require`.
- Check your internet connection — the database is in the cloud.

### Dev server shows "Ready" but the browser spins

Wait 1–2 minutes on the **first** page load, or use production mode:

```bash
npm run build && npm run start
```
