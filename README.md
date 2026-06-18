# Coding Automation Website

A Next.js 16 platform for automating the creation, translation, and validation of coding problems. Users upload a `problem.md` and a reference `solution.py`, and the platform runs a multi-step Python + LLM pipeline that produces:

- A polished problem description (Markdown)
- Reference solutions in **Python, C++, Java, and Node.js**
- Auto-generated diverse test cases
- Split solution components: `driver`, `solution`, `default`, `debugger`
- Validated execution results across all languages
- Enrichment content (hints, follow-ups, real-world scenarios)
- A packaged LUA bundle ready to upload to a learning platform

The frontend orchestrates spawned Python processes, streams logs in real time, and persists artifacts to Replit App Storage (GCS).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, React 19, Turbopack dev) |
| Language (web) | TypeScript |
| Styling | Tailwind CSS + shadcn/ui (Base UI) |
| Database | **PostgreSQL** (Replit Postgres) |
| ORM | **Drizzle ORM** + `drizzle-kit` |
| Auth | Custom — `bcryptjs` + DB-backed session-cookie |
| File storage | **Replit App Storage** (GCS-backed via sidecar) |
| Pipeline runtime | Python 3.11+ |
| LLM | OpenRouter via proxy gateway (`open-router-gateway.replit.app`, `OPENROUTER_API_KEY`) |
| Email | Resend (`RESEND_API_KEY`) |
| Deployment | Replit Autoscale (`.replit` + Publishing UI) |

> ⚠ **Next.js 16 has breaking changes.** Routing uses `src/proxy.ts` (NOT `middleware.ts`). API route handlers receive `params` as a **Promise** (`{ params: Promise<{ id: string }> }`). `cookies()` and `headers()` are async. See `AGENTS.md`.

---

## Repository Layout

```
.
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Root: shows GuidePage for guests, Dashboard for logged-in users
│   │   ├── login/              # Login form (calls /api/auth/login)
│   │   ├── signup/             # Signup → goes to /pending-approval
│   │   ├── reset-password/     # 2-step reset flow (request + confirm token)
│   │   ├── pending-approval/   # Lands here when profile.status = pending_approval
│   │   ├── guide/              # Public landing/marketing page
│   │   ├── problems/           # Problem list + per-problem detail
│   │   │   └── [id]/           # Problem detail (file browser, runs, etc.)
│   │   ├── pipeline/           # Pipeline run UI (step cards, logs, configuration)
│   │   ├── admin/
│   │   │   ├── users/          # User approval / role management
│   │   │   ├── problems/       # All-problems admin view
│   │   │   ├── costs/          # LLM token + dollar cost dashboard
│   │   │   └── stats/          # System stats
│   │   └── api/                # Route handlers — see "API Routes" below
│   │
│   ├── components/             # React components (UI, layout, pipeline cards, log viewers)
│   ├── lib/
│   │   ├── db/
│   │   │   ├── schema.ts       # Drizzle schema — single source of truth for DB
│   │   │   └── index.ts        # postgres.js client + Drizzle instance
│   │   ├── auth/
│   │   │   ├── server.ts       # requireAuth, requireAdmin (server components)
│   │   │   ├── api.ts          # requireAuthApi, requireAdminApi (route handlers)
│   │   │   ├── ownership.ts    # requireProblemAccess (per-resource auth)
│   │   │   ├── session.ts      # Session creation/validation, cookie management
│   │   │   └── password.ts     # bcrypt hash/verify wrappers
│   │   ├── object-storage.ts   # GCS client (Replit App Storage)
│   │   ├── storage-sync.ts     # Local <→ GCS bidirectional sync for pipeline files
│   │   ├── storage-path.ts     # Path validators (UUID-only, no traversal)
│   │   ├── pipeline-config.ts  # PIPELINE_ROOT, PIPELINE_SCRIPTS_DIR, languages, steps
│   │   ├── auth-context.tsx    # React context — current user + refreshAuth()
│   │   ├── problems-context.tsx # React context — cached /api/problems with SWR semantics
│   │   ├── pipeline-context.tsx # React context — current pipeline run state
│   │   └── app-url.ts          # Trusted base URL builder (used in emails)
│   └── proxy.ts                # Edge proxy (Next 16's middleware replacement)
│
├── pipeline/
│   ├── Scripts/                # Python pipeline scripts (see "Pipeline" below)
│   │   ├── llm_client.py       # OpenRouter (proxy gateway) chat-completions wrapper
│   │   ├── usage_tracker.py    # Token/cost accounting; reports to /api/internal/llm-usage
│   │   ├── generate_full_question.py
│   │   ├── testcase_manager.py
│   │   ├── code_splitter.py
│   │   ├── code_cleaner.py
│   │   ├── execution_manager_v2.py
│   │   ├── execution_manager_nonfunctionbased.py
│   │   ├── enrichment_manager.py
│   │   ├── prepare_lua_and_testcases.py
│   │   └── Prompts/            # All LLM prompt templates (.md / .txt)
│   ├── Inputs/                 # Working dir for current run's inputs
│   ├── Outputs/                # Working dir for generated artifacts
│   ├── problems/               # Per-problem persistent workspace (synced to GCS)
│   ├── zReferenceFiles/        # LUA template + reference files
│   └── requirements.txt        # Python deps (openai, boto3, requests, etc.)
│
├── attached_assets/            # Static assets uploaded by user
├── replit.md                   # Replit Agent's working notes (architecture log)
├── AGENTS.md                   # Next.js 16 rules for AI coding agents
├── CLAUDE.md                   # Anthropic-specific agent notes
├── drizzle.config.ts           # Drizzle Kit config (points to src/lib/db/schema.ts)
├── next.config.ts              # Next.js config
├── tsconfig.json
├── package.json
└── .replit                     # Replit workflow + deployment config
```

