import { getStepConfig, getPipelineUiWorkflowSteps, STEP_CONFIGS } from "@/lib/pipeline-config";
import {
  getLangsForStep,
  langStepLabel,
  PARALLEL_LANG_STEPS,
} from "@/lib/pipeline-language-steps";
import {
  getQuestionSubStepPrerequisite,
  getQuestionSubStepWaves,
  getQuestionSubStepsForType,
} from "@/lib/pipeline-question";
import type { QuestionSubStepId, QuestionType, PipelineMode, StepId } from "@/types/pipeline";

export type WaveItemKind = "sub" | "step" | "lang";

export interface PipelineWaveItem {
  kind: WaveItemKind;
  id: QuestionSubStepId | StepId;
  label: string;
  description?: string;
  /** Short label for prerequisite chip, e.g. "Description" */
  requiresLabel: string | null;
  /** False when unchecked in Pipeline Configuration */
  enabledInConfig?: boolean;
  /** For kind=lang — language id (cpp, python, …) */
  langId?: string;
  /** Parent step for kind=lang */
  parentStepId?: StepId;
}

/** Sequential testcase steps shown side-by-side in the wave graph. */
export const TESTCASE_CHAIN_STEPS: StepId[] = [
  "generate_testcases",
  "generate_wrong_solutions",
  "select_testcases",
  "benchmark_testcases",
];


function requiresLabelAfterStep(
  stepId: StepId,
  downstream: StepId[],
  index: number
): { label: string; subtitleSuffix?: string } {
  const prevId = index === 0 ? ("generate_question" as StepId) : downstream[index - 1];
  const label = prevId === "generate_question" ? "Generate Question" : getStepConfig(prevId).label;
  return { label };
}

export interface PipelineWave {
  id: string;
  title: string;
  subtitle: string;
  parallel: boolean;
  /** Side-by-side tile layout (sequential chain or parallel langs). */
  horizontal?: boolean;
  items: PipelineWaveItem[];
}

export interface PipelineSection {
  id: string;
  title: string;
  description: string;
  waves: PipelineWave[];
}

const SUB_LABELS: Record<QuestionSubStepId, string> = {
  description: "Description",
  naming: "Naming & signature",
  titles: "Titles",
  difficulty: "Difficulty",
  topics: "Topics",
  translate_cpp: "Translate to C++",
  translate_java: "Translate to Java",
  translate_nodejs: "Translate to Node.js",
};

function displayLabelForSubStep(subStepId: QuestionSubStepId): string {
  const gq = STEP_CONFIGS.find((s) => s.id === "generate_question");
  const sub = gq?.subSteps.find((s) => s.id === subStepId);
  if (!sub) return SUB_LABELS[subStepId];
  if (subStepId.startsWith("translate_")) return SUB_LABELS[subStepId];
  if (subStepId === "naming") return SUB_LABELS.naming;
  return sub.label;
}

function subStepDescription(subStepId: QuestionSubStepId): string | undefined {
  const gq = STEP_CONFIGS.find((s) => s.id === "generate_question");
  return gq?.subSteps.find((s) => s.id === subStepId)?.description;
}

function subRequiresLabel(
  subStepId: QuestionSubStepId,
  questionType: QuestionType
): string | null {
  const prereq = getQuestionSubStepPrerequisite(subStepId, questionType);
  if (!prereq) return null;
  return SUB_LABELS[prereq];
}

