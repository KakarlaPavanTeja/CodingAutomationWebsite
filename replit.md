# Coding Automation Website

Next.js 16 application being migrated off Supabase to Replit-hosted infrastructure.

## Architecture

- **Framework**: Next.js 16 (App Router) on port 5000, host 0.0.0.0
- **Workflow**: `Start application` runs `npm run dev`
- **Database** (in progress): migrating from Supabase Postgres → Replit Postgres (`DATABASE_URL`)
- **ORM**: Drizzle ORM (`src/lib/db/schema.ts`, `src/lib/db/index.ts`); use `npm run db:push` to sync schema
- **Auth** (planned): migrating from Supabase Auth → custom Auth.js v5 with Credentials provider (bcrypt) and DB-backed sessions
- **File Storage** (planned): migrating from Supabase Storage → Replit App Storage

## Database Tables (Replit Postgres)

Application tables (mirrored from Supabase):
- `profiles`, `problems`, `pipeline_runs`, `pipeline_states`, `pipeline_logs`, `llm_usage`, `auth_audit_log`, `rate_limits`

New auth tables (added for Auth.js):
- `users` — email + password_hash + email_verified_at + password_reset_required (true for users migrated from Supabase, since bcrypt hashes can't be transferred)
- `sessions` — DB-backed session store
- `password_reset_tokens` — for password reset flow

`profiles.id` references `users.id` (FK with cascade delete), preserving the Supabase 1:1 pattern.

## Migration Status

- [x] Phase 1: Schema dumped from Supabase (`migrations/0001_supabase_schema.sql`)
- [x] Phase 2: Drizzle schema + tables created in Replit Postgres
- [x] Phase 3: All `supabase.from(...)` DB queries refactored to Drizzle (lib helpers, all API routes, client pages now use API endpoints). Supabase auth (`supabase.auth.*`) still in use — Phase 5 swaps it. Service client retained only for Storage operations until Phase 4.
- [ ] Phase 4: Replace Supabase Storage → Replit App Storage
- [ ] Phase 5: Build Auth.js (login, signup, sessions, reset, admin approval)
- [ ] Phase 6: Migrate data rows from Supabase to Replit
- [ ] Phase 7: Migrate uploaded files
- [ ] Phase 8: Cleanup, remove `@supabase/*` packages, smoke test

## Important Notes

- Original Supabase RLS policies are NOT replicated — access control is enforced in app code via existing `requireAdminApi()` and similar guards.
- The `handle_new_user` Supabase trigger is replaced by an Auth.js callback that inserts into `profiles` on signup.
- `extensions.uuid_generate_v4()` is replaced by Postgres-native `gen_random_uuid()`.
- Session plan: `.local/session_plan.md`
