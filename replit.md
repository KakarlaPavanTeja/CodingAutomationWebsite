# Coding Automation Website

Next.js 16 application, fully migrated off Supabase to Replit-hosted infrastructure.

## Architecture

- **Framework**: Next.js 16 (App Router) on port 5000, host 0.0.0.0
- **Workflow**: `Start application` runs `npm run dev`
- **Database**: Replit Postgres (`DATABASE_URL`) — Supabase Postgres no longer used
- **ORM**: Drizzle ORM (`src/lib/db/schema.ts`, `src/lib/db/index.ts`); use `npm run db:push` to sync schema
- **Auth**: Custom email + bcrypt + DB-backed session-cookie auth (`src/lib/auth/*`).
  - `users` table holds `email`, `password_hash` (bcryptjs cost=12), `password_reset_required`.
  - `sessions` table is the session store; PK is sha256 of the raw 32-byte session token. The raw token lives in an httpOnly `session_token` cookie (SameSite=Lax; Secure in prod; 30-day TTL).
  - `password_reset_tokens` for the reset flow (1-hour TTL, single-use, atomic claim, all other tokens for the user invalidated on success).
  - Server-component guards: `requireAuth`, `requireAdmin` (in `src/lib/auth/server.ts`).
  - API-route guards: `requireAuthApi`, `requireAdminApi` — both reject any session whose profile status is not `active`.
  - Middleware (`src/proxy.ts`) redirects unauthenticated → `/login`, pending users → `/pending-approval`, deactivated → clears cookie and goes to `/login`.
- **File Storage**: Replit App Storage (GCS-backed) via `src/lib/object-storage.ts` (`DEFAULT_OBJECT_STORAGE_BUCKET_ID`). All pipeline file I/O goes through `src/lib/storage-sync.ts`. Layout in the bucket: `<problem-id>/{inputs,outputs,logs}/...`.

## Database Tables (Replit Postgres)

- `users`, `sessions`, `password_reset_tokens` — auth
- `profiles` — application user profile, `id` FK → `users.id` (cascade delete)
- `problems`, `pipeline_runs`, `pipeline_states`, `pipeline_logs`, `llm_usage`, `auth_audit_log`, `rate_limits`

## Pipeline ↔ App Bridge

The Python pipeline scripts (`pipeline/Scripts/*.py`) record token usage by POSTing to `/api/internal/llm-usage` with header `X-Internal-Secret: <CRON_SECRET>`. The pipeline run handler (`src/app/api/pipeline/run/route.ts`) sets `INTERNAL_API_URL` and `INTERNAL_API_SECRET` on the spawned Python process. Local JSON (`Outputs/usage_tracker.json`) is still written as a backup.

## LLM Client — OpenRouter via Replit AI Integrations

- `pipeline/Scripts/llm_client.py` calls **OpenRouter** (Chat Completions only) through the **Replit AI gateway**, using the OpenAI SDK pointed at `AI_INTEGRATIONS_OPENROUTER_BASE_URL` / `AI_INTEGRATIONS_OPENROUTER_API_KEY` (auto-injected by the `python_openrouter_ai_integrations` blueprint — no own API key, billed to Replit credits). Set up via the integrations system; do not edit those env vars by hand.
- Models are OpenRouter ids (provider-prefixed), preserving the previous OpenAI models: chat/testcases/enrichment = `openai/gpt-5.4`, code = `openai/gpt-5.3-codex`. Override per purpose with `OPENROUTER_MODEL_{TESTCASES,CHAT,CODE,ENRICHMENT}` (legacy `OPENAI_MODEL_*` still honored). Bare names without `/` are auto-prefixed `openai/`.
- `call_llm(...)` returns `(content, usage)`; `usage` includes the **real USD `cost`** returned by OpenRouter (requested via `extra_body={"usage": {"include": True}}`). Streaming is the default (opt out with `OPENAI_DISABLE_STREAMING=1`); reasoning effort applies to chat/testcases; SDK handles retries (`OPENAI_MAX_RETRIES`).
- `usage_tracker.py` no longer computes cost — there is **no `pricing.json`**. `update_usage(..., cost=...)` writes the cost from the response straight to `llm_usage.cost_usd`.

