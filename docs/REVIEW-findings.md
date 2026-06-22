# Deep Review — Findings (read-only, no fixes applied)

**Date:** 2026-06-23
**Scope:** Two plans —
1. **Clear Picture** pipeline/wave-graph rework (reviewed against `clear picture.md` + `docs/pipeline-flows/`)
2. **cp-prep** new-problem feature (intent inferred from code; no separate spec found)

**Method:** 5 parallel reviewers (UI/orchestration, Python packaging, API/run-state, cp-prep core, upload UI). High/critical findings personally re-verified against the source. `✓` = I read the exact lines and confirmed.

**Plans read (source of truth):**
- `~/.cursor/plans/clear_picture_pipeline_fix_2460e03a.plan.md` — **the refined/final Clear Picture plan** (all phases `completed`; overrides the draft).
- `~/.cursor/plans/clear_picture_pipeline_fix_a2210cd0.plan.md` — earlier draft (all `pending`). Used only for detail where consistent. **Note:** it proposed a non-function *naming* step; the final plan **reverts that** (function-only naming).
- `~/.cursor/plans/cp_prep_integration_91aed550.plan.md` — the cp-prep plan.

---

## ⚠️ Reconciliation after reading the actual plans (corrections to the first-pass findings)

Reading the real specs reclassified several items. **Read this before the detailed lists below.**

| First-pass finding | Corrected verdict |
|---|---|
| **P2-C1** cp-prep uses `getSession()` not `requireAuthApi` | **Conforms to plan** — cp-prep plan line 134 explicitly says *"Auth via `getSession()` (same as upload route)"*, and `files/upload/route.ts:22` **does** use `getSession()` ✓. So this is *intended* and matches existing convention. **Residual (systemic, not a deviation):** if `getSession()` doesn't enforce account status, deactivated/pending users retain access across **both** routes — a threat-model gap worth fixing app-wide, but not a bug *against this plan*. → downgraded to **Medium / systemic**. |
| **P2-C2** cp-prep runs LLM-Python unsandboxed | **Accepted v1 risk** — cp-prep plan line 204 explicitly accepts local `child_process` for v1 ("production should use a sandbox"). **Residual not covered by the plan:** the child inherits **all** secrets because no `env` is passed (`python-runner.ts:39`). The plan accepted *no sandbox*; it did not call out *secret inheritance*. → kept as **High (residual)**: pass a minimal `env`. |
| **UI-H1** "default tags textbox missing" | **FALSE POSITIVE.** Item 16 lives in the **pipeline config**, not the new-problem wizard. `GlobalConfig.tsx:160-170` has the "Default tag names (one per line)" advanced textarea ✓. Withdrawn. |
| **UI-H3** "title editable/Save/confirm missing" | **MOSTLY FALSE POSITIVE.** `GlobalConfig.tsx:106-148` has the editable title, **Save** button (writes to outputs), and "Generate title with AI" checkbox ✓ — matching final plan §"Title flow". The original confirm-dialog idea was **de-emphasized** by the refined plan (auto-sync replaces it). → downgraded to **Low** (no confirm-on-edit-after-AI). |
| **P1-C1 / P1-H5** "status never returns to `completed` after rerunning a non-final step" | **WORKS AS DESIGNED.** Final plan §4.4 + draft line 201/1078 *intend* `completed` only after `prepare_platform_json`, and `processing` on any rerun until the terminal step finishes. So this is the spec, not a bug. **BUT** the user's `clear picture.md` bug #2 wants *responsiveness*, and §4.3/line 980 require **rerun to invalidate `package_platform` + `prepare_platform_json` and reset downstream to pending** — verify that invalidation is actually implemented (partial logic exists: `isPackagingStep`/`downstreamHasProgress` in `pipeline-context.tsx:49,580`). → reframed as **Medium: verify rerun-invalidation**, not Critical. |

