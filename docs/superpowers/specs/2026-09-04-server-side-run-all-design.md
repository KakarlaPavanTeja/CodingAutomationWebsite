# Server-side "Run all steps" orchestration (design)

Date: 2026-09-04
Status: approved, not yet implemented

## Problem

"Run all steps" stops advancing if the operator refreshes the page.

The queue lives only in browser memory — `pipeline-context.tsx:336`,
`const [runAllQueue, setRunAllQueue] = useState<StepId[]>([])`. A grep of the
whole repo finds `runAllQueue` in that one file and nowhere else: it is never
persisted to the database, to `localStorage`, or anywhere on the server.
`pipeline_states` persists the *configuration* (question type, mode, languages,
testcase count, step configs) but not the queue.

So:

1. Operator clicks Run all → the queue is built in React state → an effect
   launches the first ready step.
2. The step runs **server-side** as a detached process; `pipeline_runs` stores
   its `pid`. It is unaffected by anything the browser does.
3. Operator refreshes → React unmounts → `runAllQueue` resets to `[]`.
4. The step finishes server-side and is correctly marked completed.
5. **Nothing is left alive to notice and launch the next step.** The run stalls.

Same outcome on a closed tab, a navigation away, or a laptop sleeping long
enough to drop the page.

## What already exists, and must be reused

The hard part is already done. The orchestration decision logic is ALREADY
extracted into pure, server-importable modules — it does not touch React:

- `src/lib/pipeline-prerequisites.ts` — `isStepReadyForRunAll`,
  `getIncompletePrerequisites`
- `src/lib/pipeline-config.ts` — `getWorkflowSteps`,
  `getPipelineUiWorkflowSteps`, `getStepConfig`
- `src/lib/pipeline-question.ts` — `isQuestionPhaseComplete`
- `src/lib/pipeline-title.ts` — `packagingTitleResolvable`, `titleGatedSteps`

**These must be called, not reimplemented.** The client effect at
`pipeline-context.tsx:2116-2192` encodes behaviour that was arrived at by
fixing real bugs, and its comments say so. Any server-side driver must
preserve, exactly:

- **Concurrent siblings.** Independent steps (editorial / JSON) launch
  together, not one at a time.
- **"Failed prerequisite still queued = being retried."** A step is dropped
  only when a prerequisite has terminally failed AND is not itself queued,
  launching, or running. Dropping too eagerly stalls the chain on a second
  Run All — a bug the current code carries a comment about.
- **Non-blocking steps are dropped on failure, not retried**, so the queue
  keeps draining.
- **Title gating marks steps `skipped` with a reason** rather than silently
  dropping them; dropping only the packaging steps used to leave dependents
  queued forever behind a prerequisite that never ran.
- **No double-launch.** The client uses `launchingStepsRef` to cover the async
  gap between deciding to run a step and that step appearing as `running`.

## The completion hook

`src/app/api/pipeline/run/route.ts` spawns the Python step with
`detached: true` and `proc.unref()`, and registers `proc.on("close", …)`
(~lines 491-526) which writes `status`, `exitCode` and `finishedAt` to
`pipeline_runs`. That handler runs on the server with no browser involved.

**That is where the queue advances.** When a step closes, the server marks it
finished and then asks the same pure helpers what is now ready, and launches it.

### Known fragility this design inherits

`proc.on("close")` only fires while the Node server that spawned the child is
alive. A dev-server restart (or a deploy) loses the handler: the detached
Python process keeps running, but nothing marks the run finished, so the row
stays `running` forever and the queue stalls exactly as it does today.

This is pre-existing — it already strands individual steps — but a durable
queue makes it more visible, because a stalled row now blocks a whole
sequence. The design therefore includes a **reconciler**: on a status read,
any `running` row whose `pid` is no longer alive is marked failed, and the
queue is given a chance to advance. Without it, "the queue is durable" is a
promise the system cannot keep across a restart.

## Design

### 1. The queue is server state

Add `run_all_queue jsonb` to `pipeline_states` (already unique per `problem_id`).
It holds the ordered `StepId[]` still to run, plus enough context to make the
same decisions the client made: `questionType`, `mode`, and the title context
the gating needs.

Why `pipeline_states` rather than a new table: it is already per-problem,
already unique on `problem_id`, already the home of pipeline configuration,
and already read on page load. A queue is pipeline state.

### 2. Step launching becomes callable in-process

`POST /api/pipeline/run` currently contains both the HTTP concerns (auth,
validation) and the spawn. Extract the spawn into a function the route and the
orchestrator both call, so the orchestrator never makes an HTTP request to
itself. An internal caller must not need a session cookie.

### 3. Advancing

On step close, in order: write the terminal status; re-read the queue; ask the
pure helpers which queued steps are ready given current `pipeline_runs` state;
launch them; write the shortened queue back. All under a per-problem guard so
two closes finishing at once cannot double-launch.

### 4. The client becomes an observer

`runAll()` POSTs "start the queue" and returns. The context drops
`runAllQueue`, `setRunAllQueue` and the auto-run effect, and instead reflects
server state fetched by the polling it already does. `isRunAllActive` becomes
"the server says a queue is active for this problem".

This is the part that touches the most code and carries the most regression
risk: `pipeline-context.tsx` is 2,246 lines and is the most-used screen in the
app.

## Out of scope

- Changing what any individual step does, or the Python pipeline.
- Reworking log streaming or the status endpoints beyond what the reconciler needs.
- Multi-user concurrency on one problem beyond the per-problem guard (two
  operators driving the same problem is not a supported workflow today).
