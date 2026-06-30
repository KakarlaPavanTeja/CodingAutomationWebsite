<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- Everything below is hand-maintained project guidance. Keep it OUTSIDE the
     nextjs-agent-rules markers above — that block is managed by tooling and
     will be overwritten. -->

# Project: Coding Automation Website

A Next.js 16 / React 19 app that runs a multi-step "CP-prep" content pipeline
(competitive-programming problem preparation) with auth, file storage, admin,
and LLM-usage tracking. The heavy lifting is a Python pipeline driven from the
Next.js API layer.

## Stack

- **Next.js 16.2.3** (App Router) + **React 19.2.4**, TypeScript strict.
- **Tailwind CSS 3.4** + shadcn / `@base-ui/react`; `lucide-react` icons.
- **Drizzle ORM** over **Postgres** (`postgres` driver).
- **Python 3** pipeline under `pipeline/` (deps in `pipeline/requirements.txt`).
- **GCS** (`@google-cloud/storage`) for object storage; **Uppy** for uploads.
- **Resend** for email; **OpenRouter** + Anthropic for LLM calls.

## Next.js 16 gotchas (verify in the bundled docs before relying on memory)

- Routing/middleware uses **`src/proxy.ts`**, NOT `middleware.ts`.
- API route handlers receive **`params` as a Promise**:
  `{ params: Promise<{ id: string }> }` — `await` it.
- **`cookies()` and `headers()` are async** — `await` them.

## Commands

- `npm run dev` — dev server on **port 5001** (`-H 0.0.0.0`).
- `npm run build` / `npm run start` — prod build / serve (also port 5001).
- `npm run lint` — ESLint (flat config, `eslint.config.mjs`).
- `npm run db:push` — push Drizzle schema to the DB (**`--force`** — be careful).
- `npm run db:studio` — Drizzle Studio.
- `npm run db` — `tsx scripts/db.mts` (DB helper script).
- `npm run test:json` — Python unittest for pipeline JSON prep.

There is currently **no JS/TS test runner** — only the Python `test:json` suite.

## Layout

- `src/app/` — App Router. UI routes (`admin`, `pipeline`, `problems`,
  `outputs`, `login`, `signup`, `settings`, …) and `src/app/api/*` route handlers
  (`auth`, `pipeline`, `files`, `problems`, `admin`, `internal`, `cp-prep`).
- `src/components/` — feature-grouped components (`pipeline`, `problems`,
  `files`, `auth`, `markdown`, `layout`, `ui`).
- `src/lib/` — domain logic. Notable: `db/` (schema, queries), `auth/`
  (`session`, `service`, `passwords`, `ownership`, `server`), `cp-prep/`
  (Python runner + prompts + parsing), and many `pipeline-*.ts` helpers.
- `src/types/` — shared types.
- `pipeline/` — Python pipeline: `Scripts/` (logic + tests), `Inputs/`,
  `Outputs/`, `problems/`, `zReferenceFiles/`.
- `scripts/` — `db.mts`, `post-merge.sh`.
- `drizzle/` — generated migration output (schema source: `src/lib/db/schema.ts`).

## Conventions

- Import alias: **`@/*` → `./src/*`**. Use it instead of long relative paths.
- DB schema is the source of truth at `src/lib/db/schema.ts`; change it there,
  then `db:push`. Don't hand-edit `drizzle/` output.
- Auth lives in `src/lib/auth/*`; `next.config.ts` enables
  `experimental.authInterrupts`. Reuse session/ownership helpers — don't
  re-implement auth checks in route handlers.
- Security headers (X-Frame-Options, HSTS, etc.) are set in
  `next.config.ts headers()`. Keep them when editing that file.
- Passwords hashed with `bcryptjs`. Never log secrets, tokens, or raw passwords.
- LLM usage is recorded (`record-llm-usage.ts`, `openrouter.ts`,
  `cp-prep/anthropic-usage.ts`) — preserve usage tracking when touching LLM paths.
- This app runs on Replit (`REPLIT_*` env in `next.config.ts allowedDevOrigins`).

## Before you code

Re-read the Next.js 16 guide for whatever you're touching (see the boxed rule
above) — App Router, route handlers, and config conventions differ from older
versions. When changing the Python pipeline, run `npm run test:json`.
