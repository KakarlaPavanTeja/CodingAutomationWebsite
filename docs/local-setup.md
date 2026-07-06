# Local Setup Guide

**Model:** Replit logins (imported once) + local Postgres + local problem files.

---

## Team lead (once, on Replit)

Replit has **separate dev and production databases**. Shell `DATABASE_URL` is **development** — that export does **not** include live-site passwords.

**Export from production** (passwords from `coding-question-automation.replit.app`):

1. Replit → **Publishing** → **Production** → **Secrets** → copy `DATABASE_URL`
2. In Shell:

```bash
PRODUCTION_DATABASE_URL='<paste production DATABASE_URL>' npm run export:team-users:prod
```

Check `scripts/team-users-export/manifest.json`: `"environment": "production"` and `usersWithPassword` should match your team.

Zip and share `scripts/team-users-export/` with the team (Slack / Drive).

Also share `scripts/team-secrets.env` (API keys).

---

## Team member — Ubuntu (fully automatic)

### 1. Clone

```bash
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite
```

### 2. Add shared files from team lead

```
scripts/team-secrets.env          # API keys
scripts/team-users-export/        # unzip export here
  json/users.json
  json/profiles.json
  manifest.json
```

### 3. Run setup

```bash
chmod +x scripts/setup-local.sh
./scripts/setup-local.sh --install-system-deps --yes
```

### 4. Start app

```bash
npm run dev
```

Open **http://localhost:5001** → log in with **Replit email + password**.

---

## Team member — Windows

```powershell
# Place team-secrets.env + team-users-export/ first
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1 -InstallSystemDeps -Yes
npm run dev
```

---

## What gets stored where

| Data | Location |
|------|----------|
| Logins (users) | Imported to **local Postgres** from export |
| Problem list you create | **Local Postgres** on your PC |
| Files (problem.md, outputs) | **`.local-object-storage/`** on your PC |

Replit problems are **not** imported — only user accounts.

---

## Commands reference

| Command | Who | Where |
|---------|-----|-------|
| `npm run export:team-users:prod` | Team lead | Replit (production DB) |
| `npm run import:team-users` | Re-import after new export | Local |
| `./scripts/setup-local.sh --install-system-deps --yes` | Everyone | Ubuntu |
| `npm run import:team-users` | Manual re-import | Local |
| `npm run dev` | Daily | Local |

---

## Troubleshooting

### Login fails with `password authentication failed for user "..."`

This is a **Postgres connection** error, not your Replit password.

Your `.env.local` probably has `postgresql:///codingautomation` or a TCP URL. Node connects via TCP for those and fails; use an explicit unix socket:

```bash
# Fix .env.local (Ubuntu)
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${USER}@localhost/codingautomation?host=/var/run/postgresql|" .env.local

# Re-import users and restart
npm run import:team-users
npm run dev
```

Or re-run setup (rewrites `.env.local`):

```bash
./scripts/setup-local.sh --yes
npm run import:team-users
```
