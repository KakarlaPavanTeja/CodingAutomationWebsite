# Coding Question → Beta Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person load a prepared coding question into NKB beta from this platform — from a problem's Outputs tab after the pipeline finishes, or from a new upload page — never automatically, with progress logs and a DB record.

**Architecture:** Reuse the existing, live-verified `src/lib/loadings/` engine. Add one DB table, one background-job endpoint that both surfaces POST to, a polled status/log endpoint, and automatic testing-unit creation when the registry's question sets fill up.

**Tech Stack:** Next.js 16 App Router, React 19, Drizzle ORM over Postgres, TypeScript strict, Node's built-in test runner (`npm run test:ts`).

**Spec:** `docs/superpowers/specs/2026-09-04-coding-question-beta-loading-design.md`

## Global Constraints

- Beta only. Never prod.
- Loading is never automatic — no pipeline hook, no cron, no auto-trigger.
- The `JSON_LOADING` zip's link file MUST be named `question_sets_questions.json` (plural). The singular name makes the backend link nothing while still reporting SUCCESS. `SHEET_LOADING` uses the singular name. Both already exist as `LINK_FILE_JSON_LOADING` / `LINK_FILE_SHEET_LOADING`.
- A finished NKB task does NOT mean content landed. Success requires re-querying the set and confirming the questions are linked (`confirmLinked` in `load-coding-questions.ts`).
- Next.js 16: route handler `params` is a Promise (`await` it); `cookies()`/`headers()` are async.
- Import alias `@/*` → `./src/*`.
- Auth: reuse `requireProblemManageAccess` / `requireProblemAccess` from `@/lib/auth/ownership`. Never re-implement auth checks.
- No live beta loads during development. Task 10 needs one and asks first.
- `npm run db:push` targets whatever `.env.local` points at, which is production. Use `DRIZZLE_DATABASE_URL=… npm run db:push` to target anything else.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/db/schema.ts` (modify) | Add `codingQuestionLoads` table |
| `src/lib/loadings/load-records.ts` (create) | DB reads/writes for load rows |
| `src/lib/loadings/regenerate-ids.ts` (create) | Deep UUID regeneration for forced reloads |
| `src/lib/loadings/upload-input.ts` (create) | Turn an uploaded JSON or zip into a question array |
| `src/lib/loadings/testing-unit.ts` (create) | Derive next child order + title; create the next testing unit |
| `src/lib/loadings/practice-set-db.ts` (modify) | Call `testing-unit` on rollover instead of minting a bare set |
| `src/lib/loadings/load-coding-questions.ts` (modify) | Accept an `onLog` callback so phases are recorded |
| `src/app/api/loadings/coding-questions/route.ts` (modify) | POST starts a background load, returns row id |
| `src/app/api/loadings/coding-questions/[id]/route.ts` (create) | GET status + logs for polling |
| `src/components/problems/LoadToBeta.tsx` (modify) | Prior-load state, remarks gate, log panel |
| `src/app/load-coding-question/page.tsx` (create) | Upload page |

---

### Task 1: Load-record table and helpers

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `src/lib/loadings/load-records.ts`
- Test: `src/lib/loadings/load-records.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `codingQuestionLoads` table; `createLoadRecord(args) => Promise<string>`, `appendLoadLog(id, line) => Promise<void>`, `finishLoadRecord(id, patch) => Promise<void>`, `getLoadRecord(id) => Promise<LoadRecord | null>`, `latestLoadForProblem(problemId) => Promise<LoadRecord | null>`, `formatLogLine(phase, message) => string`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { formatLogLine } from "./load-records";

test("formatLogLine prefixes an ISO timestamp and the phase", () => {
  const line = formatLogLine("plan", "reusing set 9339f11e at order 25");
  assert.match(line, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[plan\] reusing set 9339f11e at order 25$/);
});

