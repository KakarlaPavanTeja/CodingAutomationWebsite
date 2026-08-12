/**
 * Pipeline file sync module.
 *
 * All pipeline files live in Replit App Storage (object storage).
 * Python scripts still need local files, so we:
 *   - Download inputs to a temp dir before spawning Python
 *   - Periodically upload outputs during execution
 *   - Upload final outputs + logs on completion
 *   - Clean up the temp dir afterward
 *
 * The UI reads from App Storage, with a local `pipeline/problems/<id>/Inputs/`
 * mirror for dev environments where object storage is unavailable or inputs
 * were never persisted to the bucket.
 */

import { mkdir, writeFile, readFile, readdir, stat, rm, cp } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineLogs, pipelineRuns } from "@/lib/db/schema";
import {
  putObject,
  getObjectBuffer,
  getObjectString,
  listObjects,
} from "@/lib/object-storage";
import type { OutputFile } from "@/types/pipeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Walk a local directory recursively, returning relative paths. */
async function walkDir(dir: string, base = ""): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...(await walkDir(path.join(dir, entry.name), rel)));
      } else {
        results.push(rel);
      }
    }
  } catch {
    // dir may not exist
  }
  return results;
}

function localInputsDir(problemId: string): string {
  const pipelineRoot = process.env.PIPELINE_ROOT || path.join(process.cwd(), "pipeline");
  return path.join(pipelineRoot, "problems", problemId, "Inputs");
}

function localOutputsDir(problemId: string): string {
  const pipelineRoot = process.env.PIPELINE_ROOT || path.join(process.cwd(), "pipeline");
  return path.join(pipelineRoot, "problems", problemId, "Outputs");
}

async function mirrorInputFileLocally(
  problemId: string,
  name: string,
  content: Buffer | string,
): Promise<void> {
  const dir = localInputsDir(problemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), content);
}

/** Copy every file from a workspace Inputs/ dir into the local mirror. */
export async function mirrorInputsFromDir(problemId: string, inputsDir: string): Promise<void> {
  const files = await walkDir(inputsDir);
  for (const rel of files) {
    const base = path.basename(rel);
    if (!isUserProblemInput(base)) continue;
    try {
      const content = await readFile(path.join(inputsDir, rel));
      await mirrorInputFileLocally(problemId, rel, content);
    } catch {
      // skip unreadable files
    }
  }
}

/** Pipeline-owned reference files — injected at run time, not user uploads. */
export const PIPELINE_REFERENCE_INPUTS = new Set(["topics_list.txt"]);

function isUserProblemInput(name: string): boolean {
  return !PIPELINE_REFERENCE_INPUTS.has(name);
}

async function listLocalInputFiles(problemId: string): Promise<OutputFile[]> {
  const dir = localInputsDir(problemId);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const results: OutputFile[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === ".DS_Store") continue;
      if (!isUserProblemInput(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      const s = await stat(filePath);
      results.push({
        path: entry.name,
        name: entry.name,
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
        isDirectory: false,
      });
    }
    return results;
  } catch {
    return [];
  }
}

async function readLocalInputFile(problemId: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(localInputsDir(problemId), filePath), "utf-8");
  } catch {
    return null;
  }
}

