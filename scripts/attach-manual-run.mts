/**
 * Attach a manually-run pipeline output tree to the platform: creates the
 * `problems` row, uploads Inputs/ + Outputs/ to object storage, and records
 * `llm_usage` rows marking the content as Claude-generated.
 *
 * Dry run (default) prints every write and touches nothing:
 *   npx tsx attach_problem.mts
 * Execute:
 *   npx tsx attach_problem.mts --execute
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const REPO = "/Users/kakarlapavanteja/Content/CodingAutomationWebsite";
loadEnv({ path: path.join(REPO, ".env.local"), quiet: true });

const RUN = "/private/tmp/claude-501/-Users-kakarlapavanteja-Downloads/e9dbab6f-6f02-40d1-a9df-34b63374234b/scratchpad/run";
const OWNER = "a1581635-8be3-441f-ba39-12cb39f1dc93"; // kakarla.pavanteja@nxtwave.co.in
const EXECUTE = process.argv.includes("--execute");

const PROBLEM = {
  createdBy: OWNER,
  name: "Message Requirement Fulfillment",
  questionType: "function",
  structureType: "standard",
  mode: "practice",
  scenarioLevel: "none",
  difficulty: "easy",
  score: 100,
  languages: ["python", "cpp", "java", "nodejs"],
  status: "completed",
};

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

  const inputs = await walk(path.join(RUN, "Inputs"));
  const outputs = await walk(path.join(RUN, "Outputs"));

  let bytes = 0;
  for (const [dir, files] of [["Inputs", inputs], ["Outputs", outputs]] as const) {
    for (const f of files) bytes += (await stat(path.join(RUN, dir, f))).size;
  }

  console.log(EXECUTE ? "=== EXECUTING ===" : "=== DRY RUN (no writes) ===");
  console.log("\n[1] problems row");
  console.log(JSON.stringify(PROBLEM, null, 2));
  console.log("\n[2] object storage");
  console.log(`    ${inputs.length} input file(s), ${outputs.length} output file(s), ${(bytes / 1024).toFixed(0)} KB total`);
  console.log(`    keys: <problemId>/inputs/*  and  <problemId>/outputs/*`);
  for (const f of inputs) console.log(`      inputs/${f}`);
  for (const f of outputs.slice(0, 10)) console.log(`      outputs/${f}`);
  if (outputs.length > 10) console.log(`      ... ${outputs.length - 10} more`);
  console.log("\n[3] llm_usage rows");
  console.log(`    ${LLM_STEPS.length} rows | model=${MODEL} account=${ACCOUNT} tokens=0 cost=0`);
  for (const s of LLM_STEPS) console.log(`      ${s.stepId.padEnd(26)} purpose=${s.purpose}`);

  if (!EXECUTE) {
    console.log("\nNothing written. Re-run with --execute to apply.");
    return;
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const [row] = await sql`
      insert into problems
        (created_by, name, question_type, structure_type, mode, scenario_level,
         difficulty, score, languages, status)
      values
        (${PROBLEM.createdBy}, ${PROBLEM.name}, ${PROBLEM.questionType},
         ${PROBLEM.structureType}, ${PROBLEM.mode}, ${PROBLEM.scenarioLevel},
         ${PROBLEM.difficulty}, ${PROBLEM.score}, ${PROBLEM.languages}, ${PROBLEM.status})
      returning id`;
    const problemId: string = row.id;
    console.log(`\n  problems row created: ${problemId}`);

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

    await sql`update problems set storage_path = ${problemId}, updated_at = now() where id = ${problemId}`;
    console.log(`  storage_path set`);

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
