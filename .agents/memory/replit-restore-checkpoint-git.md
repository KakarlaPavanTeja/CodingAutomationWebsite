---
name: Replit restore-checkpoint vs git "ahead"
description: Why a branch ahead of origin/main can still contain OLDER code on Replit, and how to diagnose.
---

# Replit "Restored to <sha>" checkpoints invert the meaning of "ahead of origin"

A Replit checkpoint **rollback/restore** ("Restored to <sha>") is recorded as a normal
commit on `main` whose *tree* equals the old snapshot. Subsequent work stacks on top of
that reverted base. Result: `git status` shows `main` **ahead of origin/main by N commits**,
but the working tree actually contains the **OLDER** code — the branch is graph-ahead yet
content-behind.

**Why:** commit count / "ahead" only measures graph position, not content recency. A
restore commit moves the content backward while still advancing the graph.

**How to diagnose (don't trust "ahead"):** compare *content*, not commit counts.
- `git diff --stat origin/main HEAD` — large **deletions** on the HEAD side = HEAD is the
  regressed/older tree (it's missing code that origin/main has).
- `git diff --stat <oldsha> HEAD` returning empty = HEAD is byte-identical to the old snapshot.
- `git reflog` reveals the `reset: moving to <restore-sha>` ("Restored to …") that caused it.

**Fix when the user wants dev on the genuine latest:** `git reset --hard origin/main`
(origin/main is usually the real latest full-featured tip). Verify the editorial/feature work
survives by checking it's an ancestor of origin/main before resetting. Local-only commits made
after the restore (e.g. sample problem inputs) are dropped but recoverable via reflog / cherry-pick.

**Deploy interaction:** Replit "Republish" bundles the *current workspace tree* at publish time.
To roll prod back to an old build without a UI rollback button, you can `git checkout <oldsha>`
(detached), Republish, then `git checkout main` — but the republish/checkpoint process may
commit the old tree onto `main`, so re-verify `main`'s tip afterward and reset if needed.
This is the only way to make prod=old while dev=new; there is no code trick that changes prod
without temporarily changing the workspace tree.