function sortInputFiles(files: OutputFile[]): OutputFile[] {
  return files.sort((a, b) => {
    const rank = (name: string) => {
      if (name === "problem.md") return 0;
      if (name.startsWith("solution.")) return 1;
      return 2;
    };
    const diff = rank(a.name) - rank(b.name);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Upload operations
// ---------------------------------------------------------------------------

/** Upload a single file to storage. Overwrites if exists. */
export async function uploadFile(
  storagePath: string,
  content: Buffer | string,
): Promise<void> {
  await putObject(storagePath, content);
}

/** Upload problem input files (problem.md, solution, etc.) to storage. */
export async function uploadInputFiles(
  problemId: string,
  files: { name: string; content: Buffer }[],
): Promise<void> {
  for (const file of files) {
    await mirrorInputFileLocally(problemId, file.name, file.content);
    await uploadFile(`${problemId}/inputs/${file.name}`, file.content);
  }
}

/** Upload a single output file to storage and the local Outputs mirror. */
export async function uploadOutputFile(
  problemId: string,
  name: string,
  content: Buffer | string,
): Promise<void> {
  const dir = localOutputsDir(problemId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), content);
  await uploadFile(`${problemId}/outputs/${name}`, content);
}

/** Upload shared pipeline reference inputs (deprecated — references are copied at run time only). */
export async function uploadSharedInputs(
  problemId: string,
  sharedInputsDir: string,
): Promise<void> {
  void problemId;
  void sharedInputsDir;
  // topics_list.txt and similar live in pipeline/Inputs/ and are copied into the
  // temp workspace when a step runs — they should not be stored per-problem.
}

/** Walk a local directory and upload all files to storage under a prefix. */
export async function uploadDirToStorage(
  localDir: string,
  storagePrefix: string,
): Promise<number> {
  const files = await walkDir(localDir);
  let count = 0;
  for (const relPath of files) {
    if (relPath.includes(".DS_Store") || relPath.includes("__pycache__")) continue;
    const localPath = path.join(localDir, relPath);
    const content = await readFile(localPath);
    await uploadFile(`${storagePrefix}/${relPath}`, content);
    count++;
  }
  return count;
}

/** Upload outputs from a local Outputs/ directory to storage. */
export async function uploadOutputsFromDir(
  problemId: string,
  localOutputsDir: string,
): Promise<number> {
  return uploadDirToStorage(localOutputsDir, `${problemId}/outputs`);
}

// Logs live in object storage, never in Postgres. Storing them in a TOASTed
// text column meant every PIPELINE_LOG_SYNC_MS rewrite left the previous copy
// behind as dead tuples, which is what filled the database disk.
export const stepLogKey = (problemId: string, stepId: string) =>
  `${problemId}/logs/${stepId}.log`;
export const runLogKey = (problemId: string, stepId: string, runId: string) =>
  `${problemId}/logs/runs/${stepId}/${runId}.log`;

// A live sync re-uploads the log every few seconds, so sending the whole file
// each time costs O(n²) bandwidth over a run that reaches tens of MB. The
// viewer only follows the end of the log, so stream a tail while running; the
// full log is written once on exit. ponytail: tail cap, switch to multipart
// append if the viewer ever needs the head of a running step.
const LIVE_LOG_MAX_BYTES = 256 * 1024;

function liveTail(content: string): string {
  if (content.length <= LIVE_LOG_MAX_BYTES) return content;
  const tail = content.slice(-LIVE_LOG_MAX_BYTES);
  const nl = tail.indexOf("\n");
  return `[log truncated while running — full log written when the step finishes]\n${
    nl >= 0 ? tail.slice(nl + 1) : tail
  }`;
}

/** Live run: publish the tail so the viewer can follow along. Storage only. */
export async function syncLogToStorage(
  problemId: string,
  stepId: string,
  runId: string,
  content: string,
): Promise<void> {
  if (!runId) return;
  await uploadFile(runLogKey(problemId, stepId, runId), liveTail(content));
}

/** End of run: persist the complete log, replacing the live tail. */
export async function uploadLog(
  problemId: string,
  stepId: string,
  runId: string,
  content: string,
): Promise<void> {
  await uploadFile(stepLogKey(problemId, stepId), content);
  if (runId) {
    await uploadFile(runLogKey(problemId, stepId, runId), content);
  }
}

// ---------------------------------------------------------------------------
// Download operations
// ---------------------------------------------------------------------------

/** Read a single file from storage as string. */
export async function readStorageFile(
  problemId: string,
  filePath: string,
  subfolder = "outputs",
): Promise<string> {
  if (subfolder === "inputs") {
    try {
      return await getObjectString(`${problemId}/inputs/${filePath}`);
    } catch {
      const local = await readLocalInputFile(problemId, filePath);
      if (local != null) return local;
      throw new Error(`File not found: ${filePath}`);
    }
  }
  return getObjectString(`${problemId}/${subfolder}/${filePath}`);
}

/** Read a single file from storage as Buffer. */
export async function readStorageFileBuffer(
  problemId: string,
  filePath: string,
  subfolder = "outputs",
): Promise<Buffer> {
  return getObjectBuffer(`${problemId}/${subfolder}/${filePath}`);
}

/** Write/overwrite a single output file in storage. */
export async function writeStorageFile(
  problemId: string,
  filePath: string,
  content: string,
  subfolder = "outputs",
): Promise<void> {
  await uploadFile(`${problemId}/${subfolder}/${filePath}`, content);
}

/** List all input files for a problem (flat files under inputs/). */
export async function listInputFiles(problemId: string): Promise<OutputFile[]> {
  const byName = new Map<string, OutputFile>();

  try {
    const prefix = `${problemId}/inputs/`;
    const items = await listObjects(prefix);
    for (const item of items) {
      const relativePath = item.name.slice(prefix.length);
      if (!relativePath || relativePath.includes("/")) continue;
      if (!isUserProblemInput(relativePath)) continue;

      byName.set(relativePath, {
        path: relativePath,
        name: relativePath,
        size: item.size,
        modifiedAt: item.updated,
        isDirectory: false,
      });
    }
  } catch {
    // Object storage may be unavailable in local dev.
  }

  for (const file of await listLocalInputFiles(problemId)) {
    if (!byName.has(file.name)) byName.set(file.name, file);
  }

  return sortInputFiles([...byName.values()]);
}

/** List all output files for a problem (recursive). Returns OutputFile[]. */
export async function listOutputFiles(problemId: string): Promise<OutputFile[]> {
  const prefix = `${problemId}/outputs/`;
  const items = await listObjects(prefix);

  const dirs = new Set<string>();
  const results: OutputFile[] = [];

  for (const item of items) {
    // item.name is like "{problemId}/outputs/generatedFullCode/PYTHON.py"
    const relativePath = item.name.slice(prefix.length);
    if (!relativePath) continue;

    const parts = relativePath.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dirPath = parts.slice(0, i).join("/");
      if (!dirs.has(dirPath)) {
        dirs.add(dirPath);
        results.push({
          path: dirPath,
          name: parts[i - 1],
          size: 0,
          modifiedAt: "",
          isDirectory: true,
        });
      }
    }

    results.push({
      path: relativePath,
      name: parts[parts.length - 1],
      size: item.size,
      modifiedAt: item.updated,
      isDirectory: false,
    });
  }

  return results;
}

/** Download all output files for a problem. Returns array of {path, buffer}. */
export async function downloadAllOutputs(
  problemId: string,
): Promise<{ path: string; buffer: Buffer }[]> {
  const prefix = `${problemId}/outputs/`;
  const items = await listObjects(prefix);

  const results: { path: string; buffer: Buffer }[] = [];
  for (const item of items) {
    const relativePath = item.name.slice(prefix.length);
    if (!relativePath) continue;
    try {
      const buffer = await getObjectBuffer(item.name);
      results.push({ path: relativePath, buffer });
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

/**
 * Every run's log for a problem, read from the pipeline_logs table (one row per
 * run). Object storage keeps only the latest run per step, so the DB is the
 * complete historical record — this lets the export include past runs too.
 * Files are named logs/runs/<step>/<startedAt>__<status>__<runId8>.log so they
 * sort chronologically per step.
 */
export async function exportRunLogsFromDb(
  problemId: string,
): Promise<{ path: string; buffer: Buffer }[]> {
  const rows = await db
    .select({
      runId: pipelineLogs.runId,
      stepId: pipelineLogs.stepId,
      content: pipelineLogs.content,
      startedAt: pipelineRuns.startedAt,
      status: pipelineRuns.status,
    })
    .from(pipelineLogs)
    .leftJoin(pipelineRuns, eq(pipelineLogs.runId, pipelineRuns.id))
    .where(eq(pipelineLogs.problemId, problemId))
    .orderBy(pipelineLogs.stepId, desc(pipelineRuns.startedAt));

  const results: { path: string; buffer: Buffer }[] = [];
  for (const r of rows) {
    if (!r.content) continue;
    const step = (r.stepId || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
    const ts = r.startedAt
      ? new Date(r.startedAt).toISOString().replace(/[:.]/g, "-")
      : "unknown-time";
    const status = r.status || "unknown";
    const runShort = (r.runId || "no-run").slice(0, 8);
    results.push({
      path: `logs/runs/${step}/${ts}__${status}__${runShort}.log`,
      buffer: Buffer.from(r.content, "utf-8"),
    });
  }
  return results;
}

/** Read a log from object storage. Missing object -> null. */
async function getLogFromStorage(key: string): Promise<string | null> {
  try {
    return await getObjectString(key);
  } catch {
    return null;
  }
}

/**
 * Logs written before the move to object storage still live in pipeline_logs.
 * Only read once storage has come up empty; scripts/archive-pipeline-logs.mts
 * drains these, and this fallback can go once it has run everywhere.
 */
async function getLegacyDbLog(
  problemId: string,
  stepId: string,
  runId?: string,
): Promise<string | null> {
  const where = runId
    ? eq(pipelineLogs.runId, runId)
    : and(eq(pipelineLogs.problemId, problemId), eq(pipelineLogs.stepId, stepId));
  const rows = await db
    .select({ content: pipelineLogs.content })
    .from(pipelineLogs)
    .where(where)
    .orderBy(desc(pipelineLogs.createdAt))
    .limit(1);
  return rows[0]?.content ?? null;
}

/** Get log content — object storage, falling back to pre-migration DB rows. */
export async function getLogContent(
  problemId: string,
  stepId: string,
  runId?: string,
): Promise<string | null> {
  if (runId) {
    return (
      (await getLogFromStorage(runLogKey(problemId, stepId, runId))) ??
      (await getLegacyDbLog(problemId, stepId, runId))
    );
  }

  // When a step is in-flight, only return that run's log (empty until first sync).
  const activeRun = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.problemId, problemId),
        eq(pipelineRuns.stepId, stepId),
        eq(pipelineRuns.status, "running"),
      ),
    )
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);

  if (activeRun[0]) {
    return (
      (await getLogFromStorage(runLogKey(problemId, stepId, activeRun[0].id))) ??
      (await getLegacyDbLog(problemId, stepId, activeRun[0].id)) ??
      ""
    );
  }

  return (
    (await getLogFromStorage(stepLogKey(problemId, stepId))) ??
    (await getLegacyDbLog(problemId, stepId))
  );
}

// ---------------------------------------------------------------------------
// Temp workspace management
// ---------------------------------------------------------------------------

/**
 * Create a temporary workspace for a pipeline step execution.
 * Downloads inputs from App Storage, copies Scripts and reference files
 * from the Docker image (or local path).
 */
export async function createTempWorkspace(problemId: string): Promise<string> {
  // Unique per call: when several steps for the same problem launch in the same
  // millisecond (parallel GQ substeps, or testcases + enrichment), a Date.now()
  // -only name collided so two runs shared one dir — and one run's cleanup
  // (rm -rf) then yanked the dir out from under the other, failing it instantly
  // with no log. The random suffix guarantees an isolated workspace per run.
  const tmpDir = path.join(
    os.tmpdir(),
    `pipeline-${problemId}-${Date.now()}-${randomUUID().slice(0, 8)}`
  );
  const inputsDir = path.join(tmpDir, "Inputs");
  const outputsDir = path.join(tmpDir, "Outputs");
  const logsDir = path.join(tmpDir, "logs");

  await mkdir(inputsDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  // Download input files from App Storage
  const inputPrefix = `${problemId}/inputs/`;
  try {
    const inputItems = await listObjects(inputPrefix);
    for (const item of inputItems) {
      const relativePath = item.name.slice(inputPrefix.length);
      if (!relativePath) continue;
      try {
        const buf = await getObjectBuffer(item.name);
        const localPath = path.join(inputsDir, relativePath);
        await mkdir(path.dirname(localPath), { recursive: true });
        await writeFile(localPath, buf);
        await mirrorInputFileLocally(problemId, relativePath, buf);
      } catch {
        // skip
      }
    }
  } catch {
    // Object storage may be unavailable in local dev.
  }

  // Supplement from the local Inputs mirror when cloud is empty or unavailable.
  const localMirror = localInputsDir(problemId);
  if (existsSync(localMirror)) {
    const entries = await readdir(localMirror, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name === ".DS_Store") continue;
      const dest = path.join(inputsDir, entry.name);
      if (!existsSync(dest)) {
        await cp(path.join(localMirror, entry.name), dest);
      }
    }
  }

  // Download any previously generated outputs (for re-running later steps)
  const outputPrefix = `${problemId}/outputs/`;
  const outputItems = await listObjects(outputPrefix);
  for (const item of outputItems) {
    const relativePath = item.name.slice(outputPrefix.length);
    if (!relativePath) continue;
    const localPath = path.join(outputsDir, relativePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    try {
      const buf = await getObjectBuffer(item.name);
      await writeFile(localPath, buf);
    } catch {
      // skip
    }
  }

  // Copy Scripts from Docker image or local path
  const pipelineRoot = process.env.PIPELINE_ROOT || path.join(process.cwd(), "pipeline");
  const scriptsSource =
    process.env.PIPELINE_SCRIPTS_DIR || path.join(pipelineRoot, "Scripts");

  if (existsSync(scriptsSource)) {
    await cp(scriptsSource, path.join(tmpDir, "Scripts"), { recursive: true });
  }

  // Copy shared inputs (topics_list.txt etc.) — only if not already downloaded from storage
  const sharedInputsSource =
    process.env.PIPELINE_SHARED_INPUTS_DIR || path.join(pipelineRoot, "Inputs");

  if (existsSync(sharedInputsSource)) {
    const sharedEntries = await readdir(sharedInputsSource);
    for (const entry of sharedEntries) {
      if (entry === "problem.md" || entry.startsWith("solution.") || entry === ".DS_Store") continue;
      const dest = path.join(inputsDir, entry);
      if (!existsSync(dest)) {
        await cp(path.join(sharedInputsSource, entry), dest);
      }
    }
  }

  // Copy reference files
  const refSource =
    process.env.PIPELINE_REFERENCE_DIR || path.join(pipelineRoot, "zReferenceFiles");

  if (existsSync(refSource)) {
    await cp(refSource, path.join(tmpDir, "zReferenceFiles"), { recursive: true });
  }

  return tmpDir;
}

/** Remove a temporary workspace. */
export async function cleanupTempDir(tmpDir: string): Promise<void> {
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

// ---------------------------------------------------------------------------
// Periodic sync (for live progress during execution)
// ---------------------------------------------------------------------------

/**
 * Start a periodic sync that uploads new/changed outputs every N ms.
 * Returns a stop function.
 */
export function startPeriodicSync(
  problemId: string,
  localOutputsDir: string,
  intervalMs = 30_000,
): { stop: () => Promise<void> } {
  const knownFiles = new Map<string, number>(); // path → last modified time
  let stopped = false;
  // Large artifacts (testcases JSON, etc.) are uploaded once at step end.
  const maxPeriodicBytes = Math.max(
    0,
    parseInt(process.env.PIPELINE_SYNC_MAX_FILE_BYTES || "524288", 10) || 524288,
  );

  const sync = async () => {
    try {
      const files = await walkDir(localOutputsDir);
      for (const relPath of files) {
        if (relPath.includes(".DS_Store") || relPath.includes("__pycache__")) continue;
        const localPath = path.join(localOutputsDir, relPath);
        const s = await stat(localPath);
        const mtime = s.mtimeMs;

        if (!knownFiles.has(relPath) || knownFiles.get(relPath)! < mtime) {
          if (maxPeriodicBytes > 0 && s.size > maxPeriodicBytes) continue;
          const content = await readFile(localPath);
          await uploadFile(`${problemId}/outputs/${relPath}`, content);
          knownFiles.set(relPath, mtime);
        }
      }
    } catch {
      // Non-fatal — will retry next interval
    }
  };

  const tick = async () => {
    if (stopped) return;
    await sync();
  };

  const interval = setInterval(tick, intervalMs);

  return {
    stop: async () => {
      clearInterval(interval);
      // Final sync to catch anything written in the last interval
      await sync();
      stopped = true;
    },
  };
}
