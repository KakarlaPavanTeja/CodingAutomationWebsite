# CP pipeline: portable preparation skill + prompt feedback loop

**Date:** 2026-08-29
**Status:** design approved; implementation not started

## Problem

Two pains, one cause:

1. Weak questions ship without anyone noticing.
2. Preparing a question needs a human babysitting it.

The cause is that every quality signal the pipeline computes was discarded. That half
is now fixed: `Outputs/gates/select_testcases.json` records a machine-readable verdict
on every run (see `pipeline/Scripts/gate_report.py`).

What remains is that **nothing gets better as a result**. The lessons from each problem
are distilled by hand into the skill's `## Traps` section, and the evidence behind them
is thrown away — so there is no way to tell a one-off from a recurring weakness, and
the shared prompt files never improve.

## What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Interactive intake chatbot | `.claude/skills/coding-question-preparation/SKILL.md` `STEP 0` | works |
| Agent drives all 13 steps using the real prompts | same file, `## The steps` | works |
| Unattended runner | `scripts/cp-auto-resume.sh` + launchd plist | works |
| Machine-readable quality verdict | `pipeline/Scripts/gate_report.py` | done 2026-08-29 |
| Hand-distilled lessons | `SKILL.md` `## Traps` | manual, lossy |
| Feedback capture | — | **missing** |
| Harness portability | one `AskUserQuestion` reference, line 19 | **one line** |

## Decisions

1. **Intake stays human.** The six `STEP 0` answers are given up front, then the run
   hands off. Late reversals are the workflow's most expensive failure.
2. **Quality first, cost second** — but cost matters, so pay where it buys quality.
3. **Lessons improve the shared prompt files** in `pipeline/Scripts/Prompts/`, not the
   skill, because the cheap OpenRouter web pipeline reads those too. One fix improves
   every future question on either path.
4. **Improve generation, do not regenerate.** Retrying a step patches one question and
   bills again next time; fixing the prompt kills the class once.
5. **Accumulate, then distill on a pattern**, with a human gate before anything lands.
6. **Every prepared run is preserved** in object storage, attached or not, minus blob
   staging. Measured at 1.2 MB per run, so no claim need ever be unverifiable.
7. **Portable now** — any agent that can read a file and run bash must be able to
   follow the skill.

## Invariant: no code changes without approval

The loop is **structurally** unable to modify code. Not by instruction — by shape.

- **The agent that does the judging has no write tools.** `pipeline-feedback-analyst`
  is granted `Read`, `Grep`, `Glob` and nothing else — deliberately not `Bash`, which
  can write via a redirect. It returns its proposal as a report; the calling session
  writes that to `pipeline/feedback/proposals/<date>-<prompt-file>.patch`. So the
  component forming an opinion about a prompt is structurally incapable of acting on it.
- No step anywhere in the loop edits a file under `pipeline/Scripts/Prompts/`.
- Applying a proposal is a human action (`git apply`), never an agent's follow-up to
  "looks good".
- The preparation skill states outright: **never edit prompt files during a run.**
- The agent appends to the feedback file but never commits. The human commits, which is
  what makes review a real gate.

Optional hardening, harness-specific: a Claude Code `PreToolUse` hook denying writes to
`pipeline/Scripts/Prompts/**`. Prose-only for other harnesses.

## Design

### 1. The feedback record

One git-tracked file: `pipeline/feedback/OBSERVATIONS.md`. Appended after each problem,
newest last. One file rather than a directory, so reviewing feedback is reading one diff.

Entry shape:

```markdown
## <date> — <problem-slug>  (function|nonfunction · difficulty · scenario: level)

**Run:** `runs/<slug>/` in object storage (plus the local path while it still exists)
**Gates:** B1 kill <x>% · B2 <pass|fail> · B3 <n> notes · B4 <state>
**Survivor bug classes:** <class> ×<n>, …

### Friction
- <what fought back, and which trap it maps to if any>

### Prompt suspects
- `<promptFile>.py` — <one line on the weakness>

### Human notes
_(optional)_
```

Design points:

- **"Prompt suspects" names a file.** This is what makes prose countable: a pattern is
  the same file named across several problems. Without it there is only anecdote.
- **Gate numbers are copied from `Outputs/gates/*.json`**, never re-derived, so the
  machine and human halves of the feedback agree by construction.
