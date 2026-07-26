/**
 * One-off cleanup: delete persisted `<problemId>/outputs/s3_blobs/` staging
 * files from object storage. These were local S3-upload staging copies that
 * uploadOutputsFromDir() used to sweep into storage; the pipeline no longer
 * writes them under Outputs/ (see execution_manager_v2._write_blob_and_get_s3_url).
 *
 * Reads storage config from `.env.local` (same backends as the app:
 * AWS S3 / Replit GCS / local filesystem).
 *
 * Usage:
 *   npx tsx scripts/cleanup-s3-blobs.mts            # dry run — list + total size
 *   npx tsx scripts/cleanup-s3-blobs.mts --delete   # actually delete
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) loadEnv({ path: envPath, quiet: true });

const { listObjects, deletePrefix } = await import("../src/lib/object-storage");

const doDelete = process.argv.includes("--delete");

const items = await listObjects("");
const blobs = items.filter((i) => i.name.includes("/outputs/s3_blobs/"));

if (blobs.length === 0) {
  console.log("No s3_blobs objects found in storage. Nothing to do.");
  process.exit(0);
}

const byProblem = new Map<string, { count: number; bytes: number }>();
for (const b of blobs) {
  const pid = b.name.split("/")[0];
  const agg = byProblem.get(pid) ?? { count: 0, bytes: 0 };
  agg.count++;
  agg.bytes += b.size;
  byProblem.set(pid, agg);
}

const fmtMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
let totalBytes = 0;
for (const [pid, agg] of [...byProblem.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${pid}  ${agg.count} file(s)  ${fmtMB(agg.bytes)}`);
  totalBytes += agg.bytes;
}
console.log(`\nTotal: ${blobs.length} file(s) across ${byProblem.size} problem(s), ${fmtMB(totalBytes)}`);

if (!doDelete) {
  console.log("\nDry run — nothing deleted. Re-run with --delete to remove these.");
  process.exit(0);
}

for (const pid of byProblem.keys()) {
  await deletePrefix(`${pid}/outputs/s3_blobs`);
  console.log(`deleted ${pid}/outputs/s3_blobs/`);
}

// deletePrefix swallows per-object errors (e.g. missing s3:DeleteObject IAM
// permission), so verify by re-listing instead of trusting its count.
const remaining = (await listObjects("")).filter((i) => i.name.includes("/outputs/s3_blobs/"));
if (remaining.length > 0) {
  console.error(
    `\nWARNING: ${remaining.length} of ${blobs.length} object(s) still present after delete.` +
      `\nLikely cause: the AWS credentials lack s3:DeleteObject on this prefix.`,
  );
  process.exit(1);
}
console.log(`\nDone. Deleted ${blobs.length} object(s) (verified by re-listing).`);