**Findings the plans CONFIRM as real bugs (the plan asked for them; the code didn't deliver):**
- **P1-C2 / P1-M2** — substep status overwrites the **parent**. Final plan §4.4 (line 1082) explicitly says *"Persist substep status server-side on GQ runs (today overwrites parent only)"* — this was a **known issue the plan intended to fix, and it's still not fixed.** **Elevated.**
- **P1-C3** (language filter no-op), **P1-C4** (`next()` crash), **P1-H1** (`default_code` flag lost) — all violate the plan's pipeline-wide language-filtering requirement (§1.4, §3.2 req 10, language-filtering touchpoints).
- **P1-H2** (fn-practice `debug_helper_code` dropped) — final plan JSON matrix (line 988) says fn-practice debug = *"From debugger files"*; code hardcodes `None`.
- **P1-H3 / P1-H4** (no `stopping`/`stopped` state; stop is silent no-op on null runId) — violates plan §5.2 which explicitly specifies the stopping→stopped→3s machine **and** *"Handle null runId: reset to pending + toast error."* Verified: no `stopping`/`stopped` in `types/pipeline.ts` ✓.
- **P1-M10** (non-function description emits "Your Task") — violates req 5 (both plans agree).

**Conformant (checked, no action):** non-function naming correctly **omitted** (final plan reverted it); GQ sub-step checkboxes removed from GlobalConfig ✓; languages-apply-to-whole-pipeline control present ✓; exam `metadata null` / `topic_tag_names {}` / `PYTHON39` / non-fn empty repos ✓; default non-function code strings char-for-char ✓.

---

## TL;DR — the 3 bugs you flagged in `clear picture.md` are real and have concrete root causes

| Your complaint | Root cause(s) | Where |
|---|---|---|
| **Status flip-flops / gets stuck** (Draft/processing/completed) | Status is a *side-effect of which step runs*, never derived from aggregate run state. Only `prepare_platform_json` exit-0 → `completed`. 4 uncoordinated writers, reconcile runs on every read. | `run/route.ts:457` ✓, `stop/route.ts:65`, `reconcile-pipeline-runs.ts` |
| **Run/Stop button flaky** | Stop is a no-op during the launch window; stop writes `failed` (no stopping→stopped→3s state); stop of a sub-step clobbers the whole parent; double-launch race. | `pipeline-context.tsx:1512`, `stop/route.ts:54` ✓ |
| **Timers not in sync** (step & substep) | `endTime` defaults to `Date.now()` on *every* recompute; client `Date.now()` vs server `started_at` swap mid-run; parent/child use different clocks. | `pipeline-question.ts:189`, `pipeline-language-steps.ts:128` ✓ |

---

# PLAN 1 — Clear Picture (pipeline rework)

## 🔴 Critical

### P1-C1 — Status never returns to `completed` after re-running any non-final step ✓
`src/app/api/pipeline/run/route.ts:249-252, 457-462`
Every step start sets `problems.status = "processing"`. Only a successful `prepare_platform_json` sets `completed`. So re-running *any* earlier step (e.g. regenerate Description) flips a finished problem to `processing` and it **can never return to `completed`** unless the user also re-runs Package JSON. This is the primary driver of "status keeps changing improperly / gets stuck." There is no derivation of problem status from aggregate step state.

### P1-C2 — Stopping one sub-step/language tile marks the whole parent step `failed` ✓
`src/app/api/pipeline/run/stop/route.ts:53-58`
`stepStatuses[parentStepId] = { status: "failed", ... }`. Stopping `translate_java` or `split_code__cpp` writes `generate_question` / `split_code` = failed, discarding all sibling progress. On next load the parent loads as failed even though other substeps completed. Client patches only the one sub-run, so client and server disagree until reload — then the bad server value wins. Major contributor to the stop flakiness.

### P1-C3 — Server does not enforce language deselection; the language filter is a no-op ✓
`src/lib/pipeline-language-steps.ts:115` + `src/app/api/pipeline/run/route.ts:223` + `src/lib/pipeline-config.ts:292`
```ts
const required = enabledLangs.filter((l) => l in runs || enabledLangs.includes(l)); // 2nd clause always true → no-op
```
and the route calls `filterLanguagesForCommand(stepId, languages, languages)` (both args identical), so the global enabled-set is never intersected. The language-tile path sends `[langId]`, so a stale/unselected language can be executed. **Violates plan items 17 & §10** ("unselected language must not be generated/executed"). Enforcement currently lives only in the client.

### P1-C4 — `prepare_platform_json` crashes on node-based question when C++ is deselected ✓
`pipeline/Scripts/prepare_platform_json.py:799-801`
```python
cpp_repo = next(r for r in final_json[0]["language_code_repository_details"] if r["language"] == "CPP")
```
Bare `next()` with no default → `StopIteration`/`RuntimeError` when the question is node-based (binary tree / linked list) and `cpp ∉ enabled_langs`. The entire Package step fails. **Violates item 17.**

### P1-C5 — Non-function detection diverges between LUA builder and JSON builder
`prepare_platform_json.py:175-180` vs `prepare_lua_and_testcases.py:43-45,118`
JSON builder reads only env `PIPELINE_QUESTION_TYPE`; LUA builder also reads `# Question Type:` from `problem.md`. If env is unset but `problem.md` marks non-function, the LUA is packaged as non-function while the **JSON is built as function-based** (`is_function_based=true`, wrong default codes, repo details populated from empty sections). The two stages disagree on the question's fundamental kind. **Violates items 7, 8, 10.**

## 🟠 High

### P1-H1 — `default_code: true` is lost when C++ is deselected
`prepare_platform_json.py:381, 616, 697`
The "primary language" flag is computed as `lang == "CPP"`. If the creator deselects C++ (allowed by items 10/17), **no** entry in `coding_question_details` gets `default_code: true`, and practice solutions set CPP default then filter it out → zero default solutions. The platform expects exactly one default language. **Violates items 10, 17.**

### P1-H2 — Function-based **practice** never emits `debug_helper_code`
`prepare_platform_json.py:691-702` (hardcoded `None`); dead parser at `:529`
The LUA builder writes `DEBUG_HELPER_CODE_<LANG>` sections (`prepare_lua_and_testcases.py:271-278`) and a parser exists (`practice_parse_debug_helper_code`) but is **never called**. Function-based practice silently loses debug helper code. (Item 7 ties `null` debug code specifically to *non-function*; function-based should carry it.)

### P1-H3 — Stop never shows "stopping → stopped → Run after ~3s"; jumps to red `failed`
`pipeline-context.tsx:1527-1531` (+ sub/lang variants); `types/pipeline.ts:28` (no `stopping`/`stopped` in `StepStatus`)
Stop sets `failed` immediately. The 3s cooldown only disables the side-panel Run button — the wave-graph tile has no cooldown. **Does not implement the contract in plan bug #3.**

### P1-H4 — Stop is a silent no-op during the launch window ✓
`pipeline-context.tsx:1512-1513` (`if (!runId) return;`), 1433, 1461
`runningStepsRef` is only populated after `postPipelineRun` resolves. Clicking Stop in the (multi-second) window between Run and the POST resolving finds no `runId` and returns silently — button looks dead while UI still shows "running". No `activeRunId` fallback. Direct instance of "Stop sometimes doesn't respond."

### P1-H5 — UI gate uses a different context than the orchestrator → downstream shown Locked while actually runnable
`PipelineWaveFlow.tsx:73, 160-170`
`isQuestionPhaseComplete(gqState, questionType)` is called **without `gqContext()`**, and `gqCtx` hardcodes `ownerDifficulty: ""`. So titles/difficulty skip rules aren't applied for lock-state: a GQ that's complete per the orchestrator (manual title set, owner difficulty set) still renders Test/Package + downstream as **Locked**, even though Run All launches them. Likely cause of "Run button doesn't respond" (tile is locked while runnable). **Relates to plan items 3 & 14.**

### P1-H6 — Multiple uncoordinated writers to `problems.status`; no transaction → flip-flop/lost updates
`run/route.ts:249-252 & 452-462`, `stop/route.ts:65-68`, `reconcile-pipeline-runs.ts:86-98`
Four paths write status with plain `UPDATE`, no row lock/version, firing from background `proc.on("close")` and from every read (reconcile runs inside `GET`). With parallel steps (which the plan wants), these interleave and produce exactly the "status changes at improper times / not responsive" behavior. No single atomic source of truth.

### P1-H7 — Early-failure paths strand the problem in `processing`
`run/route.ts:238-268` (empty `catch`), `markRunTerminal` (`:25-44`)
If workspace creation/mirror throws after status was set to `processing`, `markRunTerminal(runId,'failed')` updates only the **run** row, never resetting `problems.status`. Reconcile only scans `status='running'` runs, so it never fixes the problem → stuck `processing` indefinitely.

### P1-H8 — Stale PID handling unsound (`process.kill(pid,0)` + PID reuse) and pid registered after spawn
`reconcile-pipeline-runs.ts:38-83`, `run/route.ts:341-343`
`isProcessAlive` returns true for *any* OS process with a reused pid → a dead run looks alive forever and never reconciles (problem stuck `processing`). Conversely, between spawn and async pid-write, a `stop` finds `undefined` pid → can't kill a live process while the run row is already `failed` (orphaned `unref`'d process keeps emitting output/usage after "stop").