## Migration Status — COMPLETE

All 8 phases done (schema, queries, storage, auth, data rows, files, cleanup). Project is fully off Supabase. The historical `supabase/`, `migrations/`, and `scripts/migrate-*` folders have been removed since the migration is complete.

- Original Supabase RLS policies are NOT replicated — access control is enforced in app code via `requireAuthApi()` / `requireAdminApi()` guards on every protected route.
- Imported users have `password_hash=NULL` and `password_reset_required=true`. They must complete the password-reset flow on first login.

## Outstanding Manual Cleanup (user action)

- Rotate the Supabase database password (since it was exposed via `SUPABASE_DB_URL` during the migration window).
- Delete these now-unused secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `STORAGE_BUCKET`.
- Optionally pause / delete the Supabase project once you've confirmed the Replit copy is the system of record.

## Security Hardening (post-migration)

- Per-route ownership enforcement: `src/lib/auth/ownership.ts` (`requireProblemAccess`) checks the session and verifies the caller is `problems.created_by` or an admin; returns generic 404 on mismatch to avoid existence leaks. Applied to: `files/read`, `files/save`, `files/outputs`, `files/download`, `pipeline/run` (POST), `pipeline/run/logs`, `pipeline/run/status`, `pipeline/run/stop`, `pipeline/state` (GET + POST).
- Path / id validators: `src/lib/storage-path.ts` (`assertSafeProblemId` UUID-only, `assertSafeRelativePath` rejects abs / `..` / null bytes / >512 chars). Used at every problem-scoped endpoint.
- Pipeline run input allowlist: `stepId`, `mode` (`practice|exam`), `languages`, `subSteps` (`/^[a-z0-9_]{1,32}$/`), `testcaseCount` (1–1000) all validated before reaching the spawned Python.
- Logs IDOR closed: `getLogContent`'s runId branch now binds the lookup to `(runId AND problemId AND stepId)`.
- Email template: `passwordResetEmail` HTML-escapes `recipientName` and the URL; control chars stripped, name clamped to 80 chars.
- Reset URLs are built from trusted `APP_URL` (`src/lib/app-url.ts`), not from the request `Origin` header.
- Removed unused scripts that contained a hardcoded NxtWave gateway API key (`pipeline/Scripts/llm_client_niat.py`, `llm_client_GPT4o.py`). **The leaked key is still in git history — please rotate it via NxtWave IT.**
- Bumped `next` 16.2.2 → 16.2.3 (GHSA-q4gf-8mx6-v5v3 high-severity DoS).

## One-off Scripts

- `scripts/migrate-data.mts` — copy DB rows from Supabase to Replit. Idempotent. Supports `--dry-run`.
- `scripts/migrate-files.mts` — copy storage objects from Supabase Storage to Replit App Storage. Idempotent (skips by name+size). Supports `--dry-run`, `--problem <uuid>`, `--start N`, `--limit N`.

## Performance Optimizations (post-deployment)

- **PageTransition** (`src/components/layout/PageTransition.tsx`): reduced fade/slide duration 300ms → 120ms (4px slide). Eliminates the dominant perceived-lag on every nav.
- **ProblemsProvider** (`src/lib/problems-context.tsx`): shared in-memory cache for `/api/problems`, wired into `Providers.tsx` between `AuthProvider` and `PipelineProvider`. Consumers use `useProblems()` instead of their own fetch+useState+useEffect blocks. Consumer pages: `src/app/page.tsx` (Dashboard), `src/app/problems/page.tsx`, `src/app/admin/problems/page.tsx`.
  - Stale-while-revalidate semantics, in-flight dedupe via shared promise.
  - **Auth-transition safety**: every refresh captures a generation counter and an `AbortController`. On user identity change (`user.id` differs from cached id) the provider bumps the generation, aborts in-flight fetches, and clears the cache before refetching for the new user. This prevents a logged-out user's data from leaking into a subsequent session, and prevents stale responses from overwriting fresh state.
  - `removeLocally(id)` / `upsertLocally(problem)` mutators let pages update the cache optimistically (used by admin delete flow).
  - Polling on `/problems` (every 5s while a problem is processing) calls `refresh()` instead of issuing raw fetches, so it benefits from dedupe.