export function buildQuestionSection(
  questionType: QuestionType,
  enabledSubSteps: string[]
): PipelineSection {
  // Always lay out all applicable sub-steps so naming & translations stay visible.
  const applicable = getQuestionSubStepsForType(questionType);
  const waveIds = getQuestionSubStepWaves(questionType, applicable);
  const enabledSet = new Set(enabledSubSteps);

  const waves: PipelineWave[] = waveIds.map((ids, index) => {
    const parallel = ids.length > 1;
    let subtitle = "Entry point";
    if (index > 0 && questionType === "function") {
      if (ids.some((id) => id.startsWith("translate_"))) {
        subtitle = parallel
          ? "Code & brute force — parallel after Naming"
          : "Code generation after Naming";
      } else if (ids.includes("naming")) {
        subtitle = parallel
          ? "Metadata & naming — parallel after Description"
          : "Naming after Description";
      } else {
        subtitle = parallel ? "Runs together after Description completes" : "After Description";
      }
    } else if (index > 0) {
      if (ids.some((id) => id.startsWith("translate_"))) {
        subtitle = parallel
          ? "Code generation — parallel after Description"
          : "Code generation after Description";
      } else {
        subtitle = parallel ? "Runs together after Description completes" : "After Description";
      }
    }

    return {
      id: `gq-wave-${index}`,
      title: parallel ? `Parallel group ${index + 1}` : `Step ${index + 1}`,
      subtitle,
      parallel,
      items: ids.map((id) => ({
        kind: "sub" as const,
        id,
        label: displayLabelForSubStep(id),
        description: subStepDescription(id),
        requiresLabel: subRequiresLabel(id, questionType),
        enabledInConfig: enabledSet.has(id),
      })),
    };
  });

  // Brute force belongs in the code-generation parallel group with translations.
  const bfConfig = getStepConfig("generate_brute_force");
  const bfItem: PipelineWaveItem = {
    kind: "step",
    id: "generate_brute_force",
    label: bfConfig.label,
    description: bfConfig.description,
    requiresLabel: questionType === "function" ? "Naming & signature" : "Description",
  };

  let codeWaveIdx = -1;
  for (let i = waves.length - 1; i >= 0; i--) {
    if (waves[i].items.some((it) => String(it.id).startsWith("translate_"))) {
      codeWaveIdx = i;
      break;
    }
  }

  if (codeWaveIdx >= 0) {
    waves[codeWaveIdx].items.push(bfItem);
    waves[codeWaveIdx].parallel = waves[codeWaveIdx].items.length > 1;
    if (questionType === "function") {
      waves[codeWaveIdx].subtitle = "Code & brute force — parallel after Naming";
    } else {
      waves[codeWaveIdx].subtitle = "Code & brute force — parallel after Description";
    }
  } else {
    waves.push({
      id: "gq-wave-brute-force",
      title: "Step",
      subtitle: questionType === "function" ? "After Naming" : "After Description",
      parallel: false,
      items: [bfItem],
    });
  }

  return {
    id: "generate_question",
    title: "Generate Question",
    description:
      questionType === "function"
        ? "Steps run top to bottom. Items in a dashed box run in parallel once their individual requirement is met."
        : "Steps run top to bottom. Non-function problems skip Naming.",
    waves,
  };
}

export function buildMainPipelineSection(
  questionType: QuestionType,
  mode: PipelineMode,
  enabledLanguages: string[] = []
): PipelineSection {
  const workflow = getPipelineUiWorkflowSteps(questionType, mode);
  const downstream = workflow.filter(
    (id) => id !== "generate_question" && id !== "generate_brute_force"
  );
  const waves: PipelineWave[] = [];

  for (let i = 0; i < downstream.length; i++) {
    const id = downstream[i];

    if (id === TESTCASE_CHAIN_STEPS[0]) {
      const chainIds = TESTCASE_CHAIN_STEPS;
      waves.push({
        id: "main-testcase-chain",
        title: `Step ${waves.length + 1}`,
        subtitle: "Testcase pipeline — sequential after Generate Question",
        parallel: false,
        horizontal: true,
        items: chainIds.map((stepId, idx) => {
          const config = getStepConfig(stepId);
          const prevId =
            idx === 0 ? ("generate_question" as StepId) : chainIds[idx - 1];
          const requiresLabel =
            prevId === "generate_question" ? "Generate Question" : getStepConfig(prevId).label;
          return {
            kind: "step" as const,
            id: stepId,
            label: config.label,
            description: config.description,
            requiresLabel,
          };
        }),
      });
      i += chainIds.length - 1;
      continue;
    }

    const config = getStepConfig(id);
    const req = requiresLabelAfterStep(id, downstream, i);
    const requiresLabel = req.label;

    if (PARALLEL_LANG_STEPS.includes(id)) {
      const langs = getLangsForStep(id, enabledLanguages);
      const executeNote = "";
      waves.push({
        id: `main-${id}`,
        title: `Step ${waves.length + 1}`,
        subtitle:
          langs.length > 1
            ? `Parallel per language — after ${requiresLabel}${req.subtitleSuffix ?? ""}${executeNote}`
            : `After ${requiresLabel}${req.subtitleSuffix ?? ""}${executeNote}`,
        parallel: langs.length > 1,
        horizontal: langs.length > 1,
        items: langs.map((lang) => ({
          kind: "lang" as const,
          id,
          parentStepId: id,
          langId: lang,
          label: langStepLabel(id, lang),
          description: config.description,
          requiresLabel,
        })),
      });
      continue;
    }

    waves.push({
      id: `main-${id}`,
      title: `Step ${waves.length + 1}`,
      subtitle: `After ${requiresLabel}${req.subtitleSuffix ?? ""}`,
      parallel: false,
      items: [
        {
          kind: "step",
          id,
          label: config.label,
          description: config.description,
          requiresLabel,
        },
      ],
    });
  }

  return {
    id: "main_pipeline",
    title: "Test & Package",
    description:
      "Each step waits for the previous stage. Unlocks when Generate Question completes.",
    waves,
  };
}

export function buildPipelineSections(
  questionType: QuestionType,
  mode: PipelineMode,
  enabledSubSteps: string[],
  enabledLanguages: string[] = []
): PipelineSection[] {
  return [
    buildQuestionSection(questionType, enabledSubSteps),
    buildMainPipelineSection(questionType, mode, enabledLanguages),
  ];
}