### P1-H9 — Orchestrator can hang forever on the "await until not running" busy-loop
`pipeline-context.tsx:1128-1137, 1248-1256, 1390-1398`
Each runner sets a 400ms interval that resolves when status leaves "running". `loadProblemState` (`:444-449`) clears `pollRefs` but **not** these ad-hoc intervals and never rejects their promises, and it doesn't clear `runningSubStepsRef`. Switching problems mid-launch strands the orchestrator with `launchingStepsRef` set, so the step can never be re-run and Run All wedges.

## 🟡 Medium

- **P1-M1** — LLM usage is matched by `stepId` + loose time-window only (no `runId` on usage rows) → **double-counts across re-runs and overlapping parallel steps**. `usage/route.ts:49-63`, `pipeline-usage-match.ts:61-86`.
- **P1-M2** — Close handler writes `stepStatuses[stepId]` (bare parent) but the run row is keyed by composite `logStepKey`; sub-step status mis-attributed to parent / sibling updates lost (read-modify-write, no lock). `run/route.ts:426-443`.
- **P1-M3** — `reconcileStalePipelineRuns` performs writes on **every** status poll and every `GET /problems/[id]` → write storm + itself causes status churn. `status/route.ts:44-46`, `problems/[id]/route.ts:30`.
- **P1-M4** — `recomputeGenerateQuestionStatus`/`recomputeLanguageStepStatus` default `endTime` to `Date.now()` when children lack endTimes → completed step's duration keeps growing every poll. `pipeline-question.ts:189`, `pipeline-language-steps.ts:128`. (Timer bug #1.)
- **P1-M5** — `wasStopped` is read *after* the close handler already overwrote `exitCode` (lines 418 then 445) → a stopped `prepare_platform_json` reported exit-0 by the OS gets marked `completed`. `run/route.ts:418-462`.
- **P1-M6** — `loadProblemState` doesn't clear `runningSubStepsRef` or the ad-hoc check intervals → stale stop POSTs target the previous problem's run. `pipeline-context.tsx:444-449`.
- **P1-M7** — `getSplit/ExecuteSubStepsForLanguages` force-prepend `python` even if Python is unselected → a Python tile appears the user didn't ask for. `pipeline-language-steps.ts:40-51`. (Conflicts with item 17 if Python deselection is intended; confirm whether Python is a mandatory reference.)
- **P1-M8** — Exam JSON uses `ensure_ascii=True`, practice `False` → exam emits `≤` etc. while practice emits raw glyphs. Inconsistent byte output. `prepare_platform_json.py:859 vs 862`.
- **P1-M9** — Exam default-tags read from env only; practice falls back to LUA `DEFAULT_TAGS` → exam loses tags if env not propagated. `prepare_platform_json.py:360 vs 685-689`. (Item 16.)
- **P1-M10** — Non-function + `scenario_level="none"` routes through `get_structure_only_prompt` which includes a **"Your Task"** section → violates item 5 (non-function has no "Your Task"). `Prompts/descriptionPrompt.py:645-646, 54, 105-110`.
- **P1-M11** — `parse_difficulty` raises `ValueError` on blank difficulty (hard crash) instead of AI/default fallback. `prepare_platform_json.py:252-262`. (Item 3.)

