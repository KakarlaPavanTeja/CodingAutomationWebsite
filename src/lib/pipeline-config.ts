import type { PipelineStepConfig, StepId, QuestionType, PipelineMode } from "@/types/pipeline";

export const LANGUAGES = [
  { id: "python", label: "Python", defaultEnabled: true },
  { id: "cpp", label: "C++", defaultEnabled: true },
  { id: "java", label: "Java", defaultEnabled: true },
  { id: "nodejs", label: "Node.js", defaultEnabled: true },
];

export const STEP_CONFIGS: PipelineStepConfig[] = [
  {
    id: "generate_question",
    label: "Generate Question",
    description: "Create description, translate code to multiple languages, generate titles, difficulty, and topics",
    script: "Scripts/generate_full_question.py",
    subSteps: [
      { id: "description", label: "Description", description: "Generate problem description", defaultEnabled: true },
      { id: "codes", label: "Code Translation", description: "Translate solution to all languages", defaultEnabled: true },
      { id: "titles", label: "Titles", description: "Generate title options", defaultEnabled: true },
      { id: "difficulty", label: "Difficulty", description: "Estimate difficulty level", defaultEnabled: true },
      { id: "topics", label: "Topics", description: "Classify problem topics", defaultEnabled: true },
    ],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
  },
  {
    id: "generate_testcases",
    label: "Generate Test Cases",
    description: "Create diverse test cases with configurable count",
    script: "Scripts/testcase_manager.py",
    subSteps: [],
    hasLanguageSelector: false,
    hasTestcaseCount: true,
    needsMode: false,
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
  },
  {
    id: "execute_tests_nonfunction",
    label: "Execute Tests (Non-function)",
    description: "Run test cases against full solutions for each language",
    script: "Scripts/execution_manager_nonfunctionbased.py",
    subSteps: [],
    hasLanguageSelector: true,
    hasTestcaseCount: false,
    needsMode: false,
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
  },
];

export function getWorkflowSteps(questionType: QuestionType, mode: PipelineMode): StepId[] {
  if (questionType === "nonfunction") {
    const steps: StepId[] = [
      "generate_question",
      "generate_testcases",
      "execute_tests_nonfunction",
    ];
    if (mode === "practice") steps.push("generate_enrichment");
    steps.push("package_platform");
    return steps;
  } else {
    const steps: StepId[] = [
      "generate_question",
      "generate_testcases",
      "split_code",
      "execute_tests_function",
    ];
    if (mode === "practice") steps.push("generate_enrichment");
    steps.push("package_platform");
    return steps;
  }
}

export function getStepConfig(stepId: StepId): PipelineStepConfig {
  return STEP_CONFIGS.find((s) => s.id === stepId)!;
}

export function buildCommand(
  stepId: StepId,
  mode: PipelineMode,
  subSteps: string[],
  languages: string[],
  testcaseCount?: number
): { script: string; args: string[] } {
  const config = getStepConfig(stepId);
  const args: string[] = [];

  if (config.subSteps.length > 0 && subSteps.length > 0) {
    args.push("--steps", subSteps.join(","));
  }

  if (config.hasLanguageSelector && languages.length > 0) {
    if (stepId === "execute_tests_function" || stepId === "execute_tests_nonfunction") {
      // These scripts take languages as positional args
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

  return { script: config.script, args };
}
