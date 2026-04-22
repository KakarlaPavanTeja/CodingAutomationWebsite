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

## Migration Status — COMPLETE

- [x] **Phase 1** — Schema dumped from Supabase (`migrations/0001_supabase_schema.sql`)
- [x] **Phase 2** — Drizzle schema + tables created in Replit Postgres
- [x] **Phase 3** — All `supabase.from(...)` DB queries refactored to Drizzle
- [x] **Phase 4** — Replit App Storage adopted (`src/lib/object-storage.ts`, `storage-sync.ts`)
- [x] **Phase 5** — Custom bcrypt + session-cookie auth replacing Supabase Auth
- [x] **Phase 6** — Data row migration (5 users, 5 profiles, 28 problems, 26 pipeline_states, 141 pipeline_runs, 132 pipeline_logs, 326 llm_usage). See `scripts/migrate-data.mts`.
- [x] **Phase 7** — File migration: 1058 files / 329 MB across 35 problem folders + `shared/`. See `scripts/migrate-files.mts`. Verified 1:1 with source.
- [x] **Phase 8** — Cleanup: legacy `src/lib/supabase/` shims removed; nothing in `src/` references Supabase anymore.

## Migration Notes

- Imported users have `password_hash=NULL` and `password_reset_required=true`. Every existing user must complete the password-reset flow on first login. The reset-request endpoint logs the reset URL to the server console (no email service yet).
- Supabase Storage bucket name is preserved in `STORAGE_BUCKET` env (used only by the migration script). Object paths are identical between source and target so DB rows referencing storage paths still work unchanged.
- Original Supabase RLS policies are NOT replicated — access control is enforced in app code via `requireAuthApi()` / `requireAdminApi()` guards on every protected route.

## Outstanding Manual Cleanup (user action)

- Rotate the Supabase database password (since it was exposed via `SUPABASE_DB_URL` during the migration window).
- Delete these now-unused secrets: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `STORAGE_BUCKET`.
- Optionally pause / delete the Supabase project once you've confirmed the Replit copy is the system of record.
- `migrations/0001_supabase_schema.sql` is kept in the repo as a historical reference; safe to delete if you don't need it.

## One-off Scripts

- `scripts/migrate-data.mts` — copy DB rows from Supabase to Replit. Idempotent. Supports `--dry-run`.
- `scripts/migrate-files.mts` — copy storage objects from Supabase Storage to Replit App Storage. Idempotent (skips by name+size). Supports `--dry-run`, `--problem <uuid>`, `--start N`, `--limit N`.