## 🟢 Low (selected)
- **P1-L1** — Title hydration `firstLine...split("-")[0]` truncates legitimate hyphenated titles ("Two-Sum", "k-th element"), incl. AI-generated ones. `pipeline-context.tsx:552, 1001`. (Item 14.)
- **P1-L2** — `parsePipelineLogContent` forces `+1ms` monotonic ts → bursty logs show fake multi-second elapsed. `pipeline-log-parse.ts:35`.
- **P1-L3** — Dead legacy components (`StepProgress`, `StepDetailPanel`, `StepCard`, `execution-parser`) still encode old timer/status logic; will mislead future debugging. Confirm unused + remove.
- **P1-L4** — `recomputeLanguageStepStatus` failed-branch uses `state.startTime` not min(child starts) → wrong duration on failed parallel step. `pipeline-language-steps.ts:132-133`.
- **P1-L5** — Metadata key `real_life_example` (singular) in JSON vs `real_life_examples` (plural) in enrichment artifact — verify against platform contract. `prepare_platform_json.py:672`.
- **P1-L6** — `normalizeEnabledQuestionSubSteps` both branches `return derived` → saved sub-step config silently discarded. `pipeline-question.ts:262-271`.

---

# PLAN 2 — cp-prep (new-problem feature)

## 🔴 Critical

