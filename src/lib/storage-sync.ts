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
 * The UI (read, save, list, download) reads exclusively from App Storage.
 */

import { mkdir, writeFile, readFile, readdir, stat, rm, cp } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { pipelineLogs } from "@/lib/db/schema";
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
    await uploadFile(`${problemId}/inputs/${file.name}`, file.content);
  }
}

/** Upload shared inputs (topics_list.txt) for a problem. */
export async function uploadSharedInputs(
  problemId: string,
  sharedInputsDir: string,
): Promise<void> {
  try {
    const entries = await readdir(sharedInputsDir);
    for (const entry of entries) {
      if (entry === "problem.md" || entry.startsWith("solution.") || entry === ".DS_Store") continue;
      const filePath = path.join(sharedInputsDir, entry);
      const s = await stat(filePath);
      if (s.isFile()) {
        const content = await readFile(filePath);
        await uploadFile(`${problemId}/inputs/${entry}`, content);
      }
    }
  } catch {
    // shared inputs dir may not exist
  }
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

/** Upload a log file content + save to pipeline_logs table. */
export async function uploadLog(
  problemId: string,
  stepId: string,
  runId: string,
  content: string,
): Promise<void> {
  // Upload to storage as backup
  await uploadFile(`${problemId}/logs/${stepId}.log`, content);

  // Upsert into pipeline_logs table for fast retrieval
  await db
    .insert(pipelineLogs)
    .values({
      problemId,
      stepId,
      runId,
      content,
    })
    .onConflictDoUpdate({
      target: pipelineLogs.runId,
      set: { content, createdAt: new Date() },
    });
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

/** Get log content from pipeline_logs table. */
export async function getLogContent(
  problemId: string,
  stepId: string,
  runId?: string,
): Promise<string | null> {
  if (runId) {
    // Bind the runId lookup to the caller-validated problemId/stepId so a
    // user with access to one problem can't fetch another problem's logs by
    // guessing/leaking a runId. (IDOR fix.)
    const rows = await db
      .select({ content: pipelineLogs.content })
      .from(pipelineLogs)
      .where(
        and(
          eq(pipelineLogs.runId, runId),
          eq(pipelineLogs.problemId, problemId),
          eq(pipelineLogs.stepId, stepId),
        ),
      )
      .limit(1);
    return rows[0]?.content ?? null;
  }

  const rows = await db
    .select({ content: pipelineLogs.content })
    .from(pipelineLogs)
    .where(and(eq(pipelineLogs.problemId, problemId), eq(pipelineLogs.stepId, stepId)))
    .orderBy(desc(pipelineLogs.createdAt))
    .limit(1);
  return rows[0]?.content ?? null;
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
  const tmpDir = path.join(os.tmpdir(), `pipeline-${problemId}-${Date.now()}`);
  const inputsDir = path.join(tmpDir, "Inputs");
  const outputsDir = path.join(tmpDir, "Outputs");
  const logsDir = path.join(tmpDir, "logs");

  await mkdir(inputsDir, { recursive: true });
  await mkdir(outputsDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });

  // Download input files from App Storage
  const inputPrefix = `${problemId}/inputs/`;
  const inputItems = await listObjects(inputPrefix);
  for (const item of inputItems) {
    const relativePath = item.name.slice(inputPrefix.length);
    if (!relativePath) continue;
    try {
      const buf = await getObjectBuffer(item.name);
      const localPath = path.join(inputsDir, relativePath);
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, buf);
    } catch {
      // skip
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
  const scriptsSource =
    process.env.PIPELINE_SCRIPTS_DIR ||
    (process.env.PIPELINE_ROOT ? path.join(process.env.PIPELINE_ROOT, "Scripts") : null);

  if (scriptsSource && existsSync(scriptsSource)) {
    await cp(scriptsSource, path.join(tmpDir, "Scripts"), { recursive: true });
  }

  // Copy shared inputs (topics_list.txt etc.) — only if not already downloaded from storage
  const sharedInputsSource =
    process.env.PIPELINE_SHARED_INPUTS_DIR ||
    (process.env.PIPELINE_ROOT ? path.join(process.env.PIPELINE_ROOT, "Inputs") : null);

  if (sharedInputsSource && existsSync(sharedInputsSource)) {
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
    process.env.PIPELINE_REFERENCE_DIR ||
    (process.env.PIPELINE_ROOT ? path.join(process.env.PIPELINE_ROOT, "zReferenceFiles") : null);

  if (refSource && existsSync(refSource)) {
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
  intervalMs = 5000,
): { stop: () => Promise<void> } {
  const knownFiles = new Map<string, number>(); // path → last modified time
  let stopped = false;

  const sync = async () => {
    try {
      const files = await walkDir(localOutputsDir);
      for (const relPath of files) {
        if (relPath.includes(".DS_Store") || relPath.includes("__pycache__")) continue;
        const localPath = path.join(localOutputsDir, relPath);
        const s = await stat(localPath);
        const mtime = s.mtimeMs;

        if (!knownFiles.has(relPath) || knownFiles.get(relPath)! < mtime) {
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