- **Human notes are optional and last.** Nothing in the run waits on them.
- **`Run:` points at the surviving artifacts.** Without it every later claim is
  unfalsifiable: the analyst can say a prompt is weak but cannot show it, and you would
  be approving prompt edits on an agent's word. This field is what makes the evidence
  section of a proposal possible at all. It names the object-storage prefix rather than
  the scratch directory, because the scratch directory is the thing that disappears.

### 2. Preserving the evidence

Every prepared run is uploaded to object storage under `runs/<slug>/`, whether or not the
problem is ever attached to the platform.

**Why unconditionally:** upload happens today only inside `scripts/attach-manual-run.mts`,
which is human-gated and forbidden in unattended runs. A problem you prepared and then
abandoned therefore has no copy — and an abandoned problem is exactly the one with the most
to learn from. Preserving only the successes would teach the loop from the wrong half of
the evidence.

**What is uploaded:** the whole `Inputs/` + `Outputs/` tree except blob staging
(`s3_blobs_tmp/`). Measured on a real run: **1.2 MB total**, being `testcases.json` at
1.0 MB and `usage_tracker.json` at 164 KB. The current executor writes no blobs under
`Outputs/` at all — `execution_manager_v3.py:472` is explicit about it — so the exclusion
only catches leftovers from the legacy v2 path. A hundred problems a year is ~120 MB.

**New script:** `scripts/preserve-run.mts`. Walks the run tree and uploads via the existing
`putObject` from `src/lib/object-storage.ts`.

- **No database write.** That is what makes it safe unattended: the shared production
  database is untouched and nothing anyone reads changes — only new objects under a prefix
  nothing else uses.
- **Dry run by default**, matching `cleanup-s3-blobs.mts` and `attach-manual-run.mts`.
  `--execute` uploads.
- Idempotent: re-running overwrites the same keys, so a resumed run can preserve at each
  step boundary without duplicating.

**`cp-auto-resume.sh` needs its hard limits amended.** It forbids "upload to S3" outright,
bundling it with the database writes that genuinely need a human. Those are different
risks: `preserve-run.mts` should be allowed, `attach-manual-run.mts` stays forbidden.
Leaving the blanket ban would mean unattended runs — the majority — preserve nothing,
which defeats the point.

### 3. The distillation pass

Separate trigger ("review pipeline feedback"), separate discipline. Not part of
preparing a problem.

**Counting is code; judgement is not.** `pipeline/Scripts/feedback_summary.py` parses
`OBSERVATIONS.md` and emits a ranked table of prompt file → problem count → problem
names. **The counts come from the script, never from the agent's own tally** — the agent
still reads the file for the qualitative detail, but it cannot arrive at "4 problems" by
counting sympathetically toward a change it already wanted to make.

Rules:

- **≥3 problems naming the same prompt file with the same lesson** → eligible to propose.
- **Fewer than 3** → stays as evidence, explicitly not actionable.
- Proposal is written as an unapplied patch plus its evidence (the problem names).
- Once applied, the entries that justified it are marked distilled, so one recurring
  lesson cannot re-qualify forever and re-propose every month.

The threshold of 3 is a knob. Below it, the prompt gets fitted to whatever was built
last week — the failure mode that makes a shared prompt worse over time.

### 4. The feedback analyst agent

A dedicated subagent, `.claude/agents/pipeline-feedback-analyst.md` (a new directory —
the repo has none today).

**Tools: `Read`, `Grep`, `Glob`.** No `Write`, no `Edit`, and specifically no `Bash`,
because a shell redirect is a write. The calling session runs `feedback_summary.py`
first and passes the ranked table in the prompt, so the analyst never needs a shell.

**What it does:**

1. Reads the ranked table it was given, and `OBSERVATIONS.md` in full.
2. For each candidate at or above the threshold, opens the actual artifacts named by
   the `Run:` field of each contributing entry — the gate JSON, `testcases.json`, the
   generated description — and confirms the claimed weakness is visible in them.
3. Drops any candidate it cannot substantiate from the files, and says so. A lesson
   that was misrecorded must not become a prompt change.
4. Returns one proposal per surviving issue.

**Proposal shape**

Four parts per issue, in this order. Plain language first; gate names like B1/B3 appear
only in parentheses, after the thing has been said in words.

~~~markdown
## Issue 1 — The last subtask is barely tested

