---
name: .replit userenv stores secrets in plaintext (git-committed)
description: Why secrets must never live in [userenv] in .replit, and the correct rotation procedure when one leaks.
---

# .replit [userenv] is committed plaintext — never put secrets there

Values under `[userenv.shared]` / `[userenv.development]` / `[userenv.production]` in
`.replit` are stored **in the file**, which is tracked in git. Anything there is a
plaintext credential leak the moment it is committed/pushed.

**Why this matters for rotation:** a `[userenv]` var and a managed Secret can have the
**same name** simultaneously (e.g. `CRON_SECRET` was in both). The committed `.replit`
value shadows/coexists with the managed Secret, so **rotating only the managed Secret
does NOT take effect** while the plaintext copy is still in `.replit`. Both the live
production deployment and dev keep using the old leaked value until the `.replit` copy
is removed AND a redeploy happens.

**How to apply (rotation procedure when a userenv secret leaks):**
1. `.replit` cannot be edited directly (tool rejects it). Manage its env vars via the
   environment-secrets tooling: `setEnvVars` / `deleteEnvVars` (these own `[userenv]`).
2. Order to avoid a no-value window: first have the user set a FRESH value as a managed
   Secret (`requestEnvVar` — agent cannot set secret values directly), THEN
   `deleteEnvVars({keys:[NAME], environment:"shared"})` to drop the plaintext copy.
3. Restart the workflow so the running process drops the old shared var and picks up the
   managed Secret. Verify: `viewEnvVars` should show `envVars: {}` and `secrets: {NAME:true}`.
4. Smoke-test against `http://localhost:<port>` (the public `$REPLIT_DEV_DOMAIN` needs an
   `https://` scheme or curl returns `000`). A wrong/missing internal secret must 401.
5. **Production only updates on redeploy** — the live deployment was built from a snapshot
   whose `.replit` still had the plaintext value, so Publish is required to neutralize prod.
6. Rotation is transparent only if sender + validator both read the SAME `process.env` var
   (verify with grep before relying on it). Leaked value stays in git history — that needs
   a separate history scrub; rotation just makes the leaked value useless.
