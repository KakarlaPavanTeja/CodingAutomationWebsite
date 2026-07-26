import type { StepId, StepState } from "@/types/pipeline";

/**
 * Data-dependency graph: for each step, the steps whose OUTPUT it consumes.
 * This is distinct from the linear unlock chain in pipeline-prerequisites.ts —
 * it captures which steps actually become STALE when an upstream step re-runs,
 * so we only re-run what's genuinely affected (confirmed with the user):
 *   - split_code depends on Generate Question, NOT testcases
 *   - generate_enrichment depends on Generate Question only
 *   - generate_brute_force feeds testcases AND editorial
 *   - select_testcases consumes the suite AND the wrong solutions (and benchmarks
 *     the selected suite in the same pass — no separate benchmark step).
 */
export const STEP_DATA_DEPS: Record<StepId, StepId[]> = {
  generate_question: [],
  generate_brute_force: ["generate_question"],
  generate_testcases: ["generate_question", "generate_brute_force"],
  generate_wrong_solutions: ["generate_testcases"],
  select_testcases: ["generate_testcases", "generate_wrong_solutions"],
  split_code: ["generate_question"],
  execute_tests_function: ["split_code", "generate_testcases"],
  execute_tests_nonfunction: ["generate_testcases"],
  generate_enrichment: ["generate_question"],
  package_platform: [
    "generate_testcases",
    "split_code",
    "generate_enrichment",
    "execute_tests_function",
    "execute_tests_nonfunction",
  ],
  generate_editorial: ["package_platform", "generate_brute_force"],
  prepare_platform_json: ["package_platform", "generate_editorial"],
  execute_editorial: ["generate_editorial", "generate_testcases"],
};

/** All transitive upstream steps whose output `stepId` (in)directly consumes. */
export function getTransitiveUpstream(stepId: StepId): StepId[] {
  const seen = new Set<StepId>();
  const stack = [...(STEP_DATA_DEPS[stepId] ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(STEP_DATA_DEPS[cur] ?? []));
  }
  return [...seen];
}

/** Direct + transitive downstream steps that consume `stepId`'s output. */
export function getTransitiveDependents(stepId: StepId): StepId[] {
  const out = new Set<StepId>();
  const all = Object.keys(STEP_DATA_DEPS) as StepId[];
  for (const candidate of all) {
    if (candidate !== stepId && getTransitiveUpstream(candidate).includes(stepId)) {
      out.add(candidate);
    }
  }
  return [...out];
}

/**
 * Steps that are STALE: completed, but a transitive data-dependency completed
 * MORE RECENTLY (i.e. an upstream was re-run after them). Restricted to the
 * steps tracked for this problem. Timestamp comparison needs no extra state —
 * re-running an upstream bumps its endTime above all of its downstream.
 */
export function computeAffectedSteps(
  stepStates: Map<StepId, StepState>,
  trackedSteps: StepId[]
): Set<StepId> {
  const tracked = new Set(trackedSteps);
  const completed = (id: StepId) => stepStates.get(id)?.status === "completed";
  const endTime = (id: StepId) => stepStates.get(id)?.endTime ?? null;

  // Effective upstream completion time for the (upstream → downstream) edge.
  // generate_brute_force runs CONCURRENTLY with the translate sub-steps inside
  // the generate_question phase, so the phase endTime (= last translate, which
  // finishes after brute force) is always later than brute force's — a false
  // "stale" on the very first run. Brute force only depends on the `naming`
  // sub-step (its normalized solution + signature), so compare against that
  // sub-step's endTime instead. A genuine later re-run of naming still bumps
  // its endTime above brute force's and correctly marks it stale.
  const upstreamEnd = (up: StepId, down: StepId): number | null => {
    if (up === "generate_question" && down === "generate_brute_force") {
      const gq = stepStates.get("generate_question");
      return (
        gq?.subStepRuns?.naming?.endTime ??
        gq?.subStepRuns?.description?.endTime ??
        gq?.endTime ??
        null
      );
    }
    return endTime(up);
  };

  const affected = new Set<StepId>();
  for (const step of trackedSteps) {
    if (!completed(step)) continue;
    const sEnd = endTime(step);
    if (sEnd == null) continue;
    for (const up of getTransitiveUpstream(step)) {
      if (!tracked.has(up) || !completed(up)) continue;
      const uEnd = upstreamEnd(up, step);
      if (uEnd != null && uEnd > sEnd) {
        affected.add(step);
        break;
      }
    }
  }
  return affected;
}