### P2-C1 — Account-status authorization bypass ✓
`src/app/api/cp-prep/route.ts:34-40`
Gates only on `getSession()` existence. Every comparable route uses `requireAuthApi()` which rejects `pending_approval`/`deactivated`/`left`. A deactivated user with a valid cookie can drive expensive LLM calls + server-side Python. **Threat-model "active vs inactive" violation.**

### P2-C2 — Unsandboxed execution of LLM-generated Python with inherited secrets ✓
`src/lib/cp-prep/python-runner.ts:39`, `index.ts:166`
`spawn(pythonBin, [scriptPath])` passes **no `env`** → child inherits full `process.env` (`DATABASE_URL`, `OPENROUTER_API_KEY`, `ADMIN_SECRET_KEY`, `CRON_SECRET`, storage creds). The executed code is steered by attacker-controlled `problemStatement`/`referenceSolution`, and stderr is echoed to the client. The file's own comment admits "no real isolation." **Direct threat-model violation.** Needs minimal explicit `env`, no network, unprivileged/containerized execution.

## 🟠 High

- **P2-H1** — No body-size / field-length limits → DoS + unbounded LLM cost; `isValid` only checks non-empty. `cp-prep/route.ts:49-67`.
- **P2-H2** — No rate limiting on a route that fires up to 4 Opus-class calls (8000 max_tokens) + N subprocess spawns per request. A `rate-limit.ts` helper exists but is unused. `cp-prep/route.ts`.
- **P2-H3** — `examples` field never validated but consumed as typed data → `ex.input.endsWith()` TypeError / `examples.length` on non-array, etc. `cp-prep/route.ts:16-27, 93-96`, `python-runner.ts:96`, `prompts.ts:62`.

## 🟡 Medium
- **P2-M1** — `res.json()` called before `res.ok` check → non-JSON 5xx (proxy HTML) masks real status with a JSON-parse error. `openrouter.ts:74-78`.
- **P2-M2** — No timeout/abort on the OpenRouter fetch → can hang to `maxDuration` (300s). `openrouter.ts:60-72`.
- **P2-M3** — Client abort/disconnect doesn't propagate to server; `req.signal` unobserved → `prepProblem` keeps running, cost accrues, `recordLlmUsage` still fires. `cp-prep/route.ts:72-146`, `useCpPrepStream.ts:35-39`.
- **P2-M4** — `controller.enqueue` in progress `send()` is unguarded → after client disconnect, next `onProgress` throws "Controller is already closed". `cp-prep/route.ts:74-88`.
- **P2-M5** — `usage:{include:true}` + Anthropic-only cost estimator → non-Anthropic models (configurable via `OPENROUTER_MODEL_CP_PREP`) get mispriced usage rows. `openrouter.ts:70`, `anthropic-usage.ts`.

