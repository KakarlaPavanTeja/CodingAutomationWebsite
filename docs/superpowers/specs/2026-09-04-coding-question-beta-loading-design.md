# Coding question → beta loading (design)

Date: 2026-09-04
Status: approved, not yet implemented

## Purpose

Let the team put a prepared coding question into the NKB **beta** environment for
testing, from this platform, without opening the separate Loadings app.

Two entry points, one engine:

1. **After a pipeline run** — a button on the problem's Outputs tab. Never automatic.
2. **A new upload page** — drop in a `coding_questions.json` or a regenerator zip.

Loading is always a deliberate human action. There is no hook, cron, or
pipeline step that triggers it.

## What already exists

`src/lib/loadings/` is a working port of the Loadings app's coding-question
flow, verified end to end against live beta on 2026-09-03/04:

- `coding-questions-json.ts` — parse, normalise, stamp ids/order, build the zip
- `practice-set-db.ts` — the registry sheet of testing `question_set_id`s
- `question-set.ts` — how full a set is, via the beta Django admin changelist
- `nkb.ts` — S3 upload + NKB task create/poll
- `google-sheets.ts`, `django-admin.ts`, `config.ts`
- `load-coding-questions.ts` — the orchestrator

Proven: a question loaded into set `9339f11e…` at order 25 (set went 24 → 25).

Two hard-won constraints, both already encoded and covered by tests:

- The zip's link file **must** be `question_sets_questions.json` (plural) for
  `JSON_LOADING`. With the singular name the backend links nothing **and still
  reports SUCCESS**. The new-unit `SHEET_LOADING` zip uses the singular name.
- A finished NKB task does not mean the content landed. `loadCodingQuestions`
  re-queries the set afterwards and only reports success once the questions are
  actually linked.

## Current routing (unchanged)

For each load the planner walks the registry sheet and picks the first set with
room under 50:

- set already has questions → `JSON_LOADING` (append; no sheet, no unit)
- set is empty → `SHEET_LOADING` + unlock (creates the unit)

Batches larger than the remaining room are split across sets so none exceeds 50.

## 1. Data

One new table, mirroring the existing `pipeline_runs` shape.

```
coding_question_loads
  id             uuid pk
  problemId      uuid null   -> problems.id (null for uploads)
  userId         uuid        -> profiles.id
  source         text        'pipeline' | 'upload'
  questionSetId  text
  questionIds    text[]
  status         text        'running' | 'completed' | 'failed'
  taskOutputUrl  text null
  error          text null
  remarks        text null   reason given when forcing a reload
  logs           text null   accumulated stream
  startedAt      timestamptz
  finishedAt     timestamptz null
```

Why store it rather than ask beta each time: double-load detection needs to be
instant (asking beta costs an admin search per question); logs must outlive the
request; and beta is shared, so who-loaded-what matters.

Schema goes in `src/lib/db/schema.ts`, then `npm run db:push`.

## 2. Shared engine

Both surfaces POST to one endpoint. They differ only in where the JSON comes
from — object storage (`<problemId>/outputs/forJSONPreparation/coding_questions.json`)
or the uploaded file. Uploads accept either a raw `.json` or a `.zip`
containing `coding_questions.json` (as the UUID regenerator emits); the zip's
own link file is ignored, since the planner decides the set and order.

`src/lib/loadings/` is reused as-is.

## 3. Auto-rollover when every set is full

Today nine of ten registry sets are full and the tenth is at 25/50 — roughly 25
single-question loads of runway. When the last one fills, the system creates the
next testing unit by itself:

1. Fetch the units under the testing parent (`GET_UNIT_RESOURCE_DETAILS`)
2. `childOrder = max(unit_order) + 1`; `title = "Coding Testing <n+1>"`;
   `autoUnlock = TRUE`
3. Mint `question_set_id` + `commonUnitId`
4. Sheet prep → `SHEET_LOADING` → unlock
5. Append the new set id to the registry sheet

No human input at any step.

**Discovery required before building this:** the parent resource id that the
existing "Coding Testing 1–9" units hang off. It becomes an env var
(`NKB_TESTING_PARENT_RESOURCE`). If those units turn out to have no common
parent, this section needs redesign — stop and raise it.

This is the only part of the design that is not yet proven against beta.

## 4. Progress logs

Follows the pattern the pipeline actually uses — **not** SSE. (`src/lib/use-sse.ts`
exists but is dead code; nothing imports it. `/api/pipeline/run` returns JSON and
the UI polls `/api/pipeline/run/logs` for output.)

- `POST` starts the load in the background and returns the row id immediately.
- Each phase appends a line to the row's `logs` column.
- The UI polls `GET /api/loadings/coding-questions/<id>` every 2s for
  `status` + `logs`, and stops when status leaves `running`.

Closing the tab loses nothing: the row keeps the full log.

Phases logged: `plan → zip → upload → task → verify`, and for a rollover
`plan → create unit → sheet → load → unlock → verify`.

## 5. Duplicate handling

When a completed row already exists for this problem, show:

> Loaded 2026-09-04 into set `9339f11e…` at order 25 — `learning-beta.earlywave.in/question/<id>`

with the load button disabled. Reloading requires typing **remarks** (why), then
confirming *"Load anyway — all ids will be regenerated"*. That regenerates every
UUID in the payload so the backend sees a genuinely new question, avoiding the
duplicate-id failure. The remarks are stored on the new row.

## 6. Surfaces

**Problem Outputs tab** — extend the existing `LoadToBeta` component. Visible
only when the pipeline has completed and `coding_questions.json` exists. Shows
prior-load state, the log stream, and the result.

**`/load-coding-question`** — new page. File picker (JSON or zip), the same form
fields, the same log stream. `source: 'upload'`, no `problemId`.

## 7. Testing

Node's built-in runner (`npm run test:ts`), beside the code, per repo
convention:

- rollover child-order derivation (max + 1, empty parent, non-numeric orders)
- duplicate gating: blocked without remarks, allowed with
- id regeneration: every UUID replaced, identical ids stay consistent
- upload parsing: raw JSON, wrapper object, zip
- the existing link-filename test stays — it guards a silent failure mode

No live beta loads during development. The single throwaway load needed to prove
rollover gets explicit approval first.

## Out of scope

- Loading to **prod** (beta only)
- Placing test content anywhere in the real course tree beyond the testing units
- Backfilling load history for questions loaded before this table existed
