/**
 * Phase 7 — File migration: Supabase Storage → Replit App Storage.
 *
 * Source: Supabase Storage bucket (process.env.STORAGE_BUCKET) over the REST
 *         /storage/v1 API, authenticated with the service role key.
 * Target: Replit App Storage via src/lib/object-storage.ts (same path layout).
 *
 * Layout in both stores: <problem-id>/{inputs,outputs,logs}/...
 *
 * Idempotent: skips any object that already exists in App Storage with a
 * matching byte size.
 *
 * Run: npx tsx scripts/migrate-files.mts
 *      npx tsx scripts/migrate-files.mts --dry-run
 *      npx tsx scripts/migrate-files.mts --problem <uuid>     (single problem)
 */
import { getBucket, putObject } from "@/lib/object-storage";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = process.env.STORAGE_BUCKET!;
const DRY_RUN = process.argv.includes("--dry-run");
const onlyArgIdx = process.argv.indexOf("--problem");
const ONLY_PROBLEM = onlyArgIdx >= 0 ? process.argv[onlyArgIdx + 1] : null;
const startArgIdx = process.argv.indexOf("--start");
const START = startArgIdx >= 0 ? parseInt(process.argv[startArgIdx + 1], 10) : 0;
const limitArgIdx = process.argv.indexOf("--limit");
const LIMIT = limitArgIdx >= 0 ? parseInt(process.argv[limitArgIdx + 1], 10) : Infinity;

if (!URL || !KEY || !BUCKET) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

type StorageEntry = {
  name: string;
  id: string | null;
  metadata: { size?: number; mimetype?: string } | null;
};

/** List one level under a prefix. Folders have id=null. */
async function listLevel(prefix: string): Promise<StorageEntry[]> {
  const all: StorageEntry[] = [];
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const r = await fetch(`${URL}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ limit: PAGE, offset, prefix, sortBy: { column: "name", order: "asc" } }),
    });
    if (!r.ok) throw new Error(`list ${prefix} -> ${r.status}: ${await r.text()}`);
    const batch = (await r.json()) as StorageEntry[];
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

/** Recursive walk: returns flat list of file paths (with size). */
async function walk(prefix: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  const stack: string[] = [prefix];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const entries = await listLevel(cur);
    for (const e of entries) {
      const child = cur + e.name;
      if (e.id === null) {
        // folder
        stack.push(child + "/");
      } else {
        out.push({ path: child, size: e.metadata?.size ?? 0 });
      }
    }
  }
  return out;
}

async function downloadOne(objectPath: string): Promise<Buffer> {
  const url = `${URL}/storage/v1/object/${BUCKET}/${encodeURI(objectPath)}`;
  const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!r.ok) throw new Error(`download ${objectPath} -> ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

const bucket = DRY_RUN ? null : getBucket();

async function existsWithSize(objectPath: string, expectedSize: number): Promise<boolean> {
  if (!bucket) return false;
  const file = bucket.file(objectPath);
  try {
    const [exists] = await file.exists();
    if (!exists) return false;
    const [meta] = await file.getMetadata();
    return Number(meta.size ?? 0) === expectedSize;
  } catch {
    return false;
  }
}

const UPLOAD_CONCURRENCY = 8;

async function processProblem(problemId: string): Promise<{ uploaded: number; skipped: number; bytes: number }> {
  const files = await walk(`${problemId}/`);
  let uploaded = 0, skipped = 0, bytes = 0;

  let cursor = 0;
  const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, async () => {
    while (cursor < files.length) {
      const idx = cursor++;
      const f = files[idx];
      if (await existsWithSize(f.path, f.size)) {
        skipped++;
        continue;
      }
      if (DRY_RUN) {
        uploaded++;
        bytes += f.size;
        continue;
      }
      const buf = await downloadOne(f.path);
      await putObject(f.path, buf);
      uploaded++;
      bytes += buf.length;
    }
  });
  await Promise.all(workers);

  return { uploaded, skipped, bytes };
}

async function main() {
  console.log(`mode: ${DRY_RUN ? "DRY-RUN" : "WRITE"}\n`);

  // Discover problem folders
  let problemIds: string[];
  if (ONLY_PROBLEM) {
    problemIds = [ONLY_PROBLEM];
  } else {
    const top = await listLevel("");
    problemIds = top.filter((e) => e.id === null).map((e) => e.name);
  }
  const total = problemIds.length;
  problemIds = problemIds.slice(START, START + LIMIT);
  console.log(`Found ${total} problem folder(s); processing ${problemIds.length} (start=${START}, limit=${LIMIT === Infinity ? "all" : LIMIT})\n`);

  let totalUploaded = 0, totalSkipped = 0, totalBytes = 0;
  let i = 0;
  for (const pid of problemIds) {
    i++;
    const t0 = Date.now();
    const { uploaded, skipped, bytes } = await processProblem(pid);
    totalUploaded += uploaded;
    totalSkipped += skipped;
    totalBytes += bytes;
    console.log(`[${i}/${problemIds.length}] ${pid}  up=${uploaded} skip=${skipped} bytes=${bytes} (${Date.now() - t0}ms)`);
  }

  console.log(`\nTotal: uploaded=${totalUploaded} skipped=${totalSkipped} bytes=${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("File migration failed:", err);
    process.exit(1);
  });
