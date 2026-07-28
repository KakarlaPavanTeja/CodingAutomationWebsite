/**
 * Attach a manually-run pipeline output tree to the platform: creates the
 * `problems` row, uploads Inputs/ + Outputs/ to object storage, and records
 * `llm_usage` rows marking the content as Claude-generated.
 *
 * Everything about the problem is derived from the run tree itself — the
 * headers in Inputs/problem.md and the packaged coding_questions.json — so
 * there is nothing to hand-edit between questions.
 *
 * Dry run (default) prints every write and touches nothing:
 *   npx tsx scripts/attach-manual-run.mts --run ~/cp-questions/q1-rubrik-towers
 * Execute:
 *   npx tsx scripts/attach-manual-run.mts --run ~/cp-questions/q1-rubrik-towers --execute
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const REPO = "/Users/kakarlapavanteja/Content/CodingAutomationWebsite";
loadEnv({ path: path.join(REPO, ".env.local"), quiet: true });

const OWNER = "a1581635-8be3-441f-ba39-12cb39f1dc93"; // kakarla.pavanteja@nxtwave.co.in
const EXECUTE = process.argv.includes("--execute");

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const runArg = arg("--run");
if (!runArg) throw new Error("--run <dir> is required (the pipeline run tree)");
const RUN = path.resolve(runArg.replace(/^~(?=$|\/)/, os.homedir()));

/**
 * Re-upload a run tree over an already-attached problem. A pipeline session can
 * keep rebuilding after the attach, which leaves the platform serving a stale
 * suite; this refreshes the artifacts without minting a new problem id or
 * duplicating the llm_usage rows.
 */
const REFRESH = arg("--refresh");

/** Platform language enum in coding_questions.json -> `problems.languages` value. */
const LANG: Record<string, string> = {
  PYTHON: "python",
  CPP: "cpp",
  JAVA: "java",
  NODE_JS: "nodejs",
};

/** Read the `# Header: value` lines the pipeline expects at the top of problem.md. */
async function readHeaders(): Promise<Record<string, string>> {
  const md = await readFile(path.join(RUN, "Inputs", "problem.md"), "utf8");
  const out: Record<string, string> = {};
  for (const line of md.split("\n").slice(0, 12)) {
    const m = /^#\s*([^:]+):\s*(.+)$/.exec(line.trim());
    if (m) out[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return out;
}

async function buildProblem() {
  const h = await readHeaders();
  const pkg = JSON.parse(
    await readFile(path.join(RUN, "Outputs", "forJSONPreparation", "coding_questions.json"), "utf8"),
  );
  const q = Array.isArray(pkg) ? pkg[0] : pkg;

  const languages = q.coding_question_details.map((c: { language: string }) => {
    const mapped = LANG[c.language];
    if (!mapped) throw new Error(`unknown language in package: ${c.language}`);
    return mapped;
  });

  const name = h["problem"] ?? q.question.short_text;
  if (!name) throw new Error("could not determine problem name");

  return {
    createdBy: OWNER,
    name,
    questionType: h["question type"] ?? "function",
    structureType: h["type"] ?? "standard",
    mode: "practice",
    scenarioLevel: h["scenario level"] ?? "none",
    difficulty: String(q.question.difficulty).toLowerCase(),
    score: q.total_score,
    languages,
    status: "completed",
  };
}

/** One row per LLM-backed pipeline step. Tokens/cost are 0 — these were produced
 *  in a Claude Code session, not through OpenRouter, so there is no spend to report. */
const LLM_STEPS = [
  { stepId: "generate_question", purpose: "chat" },
  { stepId: "generate_brute_force", purpose: "brute_force" },
  { stepId: "generate_testcases", purpose: "testcases" },
  { stepId: "generate_wrong_solutions", purpose: "wrong_solutions" },
  { stepId: "generate_enrichment", purpose: "enrichment" },
  { stepId: "generate_editorial", purpose: "editorial" },
];
const MODEL = "claude-opus-5";
const ACCOUNT = "claude-code";

/** Mirrors object-storage.ts toS3Key(): AWS_OBJECT_KEY_PREFIX + normalized path. */
function toS3Key(objectPath: string): string {
  const raw = process.env.AWS_OBJECT_KEY_PREFIX?.trim() ?? "";
  const prefix = !raw
    ? ""
    : (() => {
        const n = raw.replace(/\\/g, "/").replace(/^\/+/, "");
        if (n.includes("..")) throw new Error("Invalid AWS_OBJECT_KEY_PREFIX");
        return n.endsWith("/") ? n : `${n}/`;
      })();
  const normalized = objectPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error(`Invalid object path: ${objectPath}`);
  return prefix + normalized;
}

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (_s3) return _s3;
  _s3 = new S3Client({
    region: process.env.AWS_REGION!.trim(),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
    },
  });
  return _s3;
}

async function putObject(objectPath: string, content: Buffer): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME!.trim(),
      Key: toS3Key(objectPath),
      Body: content,
    }),
  );
}

