// Types for the CP problem-prep routine.

/** One worked example from the problem statement, used for verification. */
export interface Example {
  /** Exact text fed to the program on STDIN. */
  input: string;
  /** Expected STDOUT, compared after trimming trailing whitespace per line. */
  expectedOutput: string;
}

/** Input to the routine — what your platform passes in. */
export interface PrepInput {
  /** Problem title (used for slug derivation). */
  title: string;
  /**
   * Raw problem statement. May be HTML (with entities like &le;) or plain text.
   * The routine cleans it into Markdown.
   */
  problemStatement: string;
  /**
   * The reference solution source. OPTIONAL.
   * - If provided, the routine PORTS it to Python and verifies the port.
   * - If omitted, the routine asks Claude to WRITE a solution from the statement,
   *   then verifies that. Either way the output is a verified solution.py.
   */
  referenceSolution?: string;
  /**
   * Language of the reference solution, e.g. "cpp", "java". Only meaningful when
   * referenceSolution is provided; ignored otherwise.
   */
  referenceLanguage?: string;
  /**
   * Worked examples. Strongly recommended: they are what the routine executes
   * the generated Python against. If empty, the routine still generates but
   * the report will flag that no empirical verification was possible.
   */
  examples?: Example[];
  /**
   * Refinement request. OPTIONAL. When present, the routine does NOT generate
   * from scratch — it takes the previously generated outputs below and applies
   * the user's free-text instruction (e.g. "rename variables to match the
   * reference", "tighten the constraints", "fix the off-by-one on empty input"),
   * then re-verifies. Everything not covered by the instruction is preserved.
   */
  refine?: {
    /** Free-text instruction describing the changes to make. */
    instruction: string;
    /** The current problem.md to edit. */
    currentProblemMarkdown: string;
    /** The current solution.py to edit. */
    currentSolutionPython: string;
  };
}

/** Result of one example run during verification. */
export interface ExampleRunResult {
  index: number;
  passed: boolean;
  expected: string;
  actual: string;
  /** Present when the process errored (non-zero exit, timeout, stderr). */
  error?: string;
}

/** What the routine returns. */
export interface PrepResult {
  /** Filename slug derived from the title, e.g. "array_fizzbuzz". */
  slug: string;
  /** Clean Markdown problem statement (the "problem.md" content). */
  problemMarkdown: string;
  /** Verified Python solution source (the "solution.py" content). */
  solutionPython: string;
  /**
   * Whether every provided example passed on the final solution.
   * True also when there were no examples to run (nothing failed) — check
   * `examplesRun` to distinguish "verified" from "nothing to verify".
   */
  verified: boolean;
  /** Number of examples actually executed. 0 means verification was skipped. */
  examplesRun: number;
  /** Per-example results from the final run. */
  exampleResults: ExampleRunResult[];
  /** How many repair attempts were used (0 = generated correctly first try). */
  repairAttempts: number;
  /**
   * Human-readable verification report (the chat-style findings the original
   * skill produced): correctness verdict, any bugs found and fixed, statement
   * issues, inferred constraints. Plain Markdown text.
   */
  report: string;
  /** Aggregated LLM usage for this prep run (tokens + estimated USD). */
  usage?: PrepUsageSummary;
}

/** Aggregated token/cost stats for a full CP prep run. */
export interface PrepUsageSummary {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Rough estimate when OpenRouter does not return USD in the response. */
  estimatedCostUsd: number;
}

export type PrepProgressEvent =
  | { type: "status"; message: string }
  | { type: "warning"; message: string };

/** Per-call LLM usage (see anthropic-usage.ts). */
export interface AnthropicCallUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  callIndex: number;
  isRepair: boolean;
}

/** Tunable options for the routine. */
export interface PrepOptions {
  /** OpenRouter model id. Defaults to OPENROUTER_MODEL_CP_PREP or anthropic/claude-opus-4.5. */
  model?: string;
  /** Max repair attempts after the first generation. Defaults to 3. */
  maxRepairAttempts?: number;
  /** Per-example execution timeout in milliseconds. Defaults to 10000. */
  perExampleTimeoutMs?: number;
  /** Path to the python interpreter. Defaults to "python3". */
  pythonBin?: string;
  /** OpenRouter API key. Defaults to process.env.OPENROUTER_API_KEY. */
  apiKey?: string;
  /** Progress callback for SSE / logging. */
  onProgress?: (event: PrepProgressEvent) => void;
  /** Fired after each LLM call with token counts (and estimated cost). */
  onUsage?: (usage: AnthropicCallUsage) => void;
  /** Abort signal — when the client disconnects, stops further LLM calls. */
  signal?: AbortSignal;
}
