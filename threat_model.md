# Threat Model

## Project Overview

This project is a public-facing Next.js 16 application for creating, processing, and managing coding problems through a Python pipeline. It uses a custom database-backed session-cookie auth system, Replit Postgres for application state, and Replit App Storage for problem inputs/outputs/logs. Production-sensitive behavior lives primarily in API routes under `src/app/api/**` and the pipeline bridge that spawns Python scripts.

Production assumptions for future scans:
- `NODE_ENV` is `production` in deployed environments.
- Replit terminates TLS for the public deployment.
- The mockup sandbox and generated artifacts under transient workspace paths are not production attack surface unless separately exposed.
- Because the deployment visibility is public, unauthenticated endpoints should be treated as reachable from the public internet.

## Assets

- **User accounts and session tokens** — email addresses, bcrypt password hashes, reset tokens, and session cookies. Compromise allows impersonation and privileged access.
- **Authorization state** — profile role and status (`admin`, `problem_setter`, `active`, `pending_approval`, `deactivated`, `left`). Incorrect enforcement can let blocked users continue operating.
- **Problem content and generated outputs** — uploaded problem statements, solutions, intermediate pipeline outputs, logs, and packaged deliverables. These may contain proprietary content and user-generated code.
- **Administrative data and controls** — user management, usage reports, deletion flows, and reset-link minting. Abuse would allow account takeover, data deletion, or privacy breaches.
- **Internal service secrets** — `CRON_SECRET`, `ADMIN_SECRET_KEY`, `DATABASE_URL`, object-storage credentials, and external API keys. Exposure or misuse can compromise internal-only boundaries.
- **Security telemetry** — audit logs, rate-limit state, and LLM usage records. If these can be forged or polluted, incident response and abuse detection become unreliable.

## Trust Boundaries

- **Browser to API** — all client requests are untrusted and must be authenticated, authorized, validated, and bounded server-side.
- **Authenticated user to admin user** — admin-only APIs and pages must enforce role checks on the server, never just in the client.
- **Active user to inactive user** — `pending_approval`, `deactivated`, and `left` accounts must not retain access to protected production capabilities simply because their session cookie is still valid.
- **Problem owner to non-owner** — every problem-scoped file, log, state, and pipeline action must be bound to the owning user or an admin.
- **App server to Postgres** — application code has broad database powers; injection or unauthenticated mutation routes can directly impact integrity.
- **App server to object storage** — storage keys and prefixes must be derived from validated identifiers to prevent cross-tenant file access.
- **App server to Python pipeline** — user-selected pipeline steps cross into subprocess execution and inherit internal secrets/environment variables.
- **Public routes to internal-only routes** — endpoints intended only for cron jobs or internal processes must authenticate requests with strong server-side controls.
- **Reverse proxy metadata to application logic** — forwarded-IP and similar proxy headers are only trustworthy when parsed according to the deployment proxy's semantics; raw header values from the request must not become authentication, rate-limit, or audit-log truth without validation.

## Scan Anchors

- **Production entry points:** `src/app/api/**/route.ts`, `src/proxy.ts`, authenticated pages under `src/app/**`.
- **Highest-risk code areas:** `src/lib/auth/*`, `src/app/api/admin/**`, `src/app/api/problems/**`, `src/app/api/files/**`, `src/app/api/pipeline/**`, `src/app/api/internal/llm-usage/route.ts`, `src/app/api/auth/audit/route.ts`.
- **Public surfaces:** auth routes, signup/admin-secret verification, password reset request, any route reachable without `requireAuthApi` / `requireAdminApi`.
- **Authenticated surfaces:** problem CRUD, file upload/read/save/download, pipeline state/run/log/status/stop.
- **Admin surfaces:** `src/app/api/admin/**`, `/admin/**`, admin reset-link minting.
- **Usually dev-only / low-priority:** generated pipeline artifacts under `pipeline/problems/**`, historical migration tooling, workspace-only files, unless evidence shows production reachability.

## Threat Categories

### Spoofing

The application relies on long-lived session cookies plus database session lookup. Every protected API route must validate the session server-side, and privileged transitions must not trust client-side gating. Internal-only endpoints must authenticate callers with secrets that are never exposed to browsers.

Required guarantees:
- Protected APIs MUST require a valid session token.
- Admin APIs MUST require a server-side admin-role check.
- Internal-only endpoints MUST verify an internal secret or equivalent server-to-server authentication.
- IP-based security controls MUST derive the client identity from a trusted proxy boundary, not from unverified forwarded-header values chosen by the requester.

### Tampering

Users can upload files, edit outputs, trigger pipeline steps, and mutate problem state. The system must prevent attackers from modifying other users' problems, forging internal records, or causing unauthorized state changes through untrusted inputs.

Required guarantees:
- Problem-scoped mutations MUST verify ownership or admin access on the server.
- File paths, problem IDs, and subprocess arguments MUST be allowlisted or strictly validated before use.
- Unauthenticated callers MUST NOT be able to write security-relevant database records such as audit logs or internal accounting data.
- Pipeline steps MUST NOT execute user-controlled or LLM-generated code on the application host with inherited deployment secrets unless that execution is strongly sandboxed and intentionally isolated from production credentials.

### Information Disclosure

Problem inputs/outputs/logs, usage data, reset links, and admin reports can expose sensitive user or business data. The main risk is broken object-level authorization across problem resources or admin endpoints, along with accidental leakage through logs or overly broad responses.

Required guarantees:
- Problem files, logs, and runs MUST be readable only by the owning user or an admin.
- Admin-only datasets MUST NOT be exposed through client-only checks.
- Password reset flows MUST build links from trusted configuration rather than request-controlled headers.

### Denial of Service

Public auth and pipeline-adjacent routes can be abused to consume CPU, storage, email quota, or database space. Because the deployment is public, rate limits and body-size limits materially affect exploitability.

Required guarantees:
- Public endpoints MUST enforce rate limits or bounded work where repeated requests can consume shared resources.
- Upload and pipeline-trigger inputs MUST have strict size and shape limits.
- Long-running subprocesses MUST have timeouts and owner/admin-controlled stop paths.

### Elevation of Privilege

The most important privilege boundaries are admin vs. non-admin, owner vs. non-owner, and active vs. inactive account states. A valid session alone is not sufficient authorization if an account has been deactivated or is awaiting approval.

Required guarantees:
- Routes that represent authenticated application capabilities MUST enforce both authentication and allowed account status, not just the existence of a session.
- Ownership checks MUST be applied consistently across problem metadata, files, logs, runs, and deletion flows.
- Admin bootstrap flows MUST not be practically brute-forceable and MUST remain server-side enforced.