## 🟢 Low
- **P2-L1** — `parseModelJson`/`JSON.parse` in the attempt loop has no try/catch → one truncated reply (8000-token cap) aborts the whole run instead of triggering repair. `cp-prep/index.ts:57-76, 147`.
- **P2-L2** — `parseCombinedInput` `problemEnd = solutionStart - 2` mis-slices when markers are adjacent (silent empty body). `parse-combined-input.ts:41`.
- **P2-L3** — stdout 1MB cap SIGKILLs child; truncation indistinguishable from crash in the error message. `python-runner.ts:52-55`.

---

# PLAN 2 — Upload / New-problem UI

## 🟠 High
- **UI-H1** — **Plan item 16 NOT implemented:** no "default tag names" multi-line textbox. `ProblemAdvancedSettings.tsx` only has Scenario/Difficulty/Score/Share/Companies; no `defaultTags` state; upload route accepts no `tags`.
- **UI-H2** — Companies textbox UI says "one per line" but server splits on `\n` **and** commas (`/[\n,]+/`) → "Alphabet, Inc." becomes two tags. `ProblemAdvancedSettings.tsx:135` vs `files/upload/route.ts:153`. (Will also bite item 16 tags if copied.)
- **UI-H3** — **Plan item 14 partially unmet:** title is editable but there's no overwrite-of-generated-title, no AI-regenerate-title node, and no final-confirmation dialog on change. `FileUploader.tsx:558-569, 744-754`. (Much of item 14 is a pipeline-config concern outside these files.)
- **UI-H4/H5** — Editorial blocks use **array index as key** while `blocks` is re-derived from content on every keystroke → component instance reuse bleeds `sel`/`expanded`/textarea caret to the wrong block on structural edits. `ProblemEditorial.tsx:453, 819-823`.

## 🟡 Medium
- **UI-M1** — `OutputBrowser.fetchFiles` has no stale-response guard → out-of-order responses overwrite with stale data; `expandedDirs` not reset on `problemId` change. `OutputBrowser.tsx:41-59`.
- **UI-M2** — `setActiveTabPath` called **inside** the `setOpenTabs` updater (impure updater; double-invokes in StrictMode). `ProblemOutputs.tsx:114-127`.
- **UI-M3** — `abort()` doesn't reset `result`/`error`; `FileUploader` never calls the exported `clear()` → stale cross-workflow data persists after switching presets. `useCpPrepStream.ts:35-39`, `FileUploader.tsx:524-527`.
- **UI-M4** — `MarkdownProse` logic is **duplicated verbatim** inside `ProblemEditorial.tsx` instead of importing the shared component → divergence hazard. `MarkdownProse.tsx` vs `ProblemEditorial.tsx:120-266`.
- **UI-M5** — Optimistic `generate_editorial` default hardcodes `enabledLanguages: []` (execute path uses `globalLanguages`) → may generate empty per-language output. `ProblemEditorial.tsx:646-662`.

