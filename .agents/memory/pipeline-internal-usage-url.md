---
name: Pipeline internal usage/cost POST URL must be environment-aware
description: Why production cost rows silently never reached the prod DB, and the rule for resolving the internal API base URL the Python pipeline posts to.
---

# Pipeline cost recording — internal API base URL

The Python pipeline records each LLM call's cost by POSTing to the app's own
`/api/internal/llm-usage` endpoint. The base URL is injected as `INTERNAL_API_URL`
by `src/app/api/pipeline/run/route.ts` when it spawns Python.

**Rule:** the base URL MUST point at the *same* app instance that owns the current
request's database — in the deployment that's the deployment's own public origin
(`APP_URL`/`NEXT_PUBLIC_APP_URL`, or first of `REPLIT_DOMAINS`); in dev it's
`https://$REPLIT_DEV_DOMAIN`. Gate on `REPLIT_DEPLOYMENT` (unset in dev, set in the
deployment).

**Why:** Production cost history never updated (prod `llm_usage` frozen for ~2 months
while dev grew daily). Cause: in the deployment the base fell back to
`http://127.0.0.1:5000` / the dev domain, which return a **404 HTML page**, so
`usage_tracker.py` logged `internal insert failed (404): <!DOCTYPE html>` and
degraded every row to **"local only"** (ephemeral file) — nothing reached the prod
DB. The failure is silent by design (local-JSON backup), so it hid for months.

**How to apply:**
- Do NOT just prefer `APP_URL` everywhere — in the dev workspace `APP_URL` may point
  at the production origin, so dev runs would write into the prod DB. Keep the
  dev/deployment split.
- Replit **dev and production use separate Postgres databases** (different
  `DATABASE_URL`). Data written in dev never appears in prod and vice-versa. Verify
  prod data with `executeSql({ environment: "production" })` (read-only).
- To diagnose prod pipeline issues, query prod `pipeline_logs` (column is `content`,
  not `message`) and `pipeline_runs`; Python stdout is NOT in deployment logs.
- A spawn-time `console.log` of the resolved base URL (no secret) makes this
  verifiable from deployment logs.
