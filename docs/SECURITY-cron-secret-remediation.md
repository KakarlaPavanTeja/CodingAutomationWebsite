# CRON_SECRET leak — remediation runbook

**Status:** working-tree removal done (branch `security/remove-committed-cron-secret`, commit `068799e`). Rotation + history scrub are **manual** steps below.

## What leaked
`CRON_SECRET` was hardcoded in tracked `.replit` (`[userenv.shared]`), introduced in commit `7f8513e`. It is the `X-Internal-Secret` that authorizes:
- `POST /api/internal/llm-usage` (pipeline → usage/cost bridge)
- `/api/admin/cleanup` (cron gate)
- passed to the spawned Python as `INTERNAL_API_SECRET` (`run/route.ts:350`)

Anyone with repo or git-history access could forge authenticated internal requests.

## Order of operations (do NOT reorder)
1. **Rotate first** — this is what actually neutralizes the leak. Everything below is cleanup.
2. Confirm the app works on the new secret.
3. Scrub history (optional but recommended; destructive).

---

## 1. Rotate (neutralizes the leak)
```sh
# generate locally — do NOT paste the value into any committed file
openssl rand -hex 32
```
- Set the new value as the **managed Secret** `CRON_SECRET` in Replit's Secrets pane.
- Redeploy / restart. The Next app and the per-run Python child both read `process.env.CRON_SECRET`, so they stay in sync automatically.
- **Verify:** run any LLM-using pipeline step → usage rows land, no `internal insert failed (401)` in logs.

Once rotated, the old value in history authorizes nothing. The scrub below is hygiene.

---

## 2. Scrub history (destructive — rewrites every commit hash)

**Prerequisites / warnings**
- Rotate FIRST (step 1). Don't rely on the scrub as the security control — caches/forks/clones may retain the old blob.
- This rewrites history → **force-push** → every collaborator must re-clone (or hard-reset). Coordinate first.
- Open PRs built on old hashes will need rebasing. GitHub may retain the value in cached PR views — contact GitHub Support to purge if needed.
- Take a backup branch/clone before starting.

**Preferred: git-filter-repo (`brew install git-filter-repo`)** — redacts the literal value everywhere without deleting `.replit`:
```sh
# fresh mirror clone to operate on
git clone --mirror <repo-url> repo-scrub.git
cd repo-scrub.git

# replacements file — put the ACTUAL leaked value on the left
printf '%s==>***REMOVED***\n' 'THE_OLD_LEAKED_VALUE' > ../replacements.txt

git filter-repo --replace-text ../replacements.txt

# filter-repo drops the remote on purpose; re-add and force-push everything
git remote add origin <repo-url>
git push --force --all
git push --force --tags
```

**Alternative: BFG Repo-Cleaner**
```sh
echo 'THE_OLD_LEAKED_VALUE' > secrets.txt
bfg --replace-text secrets.txt repo-scrub.git
cd repo-scrub.git && git reflog expire --expire=now --all && git gc --prune=now --aggressive
git push --force --all && git push --force --tags
```

**After the rewrite**
- Every clone is now stale. Each collaborator: re-clone, or `git fetch && git reset --hard origin/<branch>`.
- Delete the local backup once verified.
- Re-run the secret scanner to confirm 0 findings for `CRON_SECRET`.

---

## Residual / related (separate work)
- **Benchmark/harden subprocess env scrubbing** — `benchmark_suite.py`, `testcase_manager*.py` run LLM-generated Python; `harden_suite.py` / `benchmark_batch_runner.py` use `exec()`. Ensure these spawns inherit a scrubbed env (no secrets), matching the cp-prep mitigation. Highest-value code fix after the secret.
- **PII in logs** — `api/auth/reset-password/request/route.ts` logs the email address (HoundDog low). Drop it.