## 🟢 Low
- **UI-L1** — Running-row duration uses `Date.now()` at render; only re-renders on 5s poll → duration jumps in 5s steps (matches timer bug #1). `problems/[id]/page.tsx:122-130`.
- **UI-L2** — `result.exampleResults.filter/map` with no optional chaining → render throws if stream omits the field. `FileUploader.tsx:227, 245`.
- **UI-L3** — Dropped combined file read via `file.text()` with no client size guard (server clamps at 5MB later). `FileUploader.tsx:642-663`.

---

# Test-coverage gaps — `pipeline/Scripts/tests/test_prepare_platform_json.py`
7 tests pass but cover a thin slice. Missing assertions for spec items:
- Per-language **exclusion** across all 3 keys (`coding_question_details` / `language_code_repository_details` / `test_case_evaluation_metrics`) — would catch P1-C3/C4/H1 (items 10, 17).
- `PYTHON` (practice) vs `PYTHON39` (exam) for the same input (item 11).
- Exam `solutions == []` for function-based + repo populated from base64 (item 9).
- Practice metadata is stringified JSON with `real_life_example`/`follow_up_questions`/`topics`; exam `metadata is None` (item 12 — only exam half covered).
- Score/difficulty defaults 20/25/30 + owner override (item 2).
- `debug_helper_code` for function-based practice (would catch P1-H2).
- Exact non-function default `code_content` strings per language (item 7).

**Verified char-for-char OK:** non-function default code strings for CPP/PYTHON39/JAVA/NODEJS (item 7); exam `topic_tag_names == {}` (13); exam `metadata is None` (12); exam non-fn `language_code_repository_details == []` (8).

---

# Plan-conformance gaps (quick map)
| Plan item | Status |
|---|---|
| 2 (score defaults) | Implemented; **untested** |
| 3 (difficulty skip if owner-set) | Implemented Python-side; **UI lock-state ignores it** (P1-H5); hard-crash on blank (P1-M11) |
| 5 (non-fn no "Your Task") | **Bug** — P1-M10 |
| 7 (non-fn default code/null debug) | OK for non-fn; **function-practice debug dropped** (P1-H2) |
| 10/17 (per-language inclusion) | **Not enforced server-side** (P1-C3); **crashes** (P1-C4); **default flag lost** (P1-H1) |
| 11 (PYTHON39 in exam) | OK; untested in isolation |
| 12 (exam metadata null) | OK |
| 13 (exam topic_tag_names {}) | OK |
| 14 (editable title + Save + AI option) | **Done** in `GlobalConfig.tsx` ✓; minor: no confirm-on-edit-after-AI (de-emphasized by final plan) — P1-L1 (hyphen truncation) still applies |
| 16 (default tags textbox) | **Done** in `GlobalConfig.tsx:160-170` ✓ (UI-H1 withdrawn) |
| Timer sync (bug #1) | **Multiple bugs** — P1-M4, L2, L4, UI-L1 |
| Status dynamic (bug #2) | `completed`-via-packaging is **by design** (plan §4.4); real bugs are **substep-overwrites-parent (P1-C2/M2, plan wanted fixed)**, uncoordinated writers (P1-H6), stranded-`processing` on early failure (P1-H7), unsound PID check (P1-H8); verify rerun-invalidation |
| Run/Stop responsiveness (bug #3) | **Multiple bugs vs plan §5.2** — P1-C2 (stop clobbers parent), H3 (no stopping/stopped/3s), H4 (silent no-op on null runId — plan wanted toast+reset), H9 |

---

## Suggested fix order (post-reconciliation — not done yet)
1. **P1-C2 / P1-M2** — persist **substep** status under the composite key; stop should patch only the sub-run (plan §4.4 explicitly wanted this; still unfixed). Biggest driver of status/stop flakiness.
2. **P1-C3 / P1-C4 / P1-H1** — make the language filter actually filter; fix `next(..., None)` crash; fix `default_code` flag when C++ deselected. (Plan-required language filtering.)
3. **P1-H3 / P1-H4** — add `stopping`/`stopped` to `StepStatus` + the 3s machine; on null runId reset to pending + toast (plan §5.2, currently silent no-op).
4. **P1-H6 / P1-H7 / P1-H8** — single coordinated writer for `problems.status`; reset `processing` on early-failure paths; replace `process.kill(pid,0)` liveness with a sound check. Verify rerun **invalidates** `package_platform`/`prepare_platform_json`.
5. **P1-H5** — pass `gqContext()`/`ownerDifficulty` into the wave-graph gate so completed GQ doesn't render downstream as Locked.
6. **P1-H2 / P1-M10** — restore fn-practice `debug_helper_code`; fix non-function "Your Task" omission.
7. **Security (systemic, lower urgency since matches convention):** decide whether `getSession()` should enforce account status app-wide (affects cp-prep **and** upload); pass a minimal `env` to the cp-prep Python child (P2-C2 residual).
