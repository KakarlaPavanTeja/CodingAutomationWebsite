/**
 * Scale per-test-case weightage while preserving relative proportions.
 * Port of prepare_platform_json._scale_weights_to_total (Python pipeline).
 */

export const WEIGHT_FLOOR = 0.01;

export const CODING_QUESTIONS_PATH = "forJSONPreparation/coding_questions.json";

export type TestCaseLike = { weightage?: unknown };

export type PlatformQuestion = {
  test_cases?: TestCaseLike[];
  total_score?: unknown;
  [key: string]: unknown;
};

export type ScaledQuestionMeta = {
  fileName: string;
  targetMarks: number;
  originalTotalScore: number | null;
  testCaseCount: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Lift any <=0 weight to WEIGHT_FLOOR, borrowing from the largest donor when possible. */
export function ensurePositiveWeights(weights: number[]): number[] {
  if (weights.length === 0) return weights;
  const out = [...weights];
  for (let i = 0; i < out.length; i++) {
    if (out[i] > WEIGHT_FLOOR) continue;
    const deficit = round2(WEIGHT_FLOOR - out[i]);
    out[i] = WEIGHT_FLOOR;
    const donors = out
      .map((w, j) => ({ w, j }))
      .filter(({ w, j }) => j !== i && w > WEIGHT_FLOOR)
      .sort((a, b) => b.w - a.w);
    for (const { j } of donors) {
      if (round2(out[j] - deficit) >= WEIGHT_FLOOR) {
        out[j] = round2(out[j] - deficit);
        break;
      }
    }
  }
  return out;
}

/**
 * Scale test-case weightage to sum exactly to totalScore, preserving proportions.
 * Returns false if any weight is missing or <= 0 (caller should error).
 */
export function scaleWeightsToTotal(testCases: TestCaseLike[], totalScore: number): boolean {
  const n = testCases.length;
  if (n === 0) return true;

  const raw: (number | null)[] = testCases.map((tc) => {
    const w = Number(tc.weightage);
    return Number.isFinite(w) && w > 0 ? w : null;
  });
  if (raw.some((w) => w === null)) return false;

  const sum = raw.reduce((a, b) => a! + b!, 0)!;
  if (sum <= 0) return false;

  let weights = raw.map((w) => round2((w! / sum) * totalScore));
  const diff = round2(totalScore - weights.reduce((a, b) => a + b, 0));
  if (diff !== 0) {
    const j = weights.indexOf(Math.max(...weights));
    weights[j] = round2(weights[j] + diff);
  }
  weights = ensurePositiveWeights(weights);

  testCases.forEach((tc, i) => {
    tc.weightage = weights[i];
  });
  return true;
}

export function readOriginalTotalScore(question: PlatformQuestion): number | null {
  const direct = Number(question.total_score);
  if (Number.isFinite(direct) && direct > 0) return round2(direct);
  const cases = question.test_cases ?? [];
  if (cases.length === 0) return null;
  let sum = 0;
  for (const tc of cases) {
    const w = Number(tc.weightage);
    if (!Number.isFinite(w) || w <= 0) return null;
    sum += w;
  }
  return round2(sum);
}

/** Deep-clone a question object and scale its test weights to targetMarks. */
export function scaleQuestionJson(question: PlatformQuestion, targetMarks: number): PlatformQuestion {
  if (!Number.isFinite(targetMarks) || targetMarks <= 0) {
    throw new Error("Target marks must be a positive number");
  }
  const copy = structuredClone(question) as PlatformQuestion;
  const testCases = copy.test_cases ?? [];
  if (!scaleWeightsToTotal(testCases, targetMarks)) {
    throw new Error("Invalid or missing weightage in test cases");
  }
  copy.total_score = targetMarks;
  return copy;
}

/** Parse an uploaded coding_questions.json or single question object. */
export function parseQuestionInput(raw: string): PlatformQuestion {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file");
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new Error("JSON array is empty — expected at least one question");
    }
    return parsed[0] as PlatformQuestion;
  }
  if (parsed && typeof parsed === "object") {
    return parsed as PlatformQuestion;
  }
  throw new Error("Expected a question object or array of questions");
}

export function buildExamJsonFromQuestions(
  items: Array<{ question: PlatformQuestion; marks: number; fileName: string }>,
  totalExamMarks: number,
): { examJson: PlatformQuestion[]; meta: ScaledQuestionMeta[] } {
  if (items.length === 0) {
    throw new Error("At least one question is required");
  }
  const marksSum = sumQuestionMarks(items.map((i) => ({ marks: i.marks })));
  if (Math.abs(marksSum - totalExamMarks) > 0.01) {
    throw new Error(
      `Per-question marks sum to ${marksSum}, but total exam marks is ${totalExamMarks}`,
    );
  }

  const examJson: PlatformQuestion[] = [];
  const meta: ScaledQuestionMeta[] = [];

  for (let i = 0; i < items.length; i++) {
    const { question, marks, fileName } = items[i];
    const originalTotalScore = readOriginalTotalScore(question);
    const testCaseCount = question.test_cases?.length ?? 0;
    try {
      examJson.push(scaleQuestionJson(question, marks));
    } catch (e) {
      const label = fileName || `Question ${i + 1}`;
      throw new Error(`${label}: ${(e as Error).message}`);
    }
    meta.push({
      fileName: fileName || `question-${i + 1}.json`,
      targetMarks: marks,
      originalTotalScore,
      testCaseCount,
    });
  }

  return { examJson, meta };
}

/** Parse stored coding_questions.json (array with one question per element). */
export function parseCodingQuestionsFile(raw: string): PlatformQuestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in coding_questions.json");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("coding_questions.json must be a non-empty array");
  }
  return parsed as PlatformQuestion[];
}

/** Take the first question entry from a problem's platform JSON file. */
export function extractQuestionFromFile(raw: string): PlatformQuestion {
  const items = parseCodingQuestionsFile(raw);
  return items[0];
}

export function sumQuestionMarks(rows: { marks: number }[]): number {
  return round2(rows.reduce((a, r) => a + r.marks, 0));
}

export function distributeMarksEvenly(totalMarks: number, count: number): number[] {
  if (count <= 0) return [];
  if (totalMarks <= 0) return Array(count).fill(0);
  const base = round2(totalMarks / count);
  const weights = Array(count).fill(base);
  const diff = round2(totalMarks - weights.reduce((a, b) => a + b, 0));
  if (diff !== 0) {
    weights[weights.length - 1] = round2(weights[weights.length - 1] + diff);
  }
  return weights;
}