---

## Database Schema (`src/lib/db/schema.ts`)

All tables live in Replit Postgres. Use `npm run db:push` to sync schema changes. **Never write raw SQL migrations.**

| Table | Purpose |
|---|---|
| `users` | Email + bcrypt `password_hash` + `password_reset_required` flag |
| `sessions` | PK = sha256 of raw session token; raw token in httpOnly cookie; 30-day TTL |
| `password_reset_tokens` | 1-hour TTL, single-use, atomic claim |
| `profiles` | App-level user data: `display_name`, `role` (`admin` \| `problem_setter`), `status` (`pending_approval` \| `active` \| `deactivated`). FK → `users.id` cascade |
| `problems` | Problem metadata: `name`, `type` (`function` \| `nonfunction`), `created_by`, GCS storage paths |
| `pipeline_states` | Per-problem persistent config: completed steps, sub-step toggles, language selections, test count, mode |
| `pipeline_runs` | History of every step execution: `step_id`, `status`, `exit_code`, `started_at`, `finished_at`, `pid` |
| `pipeline_logs` | Captured stdout/stderr for each run, chunked |
| `llm_usage` | Per-call token counts, model, cost in USD, problem + run linkage |
| `auth_audit_log` | Login attempts, password changes, admin actions (IP + user-agent) |
| `rate_limits` | Sliding-window rate limit buckets per IP/user |

---

## Pipeline Workflow

The pipeline turns one input pair (`problem.md` + `solution.py`) into a fully validated, multi-language coding problem. It runs as a sequence of discrete steps, each a separate Python script invoked from the Node API via `child_process.spawn`.

### Steps

| # | Step ID | Script | What it does |
|---|---|---|---|
| 1 | `generate_question` | `generate_full_question.py` | Generates polished MD description, translates solution to all selected languages, predicts difficulty + topics |
| 2 | `generate_testcases` | `testcase_manager.py` | LLM writes a Python script that *generates* N diverse test cases; runs it; auto-retries on failure |
| 3 | `split_code` | `code_splitter.py` | Splits each language solution into `driver.{ext}`, `solution.{ext}`, `default.{ext}`, `debugger.{ext}` |
| 4 | `execute_tests` | `execution_manager_v2.py` (or `_nonfunctionbased.py`) | Runs all language solutions against all test cases via external compiler API; records pass/fail |
| 5 | `enrichment` | `enrichment_manager.py` | Generates hints, follow-up questions, real-world scenarios |
| 6 | `package_platform` | `prepare_lua_and_testcases.py` | Bundles everything into LUA script + JSON testcases for platform upload |

### Languages

Defined in `src/lib/pipeline-config.ts`. IDs are `python`, `cpp`, `java`, `nodejs`. **Frontend always sends IDs, never labels** — API validates against `LANGUAGES.map(l => l.id)`.

### Modes

- **`function`** (default) — solution is a function; tests call it with args
- **`nonfunction`** — solution reads from stdin / writes to stdout; uses `execution_manager_nonfunctionbased.py`

Modes also include **`practice`** vs **`exam`**:
- `practice` — runs full pipeline including enrichment
- `exam` — skips enrichment

### Orchestration (`src/app/api/pipeline/run/route.ts`)