test("formatLogLine keeps multi-line messages on one entry", () => {
  const line = formatLogLine("task", "line one\nline two");
  assert.ok(line.includes("line one line two"));
  assert.equal(line.split("\n").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/load-records.test.ts`
Expected: FAIL — cannot find module `./load-records`

- [ ] **Step 3: Add the table to the schema**

In `src/lib/db/schema.ts`, after `pipelineRuns`:

```ts
export const codingQuestionLoads = pgTable(
  "coding_question_loads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for uploads: an uploaded JSON has no problem behind it.
    problemId: uuid("problem_id").references(() => problems.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => profiles.id),
    source: text("source").notNull(),
    questionSetId: text("question_set_id"),
    questionIds: text("question_ids").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("running"),
    taskOutputUrl: text("task_output_url"),
    error: text("error"),
    remarks: text("remarks"),
    logs: text("logs").notNull().default(""),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    statusCheck: check(
      "coding_question_loads_status_check",
      sql`${t.status} IN ('running','completed','failed')`,
    ),
    sourceCheck: check(
      "coding_question_loads_source_check",
      sql`${t.source} IN ('pipeline','upload')`,
    ),
  }),
);
```

- [ ] **Step 4: Write the helpers**

Create `src/lib/loadings/load-records.ts`:

```ts
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { codingQuestionLoads } from "@/lib/db/schema";

export type LoadSource = "pipeline" | "upload";

export interface LoadRecord {
  id: string;
  problemId: string | null;
  status: string;
  questionSetId: string | null;
  questionIds: string[];
  taskOutputUrl: string | null;
  error: string | null;
  remarks: string | null;
  logs: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** One log entry: timestamped and single-line, so the column stays greppable. */
export function formatLogLine(phase: string, message: string): string {
  const flat = String(message).replace(/\s*\n\s*/g, " ").trim();
  return `[${new Date().toISOString()}] [${phase}] ${flat}`;
}

export async function createLoadRecord(args: {
  problemId: string | null;
  userId: string;
  source: LoadSource;
  remarks?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(codingQuestionLoads)
    .values({
      problemId: args.problemId,
      userId: args.userId,
      source: args.source,
      remarks: args.remarks ?? null,
    })
    .returning({ id: codingQuestionLoads.id });
  return row.id;
}

/** Append rather than overwrite, so concurrent phase writes cannot lose lines. */
export async function appendLoadLog(id: string, line: string): Promise<void> {
  await db
    .update(codingQuestionLoads)
    .set({ logs: sql`${codingQuestionLoads.logs} || ${line + "\n"}` })
    .where(eq(codingQuestionLoads.id, id));
}

export async function finishLoadRecord(
  id: string,
  patch: {
    status: "completed" | "failed";
    questionSetId?: string | null;
    questionIds?: string[];
    taskOutputUrl?: string | null;
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(codingQuestionLoads)
    .set({ ...patch, finishedAt: new Date() })
    .where(eq(codingQuestionLoads.id, id));
}

export async function getLoadRecord(id: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(eq(codingQuestionLoads.id, id))
    .limit(1);
  return (row as LoadRecord) ?? null;
}

/** Most recent completed load for a problem — drives the duplicate warning. */
export async function latestLoadForProblem(problemId: string): Promise<LoadRecord | null> {
  const [row] = await db
    .select()
    .from(codingQuestionLoads)
    .where(
      and(
        eq(codingQuestionLoads.problemId, problemId),
        eq(codingQuestionLoads.status, "completed"),
      ),
    )
    .orderBy(desc(codingQuestionLoads.startedAt))
    .limit(1);
  return (row as LoadRecord) ?? null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/load-records.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Push the schema**

Run: `npm run db:push`
Expected: creates `coding_question_loads`. Confirm via `npm run db:studio`, or re-run push and see no pending change.

- [ ] **Step 7: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/lib/db/schema.ts src/lib/loadings/load-records.ts src/lib/loadings/load-records.test.ts
git commit -m "feat(loadings): record coding question loads in the database"
```

---

### Task 2: Deep id regeneration

**Files:**
- Create: `src/lib/loadings/regenerate-ids.ts`
- Test: `src/lib/loadings/regenerate-ids.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `regenerateQuestionIds<T>(value: T) => T`

Forced reloads need every UUID replaced so the backend sees a new question rather than a duplicate-key conflict. Identical ids must map to the same new id so internal references stay coherent.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { regenerateQuestionIds } from "./regenerate-ids";

const A = "0a2ef131-fab4-4fa9-96a9-ea458cd9163f";
const B = "7c22d78b-fa1a-4279-b16e-7a1f1cae49f1";

test("replaces every uuid and keeps non-uuid values untouched", () => {
  const out = regenerateQuestionIds([
    { question: { question_id: A, short_text: "Keep me" }, test_cases: [{ id: B, weightage: 0.83 }] },
  ]);
  const q = out[0].question as Record<string, unknown>;
  const tc = (out[0].test_cases as Record<string, unknown>[])[0];
  assert.notEqual(q.question_id, A);
  assert.notEqual(tc.id, B);
  assert.equal(q.short_text, "Keep me");
  assert.equal(tc.weightage, 0.83);
});

test("maps repeated ids consistently", () => {
  const out = regenerateQuestionIds([{ a: A, b: A, c: B }]) as Record<string, string>[];
  assert.equal(out[0].a, out[0].b);
  assert.notEqual(out[0].a, out[0].c);
});

test("leaves strings that merely look id-ish alone", () => {
  const out = regenerateQuestionIds([{ note: "not-a-uuid", n: 5, ok: true, nil: null }]);
  assert.deepEqual(out[0], { note: "not-a-uuid", n: 5, ok: true, nil: null });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/regenerate-ids.test.ts`
Expected: FAIL — cannot find module `./regenerate-ids`

- [ ] **Step 3: Implement**

```ts
import { randomUUID } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Replace every UUID with a fresh one, keeping identical ids consistent, so a
 * reload creates a genuinely new question instead of colliding with the
 * already-loaded one.
 */
export function regenerateQuestionIds<T>(value: T, map = new Map<string, string>()): T {
  if (typeof value === "string" && UUID_RE.test(value)) {
    if (!map.has(value)) map.set(value, randomUUID());
    return map.get(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => regenerateQuestionIds(v, map)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = regenerateQuestionIds(v, map);
    return out as T;
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/regenerate-ids.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/regenerate-ids.ts src/lib/loadings/regenerate-ids.test.ts
git commit -m "feat(loadings): regenerate ids for forced reloads"
```

---

### Task 3: Upload input parsing (JSON or zip)

**Files:**
- Create: `src/lib/loadings/upload-input.ts`
- Test: `src/lib/loadings/upload-input.test.ts`

**Interfaces:**
- Consumes: `parseCodingQuestionsPayload`, `CodingQuestionRow` from `./coding-questions-json`
- Produces: `extractQuestionsFromUpload(buffer: Buffer, filename: string) => Promise<CodingQuestionRow[]>`

The regenerator emits a zip holding `coding_questions.json` plus a link file. Take the questions; ignore the zip's link file, because the planner decides the set and order.

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import archiver from "archiver";
import { PassThrough } from "stream";
import { extractQuestionsFromUpload } from "./upload-input";

async function zipOf(entries: Record<string, string>): Promise<Buffer> {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res, rej) => {
    sink.on("end", () => res());
    sink.on("error", rej);
    archive.on("error", rej);
  });
  archive.pipe(sink);
  for (const [name, body] of Object.entries(entries)) archive.append(body, { name });
  await archive.finalize();
  await done;
  return Buffer.concat(chunks);
}

test("reads a raw json array", async () => {
  const buf = Buffer.from(JSON.stringify([{ question_id: "q1" }]), "utf8");
  const out = await extractQuestionsFromUpload(buf, "coding_questions.json");
  assert.equal(out.length, 1);
});

test("reads a wrapper object", async () => {
  const buf = Buffer.from(JSON.stringify({ coding_questions: [{ question_id: "q1" }] }), "utf8");
  const out = await extractQuestionsFromUpload(buf, "anything.json");
  assert.equal(out.length, 1);
});

test("reads coding_questions.json out of a zip and ignores the link file", async () => {
  const buf = await zipOf({
    "coding_questions.json": JSON.stringify([{ question_id: "q1" }, { question_id: "q2" }]),
    "question_sets_questions.json": JSON.stringify([{ question_set_id: "s", question_id: "q1", order: 1 }]),
  });
  const out = await extractQuestionsFromUpload(buf, "regen.zip");
  assert.equal(out.length, 2);
});

test("rejects a zip with no coding_questions.json", async () => {
  const buf = await zipOf({ "readme.txt": "nothing here" });
  await assert.rejects(() => extractQuestionsFromUpload(buf, "x.zip"), /coding_questions\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/upload-input.test.ts`
Expected: FAIL — cannot find module `./upload-input`

- [ ] **Step 3: Implement**

No zip-reading dependency exists (`archiver` is write-only), and the archives here are flat two-file ones, so parse local file headers directly rather than adding a package.

```ts
import { inflateRawSync } from "zlib";
import { parseCodingQuestionsPayload, type CodingQuestionRow } from "./coding-questions-json";

/** Minimal zip reader: enough for the flat archives the regenerator emits. */
function readZipEntry(buf: Buffer, wantedName: string): Buffer | null {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (name.replace(/\\/g, "/").split("/").pop() === wantedName) {
      return method === 0 ? data : inflateRawSync(data);
    }
    offset = dataStart + compressedSize;
  }
  return null;
}

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
}

export async function extractQuestionsFromUpload(
  buffer: Buffer,
  filename: string,
): Promise<CodingQuestionRow[]> {
  let text: string;
  if (isZip(buffer)) {
    const entry = readZipEntry(buffer, "coding_questions.json");
    if (!entry) throw new Error(`No coding_questions.json inside ${filename}`);
    text = entry.toString("utf8");
  } else {
    text = buffer.toString("utf8");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`Invalid JSON in ${filename}: ${(e as Error).message}`);
  }

  const questions = parseCodingQuestionsPayload(parsed);
  if (!questions?.length) {
    throw new Error(
      "Expected a non-empty array of questions (or an object with a coding_questions / questions / data / items array).",
    );
  }
  return questions;
}
```

Note: local headers carry `compressedSize: 0` when a producer streams with data descriptors. `archiver` with a Buffer source and the Python regenerator both write real sizes, so this path is fine; a streaming producer would fail loudly with "No coding_questions.json" rather than misread.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/upload-input.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/upload-input.ts src/lib/loadings/upload-input.test.ts
git commit -m "feat(loadings): accept a json or zip upload"
```

---

### Task 4: Next testing unit — derive child order and title

**Files:**
- Create: `src/lib/loadings/testing-unit.ts`
- Test: `src/lib/loadings/testing-unit.test.ts`

**Interfaces:**
- Consumes: nothing (pure in this task)
- Produces: `nextChildOrder(rows: string[][]) => number`, `nextTestingUnitTitle(existingNames: string[]) => string`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { nextChildOrder, nextTestingUnitTitle } from "./testing-unit";

const HEADER = ["unit_id", "unit_name", "topic_order", "unit_order"];

test("nextChildOrder returns max unit_order + 1", () => {
  const rows = [HEADER, ["u1", "Coding Testing 1", "3", "7"], ["u2", "Coding Testing 2", "3", "12"]];
  assert.equal(nextChildOrder(rows), 13);
});

test("nextChildOrder starts at 1 when the parent has no units", () => {
  assert.equal(nextChildOrder([HEADER]), 1);
  assert.equal(nextChildOrder([]), 1);
});

test("nextChildOrder ignores non-numeric orders rather than producing NaN", () => {
  const rows = [HEADER, ["u1", "x", "3", ""], ["u2", "y", "3", "not-a-number"], ["u3", "z", "3", "4"]];
  assert.equal(nextChildOrder(rows), 5);
});

test("nextTestingUnitTitle continues the numbering", () => {
  assert.equal(nextTestingUnitTitle(["Coding Testing 1", "Coding Testing 9"]), "Coding Testing 10");
  assert.equal(nextTestingUnitTitle([]), "Coding Testing 1");
  assert.equal(nextTestingUnitTitle(["Unrelated unit"]), "Coding Testing 1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/testing-unit.test.ts`
Expected: FAIL — cannot find module `./testing-unit`

- [ ] **Step 3: Implement**

```ts
/**
 * Child order for a new unit under the testing parent: one past the highest
 * existing unit_order. Rows come from the NKB GET_UNIT_RESOURCE_DETAILS CSV,
 * header first.
 */
export function nextChildOrder(rows: string[][]): number {
  if (!rows.length) return 1;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = header.indexOf("unit_order");
  if (col < 0) return 1;

  let max = 0;
  for (const row of rows.slice(1)) {
    const n = Number(String(row[col] ?? "").trim());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

const TESTING_UNIT_RE = /^Coding Testing (\d+)$/i;

/** "Coding Testing 9" -> "Coding Testing 10". */
export function nextTestingUnitTitle(existingNames: string[]): string {
  let max = 0;
  for (const name of existingNames) {
    const m = String(name || "").trim().match(TESTING_UNIT_RE);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `Coding Testing ${max + 1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/testing-unit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/testing-unit.ts src/lib/loadings/testing-unit.test.ts
git commit -m "feat(loadings): derive the next testing unit's order and title"
```

---

### Task 5: Wire rollover into the planner

**Files:**
- Modify: `src/lib/loadings/config.ts`
- Modify: `src/lib/loadings/testing-unit.ts`
- Modify: `src/lib/loadings/practice-set-db.ts` (`planQuestionSetBatches`, `LoadBatch`)
- Test: `src/lib/loadings/testing-unit.test.ts` (extend)

**Interfaces:**
- Consumes: `nextChildOrder`, `nextTestingUnitTitle` (Task 4); `runNkbTask` from `./nkb`; `readRegistry` from `./practice-set-db`
- Produces: `fetchTestingUnitRows() => Promise<string[][]>`, `createNextTestingUnit(opts: { onLog?: (phase: string, message: string) => void }) => Promise<{ questionSetId: string; commonUnitId: string; title: string; childOrder: number }>`; `LoadBatch` gains `unitTitle?: string`, `childOrder?: number`, `commonUnitId?: string`

Only reachable when every registry set is full — today about 25 single-question loads away.

- [ ] **Step 1: Confirm the parent resource exists (BLOCKING)**

Find the parent resource id shared by the existing "Coding Testing 1–9" units, via the beta Django admin or a `GET_UNIT_RESOURCE_DETAILS` run. Put it in `.env.local` as `NKB_TESTING_PARENT_RESOURCE`.

**If those units have no shared parent, STOP and report it** — Section 3 of the spec then needs redesign, and the rest of this task is invalid.

- [ ] **Step 2: Add the config entry**

In `src/lib/loadings/config.ts`:

```ts
/** Parent resource the auto-created "Coding Testing N" units hang off. */
export const NKB_TESTING_PARENT_RESOURCE = (
  process.env.NKB_TESTING_PARENT_RESOURCE || ""
).trim();
```

Do NOT add it to `missingLoadingsConfig()`. Rollover is rare; a missing value should fail at rollover time with a clear message rather than blocking every ordinary load.

- [ ] **Step 3: Write the failing test for the guard**

Append to `testing-unit.test.ts`:

```ts
import { createNextTestingUnit } from "./testing-unit";

test("createNextTestingUnit refuses to run without a configured parent", async () => {
  const prev = process.env.NKB_TESTING_PARENT_RESOURCE;
  delete process.env.NKB_TESTING_PARENT_RESOURCE;
  await assert.rejects(() => createNextTestingUnit({}), /NKB_TESTING_PARENT_RESOURCE/);
  if (prev) process.env.NKB_TESTING_PARENT_RESOURCE = prev;
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/testing-unit.test.ts`
Expected: FAIL — `createNextTestingUnit` is not exported

- [ ] **Step 5: Implement fetch + create**

Append to `src/lib/loadings/testing-unit.ts`. Read the env var inside the function, not at module load, so the test above can unset it:

```ts
import { randomUUID } from "crypto";
import { runNkbTask } from "./nkb";

// No import from ./practice-set-db — that module imports this one, and the
// cycle breaks at runtime. Existing unit names arrive as an argument instead.

/** Units under the testing parent, as CSV rows (header first). */
export async function fetchTestingUnitRows(parentResource: string): Promise<string[][]> {
  const result = await runNkbTask(
    "GET_UNIT_RESOURCE_DETAILS" as never,
    { resource_id: parentResource },
    { maxAttempts: 40, pollMs: 3000 },
  );
  if (!result.success) {
    throw new Error(`Could not read the testing parent's units: ${result.error}`);
  }
  if (!result.taskOutputUrl) return [];
  const res = await fetch(result.taskOutputUrl);
  if (!res.ok) throw new Error(`Could not download unit details: HTTP ${res.status}`);
  return (await res.text())
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(","));
}

export async function createNextTestingUnit(opts: {
  onLog?: (phase: string, message: string) => void;
}): Promise<{ questionSetId: string; commonUnitId: string; title: string; childOrder: number }> {
  const parentResource = (process.env.NKB_TESTING_PARENT_RESOURCE || "").trim();
  if (!parentResource) {
    throw new Error(
      "All testing question sets are full and NKB_TESTING_PARENT_RESOURCE is not set, so a new unit cannot be created.",
    );
  }
  const log = opts.onLog ?? (() => {});

  log("create unit", "reading existing testing units");
  const rows = await fetchTestingUnitRows(parentResource);
  const childOrder = nextChildOrder(rows);
  const title = nextTestingUnitTitle((await readRegistry()).map((r) => r.unitName));
  const questionSetId = randomUUID();
  const commonUnitId = randomUUID();
  log("create unit", `"${title}" at child order ${childOrder} (set ${questionSetId})`);

  return { questionSetId, commonUnitId, title, childOrder };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/testing-unit.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Use it in the planner**

In `practice-set-db.ts`, inside the `while (placed < total)` loop, replace the bare `randomUUID()` mint with `await createNextTestingUnit({ onLog })`, and carry `unitTitle`, `childOrder`, `commonUnitId` on the returned `LoadBatch`. `runBatch` (Task 6) uses them for the sheet instead of the caller's form values when present.

Watch for an import cycle: `practice-set-db` imports `testing-unit`, which imports `readRegistry` from `practice-set-db`. Break it by passing the registry rows into `createNextTestingUnit` as an argument instead of importing.

- [ ] **Step 8: Typecheck and run the whole suite**

Run: `npx tsc --noEmit && npm run test:ts`
Expected: no type errors; all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/lib/loadings/testing-unit.ts src/lib/loadings/testing-unit.test.ts src/lib/loadings/config.ts src/lib/loadings/practice-set-db.ts
git commit -m "feat(loadings): auto-create the next testing unit when sets are full"
```

---

### Task 6: Phase logging through the orchestrator

**Files:**
- Modify: `src/lib/loadings/load-coding-questions.ts`
- Test: `src/lib/loadings/question-set.test.ts` (extend)

**Interfaces:**
- Consumes: `LoadBatch` fields from Task 5
- Produces: `loadCodingQuestions(questions, form, opts?: { onLog?: (phase: string, message: string) => void })`

- [ ] **Step 1: Write the failing test**

```ts
import { loadCodingQuestions } from "./load-coding-questions";

test("loadCodingQuestions reports missing config through onLog", async () => {
  const seen: string[] = [];
  const prev = process.env.NKB_LOAD_DATA_PASSWORD;
  delete process.env.NKB_LOAD_DATA_PASSWORD;

  const result = await loadCodingQuestions(
    [{ question_id: "q1" }],
    { sheetName: "s", title: "t", childOrder: "1", parentResource: "p", autoUnlock: "TRUE" },
    { onLog: (phase, msg) => seen.push(`${phase}:${msg}`) },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Missing/);
  assert.ok(seen.some((l) => l.startsWith("config:")));
  if (prev) process.env.NKB_LOAD_DATA_PASSWORD = prev;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/lib/loadings/question-set.test.ts`
Expected: FAIL — `loadCodingQuestions` accepts only 2 arguments

- [ ] **Step 3: Thread `onLog` through**

Add the optional third parameter defaulting to a no-op, pass it into `runBatch` and `planQuestionSetBatches`, and emit one line per phase: `config`, `plan`, `zip`, `upload`, `task`, `unlock`, `verify`. Do not change any existing return shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/lib/loadings/question-set.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/loadings/load-coding-questions.ts src/lib/loadings/question-set.test.ts
git commit -m "feat(loadings): emit phase logs from the orchestrator"
```

---

### Task 7: Background load endpoint + status endpoint

**Files:**
- Modify: `src/app/api/loadings/coding-questions/route.ts`
- Create: `src/app/api/loadings/coding-questions/[id]/route.ts`

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: `POST /api/loadings/coding-questions` → `{ loadId }`; `GET /api/loadings/coding-questions/<id>` → the `LoadRecord`; `GET /api/loadings/coding-questions?problemId=…` → `{ configured, missing, lastLoad }`

- [ ] **Step 1: Rework POST to start a background job**

Accept `multipart/form-data` (upload: `file` + fields) or JSON (pipeline: `problemId` + fields + optional `remarks`). Authorise BEFORE reading the body — `requireProblemManageAccess(problemId)` for pipeline, the session check for uploads. Then:

1. Resolve questions — `readStorageFile` for pipeline, `extractQuestionsFromUpload` for upload.
2. If `problemId` has a completed load and no `remarks`, return 409 with that record; the UI renders the warning.
3. If `remarks` is present, `regenerateQuestionIds(questions)` first.
4. `createLoadRecord(...)` → `loadId`.
5. Start the load WITHOUT awaiting; return `{ loadId }` immediately.

```ts
const loadId = await createLoadRecord({ problemId, userId, source, remarks });

// Deliberately not awaited: the load runs for minutes and the client polls.
void (async () => {
  try {
    const result = await loadCodingQuestions(questions, form, {
      onLog: (phase, message) => void appendLoadLog(loadId, formatLogLine(phase, message)),
    });
    const batch = result.batches[result.batches.length - 1];
    await finishLoadRecord(loadId, {
      status: result.success ? "completed" : "failed",
      questionSetId: batch?.questionSetId ?? null,
      questionIds: batch?.questionIds ?? [],
      taskOutputUrl: batch?.taskOutputUrl ?? null,
      error: result.error ?? null,
    });
  } catch (e) {
    await appendLoadLog(loadId, formatLogLine("error", (e as Error).message));
    await finishLoadRecord(loadId, { status: "failed", error: (e as Error).message });
  }
})();

return NextResponse.json({ loadId });
```

- [ ] **Step 2: Add the status route**

`src/app/api/loadings/coding-questions/[id]/route.ts` — `params` is a Promise in Next.js 16:

```ts
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getLoadRecord(id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (record.problemId) {
    const auth = await requireProblemAccess(record.problemId);
    if (auth.error) return auth.error;
  }
  return NextResponse.json(record);
}
```

- [ ] **Step 3: Extend the existing GET**

`GET ?problemId=…` returns `{ configured, missing, lastLoad }`, with `lastLoad` from `latestLoadForProblem`.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors, no new lint errors

- [ ] **Step 5: Manual check, no beta load**

`npm run dev`; POST with a bogus `problemId` and expect 400/404, not a crash; POST unauthenticated and expect rejection.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/loadings
git commit -m "feat(loadings): background load endpoint with polled status"
```

---

### Task 8: LoadToBeta rework

**Files:**
- Modify: `src/components/problems/LoadToBeta.tsx`
- Create: `src/components/problems/LoadLogPanel.tsx`

**Interfaces:**
- Consumes: the Task 7 endpoints
- Produces: `<LoadLogPanel loadId={string} onDone={(record) => void} />`, reused by Task 9

- [ ] **Step 1: Prior-load banner**

On mount, `GET ?problemId=…`. When `lastLoad` exists, show its date and set id plus a link per question — `https://learning-beta.earlywave.in/question/<questionId>` — and disable the Load button.

- [ ] **Step 2: Remarks gate**

Behind a "Load anyway" toggle: a required remarks textarea and the warning *"All ids will be regenerated — beta will get a new copy of this question."* Keep the submit disabled until remarks are non-empty.

- [ ] **Step 3: Log panel**

Extract `LoadLogPanel`: given a `loadId`, poll `GET /api/loadings/coding-questions/<id>` every 2s, render `logs` in a monospace `max-h-64 overflow-auto` box, stop when `status !== "running"`, then show either the error or the question links.

- [ ] **Step 4: Verify in the browser**

`npm run dev`; on a problem's Outputs tab confirm: no button without `coding_questions.json`; banner when a prior load exists; remarks required before "Load anyway" enables.

- [ ] **Step 5: Commit**

```bash
git add src/components/problems/LoadToBeta.tsx src/components/problems/LoadLogPanel.tsx
git commit -m "feat(loadings): prior-load state, remarks gate and log panel"
```

---

### Task 9: Upload page

**Files:**
- Create: `src/app/load-coding-question/page.tsx`

**Interfaces:**
- Consumes: the Task 7 endpoints, `LoadLogPanel` (Task 8)
- Produces: the standalone upload surface

- [ ] **Step 1: Build the page**

Client component: a file input accepting `.json,.zip`, the five form fields (sheet name, title, child order, parent resource, auto unlock), submit as `multipart/form-data`, then render `<LoadLogPanel loadId={…} />`.

- [ ] **Step 2: Link it**

Add it to the app's navigation — check `src/components/layout/` for how other top-level pages are linked.

- [ ] **Step 3: Verify in the browser**

`npm run dev`, visit `/load-coding-question`, upload both a JSON and a zip, confirm each parses and the log panel updates.

- [ ] **Step 4: Commit**

```bash
git add src/app/load-coding-question
git commit -m "feat(loadings): add the coding question upload page"
```

---

### Task 10: End-to-end verification against beta

**Files:** none

- [ ] **Step 1: Ask before loading**

This writes to shared beta. Get explicit approval and agree which question to use.

- [ ] **Step 2: Load once through the UI**

Confirm the log panel advances through the phases and ends `completed`.

- [ ] **Step 3: Verify independently**

Confirm the target set's count increased by one and the question id is linked (the same check `confirmLinked` performs). Open the `learning-beta.earlywave.in/question/<id>` link.

- [ ] **Step 4: Verify the duplicate path**

Reload the same problem: expect the banner and a disabled button; supply remarks, force it, confirm a NEW question id in beta.

- [ ] **Step 5: Full suite**

Run: `npx tsc --noEmit && npm run lint && npm run test:ts && npm run test:json`
Expected: all green

- [ ] **Step 6: Commit**

```bash
git commit --allow-empty -m "test(loadings): verified end-to-end against beta"
```

---

## Notes for the implementer

- `src/lib/loadings/` is already live-verified. Do not "improve" the zip filenames, the polling, or `confirmLinked` — each encodes a failure that cost real debugging time.
- The registry sweep costs one Django admin search per set, so a load takes minutes before anything visible happens. That is why the log opens with a `plan` line.
- `~/Downloads/Loadings/.loadings-jobs.json` records what a successful load looked like, including the zip URL and question ids.
