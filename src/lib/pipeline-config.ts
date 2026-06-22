import type { PipelineStepConfig, StepId, QuestionType, PipelineMode } from "@/types/pipeline";

export const LANGUAGES = [
  { id: "python", label: "Python", defaultEnabled: true },
  { id: "cpp", label: "C++", defaultEnabled: true },
  { id: "java", label: "Java", defaultEnabled: true },
  { id: "nodejs", label: "Node.js", defaultEnabled: true },
];

const QUESTION_GEN_SCRIPT = "Scripts/generate_full_question.py";

const QUESTION_GENERATION_STEPS: PipelineStepConfig[] = [
  {
    id: "generate_description",
    label: "Generate Description",
    description: "Create the full problem description in a single LLM call",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
  },
  {
    id: "enforce_naming",
    label: "Enforce Naming",
    description: "Extract the function signature from the description and normalize source code naming",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "generate_description",
  },
  {
    id: "generate_titles",
    label: "Generate Titles",
    description: "Generate title options for the problem",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "generate_description",
  },
  {
    id: "generate_difficulty",
    label: "Estimate Difficulty",
    description: "Estimate the problem difficulty level",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "generate_description",
  },
  {
    id: "generate_topics",
    label: "Classify Topics",
    description: "Classify problem topics from the topics list",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "generate_description",
  },
  {
    id: "translate_cpp",
    label: "Translate to C++",
    description: "Translate the Python solution to C++",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "enforce_naming",
  },
  {
    id: "translate_java",
    label: "Translate to Java",
    description: "Translate the Python solution to Java",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "enforce_naming",
  },
  {
    id: "translate_nodejs",
    label: "Translate to Node.js",
    description: "Translate the Python solution to Node.js",
    script: QUESTION_GEN_SCRIPT,
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "llm",
    prerequisite: "enforce_naming",
  },
];

export const STEP_CONFIGS: PipelineStepConfig[] = [
  ...QUESTION_GENERATION_STEPS,
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
    description: "Checks how strong your test cases are: it secretly injects small bugs into the solution and verifies the tests catch them. Read-only — it reports a score and never changes your tests.",
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
    description: "Strengthens a weak suite: finds bugs your current tests miss and automatically adds new test cases that catch them, until the kill-rate target is reached.",
    script: "Scripts/harden_suite.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: false,
    needsMode: false,
    llmUsage: "conditional",
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
    description: "Write a complete multi-solution DSA editorial (intuition, approach, pseudocode, 4-language code, complexity)",
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

/** Question-generation steps that can run in parallel once their prerequisite is met. */
export function getQuestionGenerationSteps(questionType: QuestionType): StepId[] {
  const steps: StepId[] = ["generate_description"];
  if (questionType === "function") {
    steps.push("enforce_naming");
  }
  steps.push("generate_titles", "generate_difficulty", "generate_topics");
  steps.push("translate_cpp", "translate_java", "translate_nodejs");
  return steps;
}

export function getWorkflowSteps(questionType: QuestionType, mode: PipelineMode): StepId[] {
  const afterGeneration: StepId[] = [
    "generate_brute_force",
    "generate_testcases",
    "generate_wrong_solutions",
    "benchmark_testcases",
    "harden_testcases",
  ];

  if (questionType === "nonfunction") {
    const steps: StepId[] = [...getQuestionGenerationSteps(questionType), ...afterGeneration];
    steps.push("execute_tests_nonfunction");
    if (mode === "practice") steps.push("generate_enrichment");
    steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
    return steps;
  }

  const steps: StepId[] = [...getQuestionGenerationSteps(questionType), ...afterGeneration];
  steps.push("split_code", "execute_tests_function");
  if (mode === "practice") steps.push("generate_enrichment");
  steps.push("package_platform", "generate_editorial", "prepare_platform_json", "execute_editorial");
  return steps;
}

export function getStepConfig(stepId: StepId): PipelineStepConfig {
  return STEP_CONFIGS.find((s) => s.id === stepId)!;
}

/**
 * Returns the step that must complete before `stepId` can run, given a workflow.
 * If the step declares an explicit `prerequisite`, that is used (with adjustments
 * for question type); otherwise it falls back to the immediately-previous step in
 * the workflow array. Returns `null` when the step has no prerequisite.
 */
export function getPrerequisiteStep(
  stepId: StepId,
  workflowSteps: StepId[],
  questionType?: QuestionType
): StepId | null {
  // Non-function problems skip naming — translations depend on description only.
  if (
    questionType === "nonfunction" &&
    (stepId === "translate_cpp" || stepId === "translate_java" || stepId === "translate_nodejs")
  ) {
    return "generate_description";
  }

  if (stepId === "generate_brute_force") {
    return questionType === "function" ? "enforce_naming" : "generate_description";
  }

  const config = getStepConfig(stepId);
  if (config.prerequisite) return config.prerequisite;

  const index = workflowSteps.indexOf(stepId);
  if (index <= 0) return null;
  return workflowSteps[index - 1];
}

const QUESTION_STEP_ARGS: Partial<Record<StepId, string[]>> = {
  generate_description: ["--steps", "description"],
  enforce_naming: ["--steps", "naming"],
  generate_titles: ["--steps", "titles"],
  generate_difficulty: ["--steps", "difficulty"],
  generate_topics: ["--steps", "topics"],
  translate_cpp: ["--steps", "codes", "--langs", "cpp"],
  translate_java: ["--steps", "codes", "--langs", "java"],
  translate_nodejs: ["--steps", "codes", "--langs", "nodejs"],
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

  const questionArgs = QUESTION_STEP_ARGS[stepId];
  if (questionArgs) {
    args.push(...questionArgs);
    return { script: config.script, args };
  }

  if (config.subSteps.length > 0 && subSteps.length > 0) {
    args.push("--steps", subSteps.join(","));
  }

  if (config.hasLanguageSelector && languages.length > 0) {
    if (
      stepId === "execute_tests_function" ||
      stepId === "execute_tests_nonfunction" ||
      stepId === "execute_editorial"
    ) {
      args.push(...languages);
    } else {
      args.push("--langs", languages.join(","));
    }
  }

  if (config.hasTestcaseCount && testcaseCount) {
    args.push("--count", testcaseCount.toString());
  }

  if (config.needsMode) {
    args.push("--mode", mode);
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
    if (minKill) {
      args.push("--min-kill", minKill);
    }
    if (maxRounds) {
      args.push("--max-rounds", maxRounds);
    }
  }

  return { script: config.script, args };
}