### What happened
When a problem has several subtasks, the generator puts nearly every test case in the
first two and leaves the last one with a single case. The last subtask normally holds the
biggest inputs, so the hardest part of the problem ends up the least tested. Seen in 4 of
the last 11 problems. (This is what the B3 coverage-shape note reports.)

### Where to see it

**1. grid-paths** — `<run>/grid-paths/Outputs/gates/select_testcases.json`

```json
"advisory": ["B3: subtask 3 has 1 case"],
"numbers": { "total": 166 }
```

One case out of 166 covers subtask 3.

**2. k-subarrays** — `<run>/k-subarrays/Outputs/testcases.json`, the only case tagged
subtask 3:

```json
{ "order": 164, "subtask": 3, "input": "5\n1 2 3 4 5\n", "size_metric": 5 }
```

`size_metric` is 5 while the problem's constraint is n <= 200000 — the subtask meant to
cover the largest inputs is being tested with one of the smallest.

### Suggestion
In `testcasesprompt_v4.py`, <the specific change>, because <why this rather than the
alternatives considered>.

### What this does not show
<the limits of the evidence, and what would disprove the issue>
~~~

Rules the analyst follows:

- **A bare file path is not evidence.** Every reference carries the actual content — the
  exact JSON keys and values, or the quoted lines — plus one sentence saying what it
  proves. The reader must never have to open a file and hunt for the point.
- **Numbers, not adjectives.** "1 of 166 cases", never "very few cases".
- **Plain words before jargon.** Say what happened; then name the gate.
- **Big artifacts are read with `Grep`, never `Read`.** `testcases.json`,
  `testcases_pool.json`, `execution_results.json` and friends run 140 KB - 900 KB, and
  the skill's `OUTPUT HYGIENE (non-negotiable)` rule already forbids pulling them into
  context. A targeted `Grep` returns the matching lines and nothing else, which is
  exactly the pinpointed quote a proposal needs. Gate JSON is small and may be read whole.
- **One issue per proposal.** Two weaknesses in one prompt file are two proposals, so
  you can approve one and reject the other.

Every issue is checkable against a file in under a minute. That is the point of the
agent: not to save you from reading, but to make what you read verifiable.

**Why a separate agent rather than the main session:** the tool restriction is the
enforcement mechanism for the invariant above. A main session holding `Edit` cannot
offer that guarantee, however carefully it is instructed.

### 5. Portability

Minimal, per the decision:

- Line 19's `AskUserQuestion` becomes harness-neutral ("ask all six in a single round,
  however your harness asks questions").
- Add a short **Harness requirements** section: read/write files, run bash, one
  interactive question round, and the ability to follow a numbered procedure.
- The file stays where it is. Other harnesses are pointed at it directly.

### 6. Skill changes

Add `## After the problem — record what you observed`, containing the entry template,
where to read gate numbers from, the instruction to ask for optional human notes, and
the prohibition on editing prompt files or committing.

## Testing

- `scripts/preserve-run.mts` — verified by its dry run, which lists exactly what would be
  uploaded and what the blob exclusion skipped. No unit test: a directory walk plus an
  existing, already-exercised `putObject`.
- `pipeline/Scripts/tests/test_feedback_summary.py` — the counting script: ranking order,
  the ≥3 threshold, distilled entries excluded from counts, a malformed entry skipped
  rather than crashing the pass.
- The analyst agent has no unit test — it is prose plus a tool restriction. The
  restriction is verified by reading its frontmatter, not by a test.
- Everything else is agent-followed prose and has no unit test. Both existing suites
  (`npm run test:json`, `npm run test:ts`) must stay green.

## Out of scope

- Auto-regeneration on a failed gate. Rejected on cost; superseded by decision 4.
- Making B3 blocking, and promoting B4's real disagreements to blocking. Both now
  recorded; promoting them is a later decision with its own blast radius.
- Gates on the steps that have no quality signal today (description, translations,
  brute force, wrong solutions, enrichment, editorial).
- A DB table or UI for feedback. A git-tracked markdown file is reviewable in a diff,
  which is exactly what the human gate needs.

## Open question

`src/lib/reconcile-pipeline-runs.ts:27` claims `select_testcases` rewrites
`testcases.json`; the step's config and script say it writes nothing. One is stale.
Worth settling before anything automates re-running that step.
