import type { PipelineStepConfig, StepId, QuestionType, PipelineMode } from "@/types/pipeline";
import { getQuestionSubStepsForType } from "@/lib/pipeline-question";
import { filterLanguagesForCommand, getSplitSubStepsForLanguages } from "@/lib/pipeline-language-steps";

export const LANGUAGES = [
  { id: "python", label: "Python", defaultEnabled: true },
  { id: "cpp", label: "C++", defaultEnabled: true },
  { id: "java", label: "Java", defaultEnabled: true },
  { id: "nodejs", label: "Node.js", defaultEnabled: true },
];

const QUESTION_SUB_STEPS: PipelineStepConfig["subSteps"] = [
  { id: "description", label: "Description", description: "Writes the problem statement, constraints, and sample I/O.", defaultEnabled: true },
  { id: "naming", label: "Naming", description: "Parses the function signature and normalizes the Python solution.", defaultEnabled: true, functionOnly: true },
  { id: "titles", label: "Titles", description: "Produces several short title candidates for the problem.", defaultEnabled: true },
  { id: "difficulty", label: "Difficulty", description: "Estimates Easy, Medium, or Hard from the content.", defaultEnabled: true },
  { id: "topics", label: "Topics", description: "Assigns DSA topic tags such as arrays, graphs, or DP.", defaultEnabled: true },
  { id: "translate_cpp", label: "C++", description: "Translates the reference solution into C++.", defaultEnabled: true },
  { id: "translate_java", label: "Java", description: "Translates the reference solution into Java.", defaultEnabled: true },
  { id: "translate_nodejs", label: "Node.js", description: "Translates the reference solution into Node.js.", defaultEnabled: true },
];

export const STEP_CONFIGS: PipelineStepConfig[] = [
  {
    id: "generate_question",
    label: "Generate Question",
    description:
      "Create description, metadata, and multi-language solutions. Sub-steps run in parallel where dependencies allow.",
    script: "Scripts/generate_full_question.py",
    subSteps: QUESTION_SUB_STEPS,
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "generate_brute_force",
    label: "Generate Brute Force",
    description: "Create a simple brute-force oracle to cross-validate test cases (dual-oracle)",
    script: "Scripts/generate_brute_force.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "generate_question",
  },
  {
    id: "generate_testcases",
    label: "Generate Test Cases",
    description: "Create diverse test cases with configurable count",
    script: "Scripts/testcase_manager_v4.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: true,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "generate_wrong_solutions",
    label: "Generate Wrong Solutions",
    description:
      "Create plausible incorrect Python solutions for the wrong-approach benchmark gate (B2). Uses Claude Sonnet 4.5 via OpenRouter.",
    script: "Scripts/generate_wrong_solutions.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "benchmark_testcases",
    label: "Benchmark Test Cases",
    description:
      "Checks how strong your test cases are: it secretly injects small bugs into the solution and verifies the tests catch them. Read-only — it reports a score and never changes your tests.",
    script: "Scripts/benchmark_suite.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "none",
  },
  {
    id: "harden_testcases",
    label: "Strengthen Test Cases",
    description:
      "Strengthens a weak suite: finds bugs your current tests miss and automatically adds new test cases that catch them, until the kill-rate target is reached.",
    script: "Scripts/harden_suite.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "conditional",
    // Best-effort enhancement: never blocks downstream steps, and a failure is
    // shown as a warning so the pipeline can continue.
    nonBlocking: true,
  },
  {
    id: "split_code",
    label: "Split Code",
    description: "Split solutions into driver, solution, default, and debugger components",
    script: "Scripts/code_splitter.py",
    subSteps: [],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "execute_tests_function",
    label: "Execute Tests (Function-based)",
    description: "Run test cases against split code for each language",
    script: "Scripts/execution_manager_v2.py",
    subSteps: [],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "none",
  },
  {
    id: "execute_tests_nonfunction",
    label: "Execute Tests (Non-function)",
    description: "Run test cases against full solutions for each language",
    script: "Scripts/execution_manager_v2.py",
    subSteps: [],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "none",
  },
  {
    id: "generate_enrichment",
    label: "Generate Enrichment",
    description: "Create hints, follow-up questions, and real-life examples",
    script: "Scripts/enrichment_manager.py",
    subSteps: [
      { id: "reallife", label: "Real-life Examples", description: "Generate real-world scenario examples", defaultEnabled: true },
      { id: "hints", label: "Hints", description: "Generate progressive hints", defaultEnabled: true },
      { id: "followups", label: "Follow-up Questions", description: "Generate variant questions", defaultEnabled: true },
    ],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "package_platform",
    label: "Package for Platform",
    description: "Bundle everything into LUA + testcase files for platform upload",
    script: "Scripts/prepare_lua_and_testcases.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: true,
    llmUsage: "none",
  },
  {
    id: "generate_editorial",
    label: "Generate Editorial",
    description:
      "Write a complete multi-solution DSA editorial (intuition, approach, pseudocode, 4-language code, complexity)",
    script: "Scripts/editorial_manager.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "package_platform",
  },
  {
    id: "prepare_platform_json",
    label: "Prepare Platform JSON",
    description: "Convert the packaged LUA + testcases into the ready-to-upload coding_questions.json",
    script: "Scripts/prepare_platform_json.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: true,
    llmUsage: "none",
    prerequisite: "package_platform",
  },
  {
    id: "execute_editorial",
    label: "Execute Editorial Solutions",
    description: "Run every editorial approach against the testcases in each language (informational — never blocks)",
    script: "Scripts/editorial_execution_manager.py",
    subSteps: [],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "none",
    prerequisite: "generate_editorial",
  },
];