1. Validates input (stepId, mode, languages, subSteps, testcaseCount) against allowlists
2. `requireProblemAccess()` — caller must own the problem or be admin
3. `storage-sync.ts` pulls the problem's files from GCS into `pipeline/problems/<problem-id>/`
4. Spawns Python with env: `PROBLEM_ID`, `INTERNAL_API_URL`, `INTERNAL_API_SECRET` (= `CRON_SECRET`); `OPENROUTER_API_KEY` (and optional `OPENROUTER_BASE_URL`) are inherited from the process env
5. Streams stdout/stderr to `pipeline_logs` table; tracks PID in `process-registry`
6. On exit: pushes generated files back to GCS, updates `pipeline_runs.status` + `exit_code`
7. Stop endpoint sends SIGTERM, then SIGKILL after timeout

### LLM Usage Tracking

Every Python LLM call goes through `llm_client.py`, which calls OpenRouter (Chat Completions) through the proxy gateway (`open-router-gateway.replit.app`) and requests `usage.include=true` so the response carries the **real USD cost** of the call. After each call, `usage_tracker.py` POSTs that cost (no local pricing table) to `/api/internal/llm-usage` with `X-Internal-Secret: <CRON_SECRET>`, and it is stored in `llm_usage`. Admins view aggregates at `/admin/costs`.

---

## API Routes

All routes are in `src/app/api/`. Every protected route uses one of: `requireAuthApi`, `requireAdminApi`, or `requireProblemAccess`.

### Auth (`/api/auth/*`)
- `POST /login` — email + password → sets session cookie
- `POST /signup` — creates user + profile (`pending_approval`)
- `POST /logout` — clears session
- `GET /session` — returns current user (used by `auth-context.tsx`)
- `POST /change-password` — requires current password
- `POST /reset-password/request` — generates token, emails reset link
- `POST /reset-password/confirm` — atomic token claim + password update
- `POST /verify-admin-secret` — gates admin signup with `ADMIN_SECRET_KEY`
- `GET /audit` — admin-only audit log

### Problems (`/api/problems/*`)
- `GET /` — list problems (filtered by ownership unless admin)
- `POST /` — create new problem
- `GET /[id]` — single problem details
- `DELETE /[id]/delete` — admin-only or owner

### Pipeline (`/api/pipeline/*`)
- `POST /run` — start a step (validates input, spawns Python)
- `GET /run/status` — poll run status
- `POST /run/stop` — kill running process
- `GET /run/logs` — fetch logs (bound to runId AND problemId AND stepId)
- `GET /state` / `POST /state` — per-problem pipeline configuration

### Files (`/api/files/*`)
- `POST /upload` — upload `problem.md` / `solution.py`
- `GET /read` — read a file from GCS
- `POST /save` — save edited file
- `GET /outputs` — list generated outputs
- `GET /download` — download a single file or zip

### Admin (`/api/admin/*`)
- `GET /users`, `GET /users/[id]/reset-link` — user management
- `GET /usage` — LLM cost report
- `GET /stats` — system stats
- `POST /cleanup` — purge old runs/logs

### Internal (`/api/internal/*`)
- `POST /llm-usage` — Python pipeline reports token usage here. Auth via `X-Internal-Secret` header.

---

## Authentication

Custom session-cookie auth (no Supabase, no NextAuth).

**Login flow:**
1. POST `/api/auth/login` with email + password
2. Server: `bcrypt.compare()`, then create row in `sessions` table (PK = sha256 of fresh 32-byte token)
3. Raw token set as `session_token` httpOnly cookie (SameSite=Lax, Secure in prod, 30-day TTL)
4. Client: `await refreshAuth()` to populate `auth-context`, then `router.push("/")`

**Request flow (`src/proxy.ts`):**
1. Read `session_token` cookie. Missing → fast-path: redirect to `/login` (no DB hit)
2. Hash token, look up in `sessions` joined to `profiles`
3. Stale/invalid → clear cookie, redirect `/login`
4. `profile.status = pending_approval` → redirect `/pending-approval`
5. `profile.status = deactivated` → clear cookie, redirect `/login`
6. Public paths (`/`, `/login`, `/signup`, `/reset-password`, `/guide`, `/pending-approval`) bypass

**Roles:** `admin` (full access) and `problem_setter` (can only see/run their own problems).

---

## Environment Variables

