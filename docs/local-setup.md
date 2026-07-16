# Local Setup Guide

Run the whole app on your own machine. It connects to the team's **shared cloud
Postgres (Aiven)** via `DATABASE_URL` in `.env.local` — **no local database, no Docker**.

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

### 2. Environment (`.env.local`)

```bash
cp .env.example .env.local
# Edit .env.local — fill in the required values:
#   OPENROUTER_API_KEY, CRON_SECRET, DATABASE_URL
#   AWS S3 (optional): AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
#                      AWS_BUCKET_NAME, AWS_OBJECT_KEY_PREFIX
# (ADMIN_SECRET_KEY is optional — only for self-registering a new admin.)
```

> `.env.example` is the single template listing every variable. Copy it to
> `.env.local` and fill in your values. The app reads credentials only from
> `.env.local`. `DATABASE_URL` is the shared cloud Postgres connection string —
> ask your team lead. It must end with `?sslmode=require`. With AWS S3 creds set,
> uploaded files go to the shared bucket; otherwise they fall back to
> `.local-object-storage/` on disk.

Also set machine-specific paths in `.env.local`:

```bash
PIPELINE_ROOT=/absolute/path/to/CodingAutomationWebsite/pipeline
PYTHON_PATH=/home/you/.codingautomation-venv/bin/python3
PORT=5001
APP_URL=http://localhost:5001
NEXT_PUBLIC_APP_URL=http://localhost:5001
INTERNAL_API_URL=http://127.0.0.1:5001
```

### 3. Check dependencies

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

The script only checks (and optionally installs) Git, Node, npm, and Python.

### 4. Install packages

```bash
npm install

python3 -m venv ~/.codingautomation-venv
~/.codingautomation-venv/bin/pip install -r pipeline/requirements.txt
```

There is **no** `db:push` — the shared database schema is managed centrally.

### 5. Start the app

```bash
npm run build && npm run start
```

Or for development (first page load can take 1–2 min to compile):

```bash
npm run dev
```

Open **http://localhost:5001/signup** and create your account.
For an **admin** account, use `ADMIN_SECRET_KEY` from `.env.local`.

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
| Database | **Shared cloud Postgres (Aiven)** — via `DATABASE_URL` in `.env.local` |
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

## Sharing dev via ngrok

Teammates can reach your machine while you run `npm run dev`:

```bash
npm run dev
ngrok http 5001
```

`next.config.ts` already allows `*.ngrok-free.dev`, `*.ngrok-free.app`, and related
ngrok hostnames for HMR / dev assets.

For correct redirects and links, set your tunnel URL in `.env.local`:

```bash
APP_URL=https://your-subdomain.ngrok-free.dev
NEXT_PUBLIC_APP_URL=https://your-subdomain.ngrok-free.dev
```

Restart the dev server after changing env vars or `next.config.ts`.

---

## Troubleshooting

### `DATABASE_URL missing in .env.local`

You didn't fill in the shared database URL. Open `.env.local`, paste
the `DATABASE_URL` your team lead gave you, then restart the app.

### Can't connect to the database

- Make sure `DATABASE_URL` is copied exactly and ends with `?sslmode=require`.
- Check your internet connection — the database is in the cloud.

### Dev server shows "Ready" but the browser spins

Wait 1–2 minutes on the **first** page load, or use production mode:

```bash
npm run build && npm run start
```

### ngrok: "Blocked cross-origin request to Next.js dev resource"

Restart `npm run dev` after pulling — ngrok hostnames are allowlisted in
`next.config.ts`. If you use a custom tunnel domain, add it via
`ALLOWED_DEV_ORIGINS=your-host.example.com` in `.env.local` or set
`NGROK_DOMAIN=your-host.example.com`.