async function walk(dir: string, base = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.name === ".DS_Store" || entry.name === "__pycache__") continue;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function main() {
  if (!existsSync(RUN)) throw new Error(`run tree not found: ${RUN}`);
  const PROBLEM = await buildProblem();

  const inputs = await walk(path.join(RUN, "Inputs"));
  const outputs = await walk(path.join(RUN, "Outputs"));

  let bytes = 0;
  for (const [dir, files] of [["Inputs", inputs], ["Outputs", outputs]] as const) {
    for (const f of files) bytes += (await stat(path.join(RUN, dir, f))).size;
  }

  console.log(EXECUTE ? "=== EXECUTING ===" : "=== DRY RUN (no writes) ===");
  console.log(`run:  ${RUN}`);
  console.log(`mode: ${REFRESH ? `REFRESH existing problem ${REFRESH}` : "ATTACH new problem"}`);
  console.log(`\n[1] problems row${REFRESH ? " (update score/difficulty only)" : ""}`);
  console.log(JSON.stringify(PROBLEM, null, 2));
  console.log("\n[2] object storage");
  console.log(`    ${inputs.length} input file(s), ${outputs.length} output file(s), ${(bytes / 1024).toFixed(0)} KB total`);
  console.log(`    keys: <problemId>/inputs/*  and  <problemId>/outputs/*`);
  for (const f of inputs) console.log(`      inputs/${f}`);
  for (const f of outputs.slice(0, 10)) console.log(`      outputs/${f}`);
  if (outputs.length > 10) console.log(`      ... ${outputs.length - 10} more`);
  console.log("\n[3] llm_usage rows");
  if (REFRESH) {
    console.log("    skipped — the rows from the original attach still stand");
  } else {
    console.log(`    ${LLM_STEPS.length} rows | model=${MODEL} account=${ACCOUNT} tokens=0 cost=0`);
    for (const s of LLM_STEPS) console.log(`      ${s.stepId.padEnd(26)} purpose=${s.purpose}`);
  }

  if (!EXECUTE) {
    console.log("\nNothing written. Re-run with --execute to apply.");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    let problemId: string;

    if (REFRESH) {
      const [existing] = await sql`
        select id, name from problems where id = ${REFRESH} and deleted_at is null`;
      if (!existing) throw new Error(`no live problem with id ${REFRESH}`);
      if (existing.name !== PROBLEM.name) {
        throw new Error(
          `refusing to refresh: ${REFRESH} is "${existing.name}" but this run is ` +
            `"${PROBLEM.name}". Wrong problem id?`,
        );
      }
      problemId = existing.id;
      console.log(`\n  refreshing existing problem: ${problemId}`);
    } else {
      // Re-running this script would otherwise silently create a second copy.
      const dupes = await sql`
        select id from problems
        where created_by = ${OWNER} and name = ${PROBLEM.name} and deleted_at is null`;
      if (dupes.length > 0) {
        throw new Error(
          `"${PROBLEM.name}" is already attached (${dupes.map((d) => d.id).join(", ")}). ` +
            `Re-run with --refresh <id> to overwrite its artifacts, or rename this run.`,
        );
      }

      const [row] = await sql`
        insert into problems
          (created_by, name, question_type, structure_type, mode, scenario_level,
           difficulty, score, languages, status)
        values
          (${PROBLEM.createdBy}, ${PROBLEM.name}, ${PROBLEM.questionType},
           ${PROBLEM.structureType}, ${PROBLEM.mode}, ${PROBLEM.scenarioLevel},
           ${PROBLEM.difficulty}, ${PROBLEM.score}, ${PROBLEM.languages}, ${PROBLEM.status})
        returning id`;
      problemId = row.id;
      console.log(`\n  problems row created: ${problemId}`);
    }

    let uploaded = 0;
    for (const [dir, files, prefix] of [
      ["Inputs", inputs, "inputs"],
      ["Outputs", outputs, "outputs"],
    ] as const) {
      for (const f of files) {
        await putObject(`${problemId}/${prefix}/${f}`, await readFile(path.join(RUN, dir, f)));
        uploaded++;
      }
    }
    console.log(`  uploaded ${uploaded} file(s) to object storage`);

    // A rebuilt suite can change the score/difficulty, so keep the row in step.
    await sql`
      update problems
      set storage_path = ${problemId}, score = ${PROBLEM.score},
          difficulty = ${PROBLEM.difficulty}, updated_at = now()
      where id = ${problemId}`;
    console.log(`  storage_path / score / difficulty synced`);

    if (REFRESH) {
      console.log(`  llm_usage untouched (original attach already recorded it)`);
      console.log(`\nDone. problem id = ${problemId}`);
      return;
    }

    for (const s of LLM_STEPS) {
      await sql`
        insert into llm_usage
          (problem_id, user_id, model, purpose, prompt_tokens, completion_tokens,
           total_tokens, cost_usd, problem_name, step_id, account)
        values
          (${problemId}, ${OWNER}, ${MODEL}, ${s.purpose}, 0, 0, 0, '0',
           ${PROBLEM.name}, ${s.stepId}, ${ACCOUNT})`;
    }
    console.log(`  ${LLM_STEPS.length} llm_usage row(s) written`);
    console.log(`\nDone. problem id = ${problemId}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
