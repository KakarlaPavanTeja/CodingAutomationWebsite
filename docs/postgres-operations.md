# Postgres operations

Constraints and hard-won lessons for this project's Aiven Postgres instance.
Read this before running anything in bulk against the database.

## Never store logs in Postgres

Pipeline logs live in object storage only:

- `{problemId}/logs/{stepId}.log` — the complete log, written on process exit
  (`uploadLog`).
- `{problemId}/logs/runs/{stepId}/{runId}.log` — a 256 KB tail published while
  the step runs (`syncLogToStorage`), replaced by the full log on exit.

Both are written by `src/lib/storage-sync.ts`. `getLogContent()` is the only
read path, and object storage is its only source.

This is not a preference. Two separate incidents came from log text in Postgres:

1. **`pipeline_logs.content`** — a TOASTed text column rewritten in full on
   every `PIPELINE_LOG_SYNC_MS` tick. The table reached 564 MB and the service
   had written 134 GB of WAL for a 79 MB database.
2. **`pipeline_states.step_configs`** — the pipeline UI persisted its whole
   in-memory run state, so `languageSubRuns[<lang>].logs` and
   `subStepRuns[<id>].logs` rode along into a jsonb blob rewritten on every
   autosave. 36 MB across 467 rows; the largest single row was 9.8 MB.

Both have the same shape: **a growing blob rewritten in place.** Postgres cannot
update a TOASTed value without writing a whole new copy and leaving the old one
dead, so the write amplification is enormous and autovacuum never caught up
(`last_autovacuum` was null on both tables).

`withoutRunLogs()` in `src/lib/pipeline-log-parse.ts` is what keeps case 2 from
coming back — it strips `logs` both when saving state and when restoring a row.
If you add a field to `SubStepRunState`, keep it small.

## On a full disk, DELETE and UPDATE make it worse

The 2026-08-12 outages took the service down **twice**, ~30 minutes each, from
cleanup work on these tables.

- `DELETE` and `UPDATE` write new row versions and WAL proportional to the data
  touched. Space only returns after `VACUUM FULL`, which itself needs free space.
- Removing a TOASTed row still has to delete every TOAST chunk and log it. A
  plain `DELETE` of 27 rows crashed the node (SQLSTATE 57P02).
- `TRUNCATE` / `DROP` are the **only** cleanup operations that reliably succeed —
  they unlink files and write a single small WAL record. `TRUNCATE pipeline_logs`
  freed 564 MB instantly (643 MB → 79 MB) after `DELETE` had failed twice.

**Batching and pacing do not help.** The constraint is capacity, not load. Check
`pg_database_size(current_database())` and confirm real free disk before starting.

Prefer, in order: `TRUNCATE` a table that is safe to empty → archive-to-storage
then `TRUNCATE` → paced `UPDATE` with verification, only with headroom to spare.

A table holding live state cannot be truncated. `pipeline_states` is the example:
it carries languages, testcase counts, step statuses and the owner title
alongside the bloat, so it had to be stripped row by row with
`scripts/strip-pipeline-state-logs.mts` — archive each log to storage, verify the
stored object, and only then rewrite the row.

## Other constraints

- `max_connections = 20`. `PG_POOL_MAX=3` in `.env.local` keeps one dev server to
  3 connections rather than 10. Other machines share the same database.
- `default_transaction_read_only` gets switched **on** by Aiven under disk
  pressure. It is a session-level GUC — `set default_transaction_read_only = off`
  on your own connection clears it without changing the database default. The
  maintenance scripts do this for themselves.
- Reading many multi-MB values in a loop pressures a small instance. Read one row
  at a time and pause between them.
- `pg_column_size()` returns `integer`. A bound larger than 2^31-1 in a query is
  rejected outright as out of range.

## Reclaiming space after a strip

`UPDATE` leaves the old row versions dead; the disk does not shrink until the
table is rewritten:

```sql
VACUUM FULL pipeline_states;
```

This takes an `ACCESS EXCLUSIVE` lock — nothing can read or write the table while
it runs. Seconds at this size, but it will blank the pipeline page for anyone
mid-run, so pick a quiet moment.
