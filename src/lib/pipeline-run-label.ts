import { getStepConfig } from "@/lib/pipeline-config";
import { langStepLabel, PARALLEL_LANG_STEPS } from "@/lib/pipeline-language-steps";
import { subStepLogKey } from "@/lib/pipeline-question";
import type { QuestionSubStepId, StepId } from "@/types/pipeline";

const GQ_SUB_LABELS: Record<QuestionSubStepId, string> = {
  description: "Description",
  naming: "Naming & signature",
  titles: "Titles",
  difficulty: "Difficulty",
  topics: "Topics",
  translate_cpp: "Translate to C++",
  translate_java: "Translate to Java",
  translate_nodejs: "Translate to Node.js",
};

const ENRICHMENT_SUB_LABELS: Record<string, string> = {
  reallife: "Real-life examples",
  hints: "Hints",
  followups: "Follow-up questions",
};

/** Canonical run/log key for a pipeline execution. */
export function pipelineRunLogKey(
  stepId: StepId,
  subSteps?: string[],
  runKey?: string
): string {
  if (runKey) return runKey;
  if (stepId === "generate_question" && subSteps?.length === 1) {
    return subStepLogKey(subSteps[0] as QuestionSubStepId);
  }
  return stepId;
}

export interface ParsedPipelineRunStepKey {
  parentStepId: StepId;
  subStepId?: QuestionSubStepId;
  langId?: string;
}

export function parsePipelineRunStepKey(key: string): ParsedPipelineRunStepKey {
  if (key.startsWith("generate_question__")) {
    return {
      parentStepId: "generate_question",
      subStepId: key.slice("generate_question__".length) as QuestionSubStepId,
    };
  }

  if (key.startsWith("generate_enrichment__")) {
    return {
      parentStepId: "generate_enrichment",
      subStepId: key.slice("generate_enrichment__".length) as QuestionSubStepId,
    };
  }

  const sep = key.indexOf("__");
  if (sep > 0) {
    return {
      parentStepId: key.slice(0, sep) as StepId,
      langId: key.slice(sep + 2),
    };
  }

  return { parentStepId: key as StepId };
}

/** Prefer stored composite key; fall back to linked log key, then log content. */
export function resolvePipelineRunStepKey(
  storedStepId: string,
  logStepId: string | null | undefined,
  logContent?: string | null
): string {
  if (storedStepId.includes("__")) return storedStepId;
  if (logStepId && logStepId.includes("__")) return logStepId;

  const fromLogHeader = inferRunStepKeyFromLogHeader(logContent);
  if (fromLogHeader) return fromLogHeader;

  const inferred = inferRunStepKeyFromLog(storedStepId, logContent);
  if (inferred) return inferred;

  return storedStepId;
}

function inferRunStepKeyFromLogHeader(logContent: string | null | undefined): string | null {
  if (!logContent) return null;
  const match = logContent.match(/Starting\s+(generate_question__\w+|generate_enrichment__\w+|\w+__\w+)\.\.\./i);
  return match?.[1] ?? null;
}

function inferRunStepKeyFromLog(storedStepId: string, logContent: string | null | undefined): string | null {
  if (!logContent?.trim()) return null;

  if (storedStepId === "generate_question") {
    const argStep = logContent.match(/--steps\s+(description|naming|titles|difficulty|topics|codes)\b/i);
    if (argStep) {
      const token = argStep[1].toLowerCase();
      if (token !== "codes") {
        return subStepLogKey(token as QuestionSubStepId);
      }
      const langMatch = logContent.match(/--langs\s+(cpp|java|nodejs)\b/i);
      if (langMatch) {
        const lang = langMatch[1].toLowerCase();
        const map: Record<string, QuestionSubStepId> = {
          cpp: "translate_cpp",
          java: "translate_java",
          nodejs: "translate_nodejs",
        };
        if (map[lang]) return subStepLogKey(map[lang]);
      }
    }

    const gqPatterns: Array<{ pattern: RegExp; subStepId: QuestionSubStepId }> = [
      { pattern: /STEP:\s*Description Creation/i, subStepId: "description" },
      { pattern: /STEP:\s*Naming Enforcement/i, subStepId: "naming" },
      { pattern: /STEP:\s*Generating Titles/i, subStepId: "titles" },
      { pattern: /STEP:\s*Generating Difficulty/i, subStepId: "difficulty" },
      { pattern: /STEP:\s*Generating Topics/i, subStepId: "topics" },
    ];
    for (const { pattern, subStepId } of gqPatterns) {
      if (pattern.test(logContent)) return subStepLogKey(subStepId);
    }
    if (/STEP:\s*Converting to Other Languages/i.test(logContent)) {
      if (/\b(?:--langs\s+|\blangs:\s*)cpp\b/i.test(logContent)) {
        return subStepLogKey("translate_cpp");
      }
      if (/\b(?:--langs\s+|\blangs:\s*)java\b/i.test(logContent)) {
        return subStepLogKey("translate_java");
      }
      if (/\b(?:--langs\s+|\blangs:\s*)nodejs\b/i.test(logContent)) {
        return subStepLogKey("translate_nodejs");
      }
    }
  }

  if (storedStepId === "generate_enrichment") {
    const match = logContent.match(/--steps\s+([a-z_,]+)/i);
    if (match) {
      const parts = match[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 1) return `${storedStepId}__${parts[0]}`;
      if (parts.length > 1) {
        return `${storedStepId}__${parts.map((p) => ENRICHMENT_SUB_LABELS[p] ?? p).join(", ")}`;
      }
    }
  }

  for (const stepId of PARALLEL_LANG_STEPS) {
    if (storedStepId !== stepId) continue;
    const langsMatch = logContent.match(/--langs\s+([a-z_,]+)/i);
    if (langsMatch) {
      const langs = langsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (langs.length === 1) return `${stepId}__${langs[0]}`;
    }
    for (const lang of ["python", "cpp", "java", "nodejs"]) {
      if (new RegExp(`\\b(?:--langs\\s+|^|\\s)${lang}\\b`, "im").test(logContent)) {
        return `${stepId}__${lang}`;
      }
    }
  }

  return null;
}

function parentStepLabel(stepId: StepId): string {
  try {
    return getStepConfig(stepId).label;
  } catch {
    return stepId;
  }
}

export interface PipelineRunStepDisplay {
  step: string;
  substep: string;
  combined: string;
}

export function formatPipelineRunStepDisplay(key: string): PipelineRunStepDisplay {
  const parsed = parsePipelineRunStepKey(key);
  const step = parentStepLabel(parsed.parentStepId);

  if (parsed.subStepId && parsed.parentStepId === "generate_enrichment") {
    const substep = ENRICHMENT_SUB_LABELS[parsed.subStepId] ?? parsed.subStepId;
    return { step, substep, combined: `${step} · ${substep}` };
  }

  if (parsed.subStepId) {
    const substep = GQ_SUB_LABELS[parsed.subStepId] ?? parsed.subStepId;
    return { step, substep, combined: `${step} · ${substep}` };
  }

  if (parsed.langId) {
    const substep = langStepLabel(parsed.parentStepId, parsed.langId);
    return { step, substep, combined: `${step} · ${substep}` };
  }

  if (key.startsWith("generate_enrichment__")) {
    const raw = key.slice("generate_enrichment__".length);
    if (raw.includes(", ")) {
      return { step, substep: raw, combined: `${step} · ${raw}` };
    }
  }

  // Atomic step — the substep name is the step itself (e.g. Generate Test Cases).
  return { step, substep: step, combined: step };
}
