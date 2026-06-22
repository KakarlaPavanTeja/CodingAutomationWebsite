/**
 * Curated release notes grouped by feature area.
 * Based on git history — related commits are merged into one entry.
 */

export type WhatsNewItem = {
  /** Short label shown in the list */
  title: string;
  /** One-line plain-English summary (always visible) */
  summary: string;
  /** Longer explanation shown in the dropdown */
  details: string;
};

export type WhatsNewFeature = {
  id: string;
  /** Feature area title */
  title: string;
  /** ISO date of the latest change in this group */
  date: string;
  /** Optional category pill */
  tag: "Pipeline" | "Testing" | "Editorial" | "Admin" | "Collaboration" | "Reliability";
  /** One-line overview of the whole feature group */
  summary: string;
  items: WhatsNewItem[];
};

export const WHATS_NEW: WhatsNewFeature[] = [
  {
    id: "testcase-quality",
    title: "Test Case Quality Suite",
    date: "2026-06-22",
    tag: "Pipeline",
    summary:
      "Three new pipeline steps that check how strong your test cases are — and automatically fix weak ones.",
    items: [
      {
        title: "Generate Brute Force",
        summary: "Creates a simple backup solution to double-check test case answers.",
        details:
          "After the main question is generated, the pipeline now writes a slow but obviously-correct brute-force solution. " +
          "Test case generation uses both the optimal and brute-force answers to catch mistakes. " +
          "This step always uses the LLM.",
      },
      {
        title: "Benchmark Test Cases",
        summary: "Scores your test suite by injecting fake bugs and seeing if tests catch them.",
        details:
          "This step is read-only — it never changes your files. It makes small changes to the solution code (mutants), " +
          "runs your test cases against each one, and reports a kill rate (how many bugs were caught). " +
          "It also checks size distribution and coverage shape. Pure local execution — no LLM cost.",
      },
      {
        title: "Strengthen Test Cases",
        summary: "Adds new test cases when the benchmark finds gaps — uses LLM only if fuzzing isn't enough.",
        details:
          "If the kill rate is below the target (default 90%), this step first tries free random fuzzing to find killer cases. " +
          "Only when fuzzing can't catch remaining bugs does it call the LLM to propose targeted inputs. " +
          "Verified cases are appended to testcases.json. If your suite is already strong (100% kill rate), " +
          "this step finishes instantly with zero LLM calls.",
      },
      {
        title: "Live progress logs",
        summary: "Benchmark and harden steps now show live progress instead of a blank screen.",
        details:
          "Long-running mutation tests now print heartbeat messages (e.g. 'tested 40/70 mutants') so you can see " +
          "the step is working. Phase markers like [B1], [B2] show which audit is running.",
      },
      {
        title: "LLM usage badges",
        summary: "Every pipeline step now shows whether it uses the LLM.",
        details:
          "Each step card displays a small badge: 'LLM' (always calls), 'LLM (conditional)' (only sometimes), " +
          "or 'No LLM' (pure local). Hover for a tooltip explaining what it means for cost.",
      },
      {
        title: "Run All sequencing fix",
        summary: "Benchmark, harden, and split now run one at a time instead of all crashing together.",
        details:
          "These steps are chained sequentially because they all read and write testcases.json. " +
          "Running them in parallel caused out-of-memory kills on Replit. Run All now retries failed steps " +
          "and waits for each prerequisite to finish before starting the next.",
      },
    ],
  },
  {
    id: "collaboration",
    title: "Share Problems with Team Members",
    date: "2026-06-19",
    tag: "Collaboration",
    summary: "Problem owners can grant other users access to view and run pipelines on shared problems.",
    items: [
      {
        title: "Manage access dialog",
        summary: "Invite members by email and control who can work on a problem.",
        details:
          "From any problem page, owners and admins can open 'Manage access' to add or remove team members. " +
          "Shared members can view outputs, run pipeline steps, and see execution logs — but only the owner or admin can delete the problem.",
      },
    ],
  },
  {
    id: "execution-logs",
    title: "Execution Logs Tab",
    date: "2026-06-19",
    tag: "Testing",
    summary: "See every test case input/output per language, plus run editorial solutions against the suite.",
    items: [
      {
        title: "Per-testcase IO details",
        summary: "A new tab shows exactly what went in and out for each test case, per language.",
        details:
          "The Execution Logs tab on each problem page lists pass/fail for every testcase in every language. " +
          "Expand a row to see the actual stdin, expected output, and what your code produced. " +
          "Updates live while a run is in progress.",
      },
      {
        title: "Execute Editorial Solutions",
        summary: "Run every editorial approach against all test cases in each language.",
        details:
          "A new pipeline step runs each solution from the generated editorial (brute force, optimal, etc.) " +
          "through the full testcase suite. This is informational only — a failure here does not block packaging.",
      },
      {
        title: "Execute Tests UI fix",
        summary: "The execute step progress bar and result cards now always agree.",
        details:
          "Fixed a bug where the per-language status in the step header could show 'running' while the result card " +
          "already showed 'passed'. Both now use the same parser so they stay in sync.",
      },
    ],
  },
  {
    id: "editorial-platform",
    title: "Editorial & Platform Publishing",
    date: "2026-06-18",
    tag: "Editorial",
    summary: "Generate full DSA editorials and export a ready-to-upload platform JSON file.",
    items: [
      {
        title: "Generate Editorial step",
        summary: "AI writes a complete editorial with intuition, approach, pseudocode, and 4-language code.",
        details:
          "After packaging, the pipeline can generate a multi-solution editorial covering brute force through optimal approaches. " +
          "View and edit it in the Editorial tab on each problem page.",
      },
      {
        title: "Prepare Platform JSON",
        summary: "Converts packaged files into coding_questions.json for direct platform upload.",
        details:
          "The final pipeline step assembles LUA, testcases, metadata, and editorial into the exact JSON format " +
          "the platform expects. Download it from the Outputs tab.",
      },
      {
        title: "Parallel editorial + JSON in Run All",
        summary: "Editorial and JSON steps now run at the same time to save time.",
        details:
          "Both steps only need packaging to be done, so Run All launches them concurrently. " +
          "Execute Editorial still waits for the editorial to finish.",
      },
      {
        title: "Download from Outputs tab",
        summary: "One-click download of coding_questions.json and individual output files.",
        details:
          "The Outputs browser now has per-file download buttons, expand/collapse all folders, " +
          "and a direct download for the final platform JSON.",
      },
    ],
  },
  {
    id: "problem-config",
    title: "Custom Score & Difficulty",
    date: "2026-06-19",
    tag: "Pipeline",
    summary: "Set your own difficulty and score on a problem — the pipeline respects your choices.",
    items: [
      {
        title: "Owner-set difficulty and score",
        summary: "Override AI-generated difficulty and points from the problem Overview tab.",
        details:
          "Edit difficulty (Easy / Medium / Hard / AI's choice) and score on any problem. " +
          "Once you set them, the pipeline uses your values as final — it won't overwrite them during generation or packaging.",
      },
      {
        title: "Minimum score enforcement",
        summary: "Scores below 1 are rejected; empty means the AI picks based on difficulty.",
        details:
          "The system validates score input and propagates owner-set values through every pipeline script " +
          "via environment variables, so LUA and platform JSON always reflect your settings.",
      },
    ],
  },
  {
    id: "admin-costs",
    title: "Admin Cost Dashboard",
    date: "2026-06-18",
    tag: "Admin",
    summary: "Track LLM usage and costs per user, per step, with OpenRouter data.",
    items: [
      {
        title: "OpenRouter direct integration",
        summary: "LLM calls go straight to OpenRouter — costs are tracked from real API responses.",
        details:
          "Switched from a proxy gateway to direct OpenRouter calls. Token usage and dollar cost from each response " +
          "are saved to the database and visible in the admin Costs dashboard.",
      },
      {
        title: "Per-user and per-step breakdown",
        summary: "Filter costs by user, date range, model, and pipeline step.",
        details:
          "Admins can see which steps cost the most, which users ran them, and drill into individual LLM calls. " +
          "Editorial generation costs are included in the usage report.",
      },
      {
        title: "Dev environment usage fix",
        summary: "Cost tracking now works correctly in Replit development mode.",
        details:
          "Fixed an issue where usage rows were silently dropped in dev because the internal API URL pointed at the wrong host. " +
          "Pipeline scripts now POST cost data to the local server in dev and the deployment URL in production.",
      },
    ],
  },
  {
    id: "pipeline-reliability",
    title: "Pipeline Reliability Improvements",
    date: "2026-06-18",
    tag: "Reliability",
    summary: "Fewer crashes, better retries, and smarter model selection across the pipeline.",
    items: [
      {
        title: "Testcase model upgrade",
        summary: "Test case generation now uses GPT-5.5 with medium reasoning for better quality.",
        details:
          "Switched from Gemini 2.5 Pro to OpenAI GPT-5.5 for testcase generation after empty-response failures. " +
          "Reasoning effort and token limits were tuned to balance quality vs cost.",
      },
      {
        title: "Race condition fix on problem load",
        summary: "Switching between problems no longer mixes up pipeline state.",
        details:
          "If you opened problem A then quickly opened problem B, stale pollers from A could write into B's state. " +
          "A generation token now aborts superseded loads so only the latest problem's state is active.",
      },
      {
        title: "Streaming retry on disconnect",
        summary: "LLM calls automatically retry when the connection drops mid-stream.",
        details:
          "Long generations (editorial, test cases) can take minutes. If the network severs mid-stream, " +
          "the client retries instead of failing the entire step.",
      },
      {
        title: "Script output sanitization",
        summary: "Generated Python scripts are cleaned so markdown fences don't break execution.",
        details:
          "The LLM sometimes wraps code in ```python blocks. A sanitizer strips these before saving, " +
          "and a one-shot LLM retry fixes scripts that still fail to parse.",
      },
      {
        title: "Consistent function names across languages",
        summary: "Python, C++, Java, and Node.js solutions now use the same function name.",
        details:
          "The code translation step enforces a single function name across all four languages so split-code " +
          "and platform packaging don't break due to naming mismatches.",
      },
    ],
  },
];

/** Most recent N features — used on the homepage teaser */
export function getRecentFeatures(count = 3): WhatsNewFeature[] {
  return WHATS_NEW.slice(0, count);
}
