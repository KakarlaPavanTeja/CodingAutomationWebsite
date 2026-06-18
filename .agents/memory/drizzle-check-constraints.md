---
name: drizzle-kit does not diff CHECK constraints
description: Why changing a Drizzle `check()` and running db:push silently leaves the old constraint in the DB
---

`drizzle-kit push` (this repo: `npm run db:push`, `--force`) does NOT diff or apply
changes to `check()` constraints. Editing a constraint expression in
`src/lib/db/schema.ts` and running db:push reports "Changes applied" but the old
CHECK is still live in Postgres.

**Why:** drizzle-kit's introspection/diff does not track CHECK constraint
expressions, so altering one is a no-op through the normal push flow.

**How to apply:** after editing any `check()` in the schema, apply it manually:
`ALTER TABLE <t> DROP CONSTRAINT <name>; ALTER TABLE <t> ADD CONSTRAINT <name> CHECK (...);`
then verify with `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='<name>'`.
The same will be needed on the production DB at deploy time (dev/prod DBs are separate).
