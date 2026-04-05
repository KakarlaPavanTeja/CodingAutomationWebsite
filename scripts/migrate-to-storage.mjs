/**
 * One-time migration script: uploads existing local problem files to Supabase Storage.
 *
 * Usage:
 *   node scripts/migrate-to-storage.mjs
 *
 * Requires .env.local to be loaded (or set env vars manually):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPELINE_ROOT
 */

import { createClient } from "@supabase/supabase-js";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// Load .env.local
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PIPELINE_ROOT = process.env.PIPELINE_ROOT;
const BUCKET = process.env.STORAGE_BUCKET || "pipeline-files";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PIPELINE_ROOT) {
  console.error("Missing required env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPELINE_ROOT");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const storage = supabase.storage.from(BUCKET);

async function walkDir(dir, base = "") {
  const results = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await walkDir(fullPath, rel)));
      } else {
        if (entry.name === ".DS_Store" || entry.name.includes("__pycache__")) continue;
        results.push({ relativePath: rel, fullPath });
      }
    }
  } catch {
    // directory may not exist
  }
  return results;
}

async function uploadFile(storagePath, localPath) {
  const content = await readFile(localPath);
  const { error } = await storage.upload(storagePath, content, { upsert: true });
  if (error) {
    console.error(`  FAIL: ${storagePath} — ${error.message}`);
    return false;
  }
  return true;
}

async function migrateProblem(problemId) {
  const problemDir = path.join(PIPELINE_ROOT, "problems", problemId);
  let uploaded = 0;
  let failed = 0;

  // Upload Inputs
  const inputsDir = path.join(problemDir, "Inputs");
  const inputFiles = await walkDir(inputsDir);
  for (const file of inputFiles) {
    const storagePath = `${problemId}/inputs/${file.relativePath}`;
    const ok = await uploadFile(storagePath, file.fullPath);
    if (ok) uploaded++;
    else failed++;
  }

  // Upload Outputs
  const outputsDir = path.join(problemDir, "Outputs");
  const outputFiles = await walkDir(outputsDir);
  for (const file of outputFiles) {
    const storagePath = `${problemId}/outputs/${file.relativePath}`;
    const ok = await uploadFile(storagePath, file.fullPath);
    if (ok) uploaded++;
    else failed++;
  }

  // Upload Logs + insert into pipeline_logs table
  const logsDir = path.join(problemDir, "logs");
  const logFiles = await walkDir(logsDir);
  for (const file of logFiles) {
    // Upload to storage
    const storagePath = `${problemId}/logs/${file.relativePath}`;
    const ok = await uploadFile(storagePath, file.fullPath);
    if (ok) uploaded++;
    else failed++;

    // Insert into pipeline_logs table
    const stepId = path.basename(file.relativePath, ".log");
    const content = await readFile(file.fullPath, "utf-8");

    // Find the most recent pipeline_run for this problem+step
    const { data: run } = await supabase
      .from("pipeline_runs")
      .select("id")
      .eq("problem_id", problemId)
      .eq("step_id", stepId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (run) {
      await supabase.from("pipeline_logs").upsert(
        {
          problem_id: problemId,
          step_id: stepId,
          run_id: run.id,
          content,
        },
        { onConflict: "run_id" }
      );
    }
  }

  return { uploaded, failed };
}

async function main() {
  console.log(`Migrating from: ${PIPELINE_ROOT}/problems/`);
  console.log(`Bucket: ${BUCKET}\n`);

  // Ensure bucket exists
  const { data: buckets } = await supabase.storage.listBuckets();
  const bucketExists = buckets?.some((b) => b.name === BUCKET);
  if (!bucketExists) {
    console.log(`Creating bucket: ${BUCKET}`);
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error) {
      console.error(`Failed to create bucket: ${error.message}`);
      process.exit(1);
    }
  }

  const problemsDir = path.join(PIPELINE_ROOT, "problems");
  let entries;
  try {
    entries = await readdir(problemsDir);
  } catch {
    console.error(`Cannot read: ${problemsDir}`);
    process.exit(1);
  }

  let totalUploaded = 0;
  let totalFailed = 0;

  for (const entry of entries) {
    const fullPath = path.join(problemsDir, entry);
    const s = await stat(fullPath);
    if (!s.isDirectory()) continue;

    console.log(`\nMigrating problem: ${entry}`);
    const { uploaded, failed } = await migrateProblem(entry);
    console.log(`  Uploaded: ${uploaded}, Failed: ${failed}`);
    totalUploaded += uploaded;
    totalFailed += failed;
  }

  // Also upload shared inputs for future reference
  console.log("\nUploading shared inputs...");
  const sharedDir = path.join(PIPELINE_ROOT, "Inputs");
  const sharedFiles = await walkDir(sharedDir);
  for (const file of sharedFiles) {
    const ok = await uploadFile(`shared/inputs/${file.relativePath}`, file.fullPath);
    if (ok) totalUploaded++;
    else totalFailed++;
  }

  console.log("\nUploading reference files...");
  const refDir = path.join(PIPELINE_ROOT, "zReferenceFiles");
  const refFiles = await walkDir(refDir);
  for (const file of refFiles) {
    const ok = await uploadFile(`shared/reference/${file.relativePath}`, file.fullPath);
    if (ok) totalUploaded++;
    else totalFailed++;
  }

  console.log(`\n--- Migration complete ---`);
  console.log(`Total uploaded: ${totalUploaded}`);
  console.log(`Total failed: ${totalFailed}`);
}

main().catch(console.error);
