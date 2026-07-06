# Local Setup Guide

**Model:** Replit logins (imported once) + local Postgres + local problem files.

---

## Team lead (once, on Replit)

```bash
npm run export:team-users
```

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
| `npm run export:team-users` | Team lead | Replit |
| `./scripts/setup-local.sh --install-system-deps --yes` | Everyone | Ubuntu |
| `npm run import:team-users` | Manual re-import | Local |
| `npm run dev` | Daily | Local |