/** Steps always tracked in state for GQ Wave 2 UI even though not in linear workflow. */
export const GQ_EMBEDDED_STEPS: StepId[] = ["generate_brute_force"];

export function getWorkflowSteps(questionType: QuestionType, mode: PipelineMode): StepId[] {
  const core: StepId[] = [
    "generate_question",
    "generate_testcases",
    "generate_wrong_solutions",
    "benchmark_testcases",
    "harden_testcases",
  ];

  if (questionType === "nonfunction") {
    const steps: StepId[] = [...core, "execute_tests_nonfunction"];
    if (mode === "practice") steps.push("generate_enrichment");
    steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
    return steps;
  }

  const steps: StepId[] = [...core, "split_code", "execute_tests_function"];
  if (mode === "practice") steps.push("generate_enrichment");
  steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
  return steps;
}

/** Steps handled on the Editorial tab — hidden from the Pipeline UI and Run all. */
export const EDITORIAL_TAB_STEPS: StepId[] = ["generate_editorial", "execute_editorial"];

export function getPipelineUiWorkflowSteps(questionType: QuestionType, mode: PipelineMode): StepId[] {
  return getWorkflowSteps(questionType, mode).filter((id) => !EDITORIAL_TAB_STEPS.includes(id));
}

/** All step IDs that need state entries (workflow + GQ-embedded steps like brute force). */
export function getAllTrackedStepIds(questionType: QuestionType, mode: PipelineMode): StepId[] {
  const workflow = getWorkflowSteps(questionType, mode);
  const extra = GQ_EMBEDDED_STEPS.filter((id) => !workflow.includes(id));
  return [...workflow, ...extra];
}

export function getStepConfig(stepId: StepId): PipelineStepConfig {
  return STEP_CONFIGS.find((s) => s.id === stepId)!;
}

export function getEnabledQuestionSubSteps(questionType: QuestionType, enabled: string[]): string[] {
  const applicable = new Set(getQuestionSubStepsForType(questionType));
  return enabled.filter((id) => applicable.has(id as never));
}

export function getPrerequisiteStep(
  stepId: StepId,
  workflowSteps: StepId[],
  _questionType?: QuestionType
): StepId | null {
  if (stepId === "generate_enrichment") {
    return "generate_question";
  }
  const config = getStepConfig(stepId);
  if (config.prerequisite) return config.prerequisite;
  const index = workflowSteps.indexOf(stepId);
  if (index <= 0) return null;
  return workflowSteps[index - 1];
}

const SUBSTEP_TO_PY: Record<string, { steps: string; langs?: string }> = {
  description: { steps: "description" },
  naming: { steps: "naming" },
  titles: { steps: "titles" },
  difficulty: { steps: "difficulty" },
  topics: { steps: "topics" },
  translate_cpp: { steps: "codes", langs: "cpp" },
  translate_java: { steps: "codes", langs: "java" },
  translate_nodejs: { steps: "codes", langs: "nodejs" },
};

export function buildCommand(
  stepId: StepId,
  mode: PipelineMode,
  subSteps: string[],
  languages: string[],
  testcaseCount?: number
): { script: string; args: string[] } {
  const config = getStepConfig(stepId);
  const args: string[] = [];

  if (stepId === "generate_question" && subSteps.length > 0) {
    const sub = subSteps[0];
    const mapping = SUBSTEP_TO_PY[sub];
    if (mapping) {
      args.push("--steps", mapping.steps);
      if (mapping.langs) args.push("--langs", mapping.langs);
      return { script: config.script, args };
    }
  }

  if (config.subSteps.length > 0 && subSteps.length > 0) {
    args.push("--steps", subSteps.join(","));
  }

  if (config.hasLanguageSelector && languages.length > 0) {
    const langs = filterLanguagesForCommand(stepId, languages, languages);
    if (langs.length === 0 && stepId === "split_code") {
      args.push("--langs", getSplitSubStepsForLanguages(languages).join(","));
    } else if (
      stepId === "execute_tests_function" ||
      stepId === "execute_tests_nonfunction" ||
      stepId === "execute_editorial"
    ) {
      args.push(...(langs.length ? langs : languages));
    } else if (langs.length > 0) {
      args.push("--langs", langs.join(","));
    }
  }

  if (config.hasTestcaseCount && testcaseCount) {
    args.push("--count", testcaseCount.toString());
  }

  if (config.needsMode) {
    args.push("--mode", mode);
    if (languages.length > 0) {
      args.push("--langs", languages.join(","));
    }
  }

  if (stepId === "execute_tests_nonfunction") {
    args.push("--nonfunction");
  }

  if (stepId === "benchmark_testcases") {
    args.push("--no-gate");
  }

  if (stepId === "harden_testcases") {
    const minKill = process.env.SUITE_MIN_KILL;
    const maxRounds = process.env.SUITE_MAX_ROUNDS;
    if (minKill) args.push("--min-kill", minKill);
    if (maxRounds) args.push("--max-rounds", maxRounds);
  }

  return { script: config.script, args };
}