Set these in **Replit Secrets** (production) or `.env.local` (Cursor local dev — never commit).

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Postgres connection string |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter proxy gateway API key |
| `OPENROUTER_BASE_URL` | ⬜ | Override gateway endpoint (default `https://open-router-gateway.replit.app/api/proxy`) |
| `CRON_SECRET` | ✅ | Shared secret: Node ↔ Python (`X-Internal-Secret`) |
| `ADMIN_SECRET_KEY` | ✅ | Required to sign up as admin |
| `RESEND_API_KEY` | ✅ | Password reset emails |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID` | ✅ | Replit App Storage bucket |
| `PUBLIC_OBJECT_SEARCH_PATHS` | ✅ | Replit App Storage search paths |
| `PRIVATE_OBJECT_DIR` | ✅ | Replit App Storage private dir |
| `APP_URL` | (prod) | Trusted base URL for emails |
| `STORAGE_BUCKET` | (legacy) | Old Supabase bucket name — only used by migration scripts |
| `OPENROUTER_MODEL_{TESTCASES,CHAT,CODE,ENRICHMENT,EDITORIAL}` | optional | Override the OpenRouter model per purpose (defaults: chat/enrichment = `openai/gpt-5.4`, testcases = `google/gemini-2.5-pro`, code = `openai/gpt-5.3-codex`, editorial = `openai/gpt-5.5`) |

**Legacy / safe to delete** (kept temporarily, no runtime use): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.

---

## Local Development (Cursor)

```bash
# 1. Clone
git clone https://github.com/KakarlaPavanTeja/CodingAutomationWebsite.git
cd CodingAutomationWebsite

# 2. Install JS deps
npm install

# 3. Install Python deps
python3 -m pip install -r pipeline/requirements.txt

# 4. Create .env.local with the secrets above (DATABASE_URL etc.)
#    Easiest: copy from Replit Secrets panel

# 5. Sync DB schema
npm run db:push

# 6. Run dev server (port 5000)
npm run dev
```

Then open `http://localhost:5000`. The Python pipeline is invoked from `src/app/api/pipeline/run/route.ts` — `PIPELINE_ROOT` defaults to `path.join(process.cwd(), "pipeline")`, so it works the same locally.

### GitHub → Replit Auto-Sync

This Replit project is connected to `github.com/KakarlaPavanTeja/CodingAutomationWebsite`. To enable auto-pull on push:

1. Open the **Git** panel in the Replit workspace
2. Enable **"Sync with GitHub"** / **"Auto-pull"**
3. Push from Cursor → Replit pulls within seconds → Next.js hot-reloads

**Manual ops still required after a sync:**
- New npm package → run `npm install`
- New Python package → add to `pipeline/requirements.txt` and pip install
- New env secret → add to Replit Secrets panel
- DB schema change in `src/lib/db/schema.ts` → run `npm run db:push`

---

## Common Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server on port 5000 (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run lint` | ESLint |
| `npm run db:push` | Sync Drizzle schema → Postgres |
| `npm run db:studio` | Drizzle Studio (visual DB browser) |

---

## Deployment

Deployed via **Replit Publishing** (Autoscale). Configuration in `.replit`:

- Build: `npm run build`
- Start: `npm run start`
- Port: 5000

To deploy: open Publishing panel → Deploy. Production URL is on `*.replit.app` (or custom domain).

**Production secrets must be set separately in the Publishing UI** — they don't auto-copy from dev secrets.

---

## Security Notes

- All problem-scoped endpoints validate UUID via `assertSafeProblemId` and reject path traversal via `assertSafeRelativePath`
- Pipeline run inputs are allowlist-validated (no shell injection)
- 404 (not 403) returned on ownership mismatch — avoids existence leaks
- Email templates HTML-escape all user-supplied content
- Reset URLs built from trusted `APP_URL`, never from `Origin` header
- Sessions: httpOnly + Secure (prod) + SameSite=Lax + sha256-hashed at rest
- Rate limiting on auth endpoints via `rate_limits` table

---

## Operational Notes (handed off from migration)

The project was fully migrated off Supabase. See `replit.md` for the migration log. Outstanding manual cleanup:

- Rotate the old Supabase DB password (it was exposed during the migration window)
- An old NxtWave gateway API key remains in **git history** (file: `pipeline/Scripts/llm_client_niat.py`, since deleted) — please rotate it via NxtWave IT
- Optionally pause/delete the old Supabase project once you've confirmed Replit is the system of record

---

## Roadmap — Agentic Workflow

Planned phases to evolve the pipeline from "user clicks each step" → "agent decides what to do":

1. **Planner Agent** — analyzes input, proposes config (test count, languages, mode)
2. **Quality Reviewer Agent** — grades each step's output, auto-retries with feedback if below threshold
3. **Failure-Recovery Agent** — diagnoses test failures (test wrong vs translation wrong vs solution wrong) and auto-fixes
4. **Chat Operator** — natural-language commands per problem ("add 5 edge cases for negatives", "add Go support")
5. **Autonomous Mode** — set goal, agent runs everything, only pings user when stuck or done

Each phase will be developed in Cursor and synced via GitHub auto-pull.
