/**
 * Object storage for Next.js — Replit App Storage (GCS) in production,
 * local filesystem fallback for Cursor / offline dev.
 *
 * When `DEFAULT_OBJECT_STORAGE_BUCKET_ID` is set, uses the Replit sidecar +
 * @google-cloud/storage. Otherwise writes under `LOCAL_OBJECT_STORAGE_ROOT`
 * (default `.local-object-storage` in the project root).
 */

import { mkdir, readFile, writeFile, readdir, stat, rm } from "fs/promises";
import path from "path";
import { Storage, type Bucket } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

let _client: Storage | null = null;
let _bucket: Bucket | null = null;

function useLocalStorage(): boolean {
  return !process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim();
}

function localStorageRoot(): string {
  const root =
    process.env.LOCAL_OBJECT_STORAGE_ROOT?.trim() || ".local-object-storage";
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

/** Resolve an object key to a safe path under the local storage root. */
function localFilePath(objectPath: string): string {
  const normalized = objectPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error(`Invalid object path: ${objectPath}`);
  }
  const full = path.join(localStorageRoot(), normalized);
  const rel = path.relative(localStorageRoot(), full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Invalid object path: ${objectPath}`);
  }
  return full;
}

async function walkLocalDir(
  dir: string,
  prefix: string,
): Promise<{ name: string; size: number; updated: string }[]> {
  const results: { name: string; size: number; updated: string }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...(await walkLocalDir(full, rel)));
      } else if (entry.isFile()) {
        const s = await stat(full);
        results.push({
          name: rel.replace(/\\/g, "/"),
          size: s.size,
          updated: s.mtime.toISOString(),
        });
      }
    }
  } catch {
    // missing dir
  }
  return results;
}

function getClient(): Storage {
  if (_client) return _client;
  _client = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: "json",
          subject_token_field_name: "access_token",
        },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  return _client;
}

export function getBucket(): Bucket {
  if (useLocalStorage()) {
    throw new Error(
      "getBucket() is unavailable in local storage mode. Set DEFAULT_OBJECT_STORAGE_BUCKET_ID for Replit App Storage.",
    );
  }
  if (_bucket) return _bucket;
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
  _bucket = getClient().bucket(bucketId);
  return _bucket;
}

/** Upload a file (string or Buffer). Overwrites if it exists. */
export async function putObject(
  objectPath: string,
  content: Buffer | string,
  contentType?: string,
): Promise<void> {
  const buf = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  if (useLocalStorage()) {
    const filePath = localFilePath(objectPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buf);
    void contentType;
    return;
  }

  const file = getBucket().file(objectPath);
  // Small files use a single simple upload (low overhead); large files (e.g.
  // multi-MB generated testcases/coding_questions JSON) use a resumable upload,
  // which is the reliable path for big payloads.
  const RESUMABLE_THRESHOLD = 8 * 1024 * 1024;
  await file.save(buf, {
    resumable: buf.length > RESUMABLE_THRESHOLD,
    contentType: contentType,
    metadata: contentType ? { contentType } : undefined,
  });
}

/** Read a file as Buffer. Throws if not found. */
export async function getObjectBuffer(objectPath: string): Promise<Buffer> {
  if (useLocalStorage()) {
    try {
      return await readFile(localFilePath(objectPath));
    } catch {
      throw new Error(`File not found: ${objectPath}`);
    }
  }

  const file = getBucket().file(objectPath);
  try {
    const [data] = await file.download();
    return data;
  } catch (err) {
    const e = err as { code?: number; message?: string };
    if (e.code === 404) throw new Error(`File not found: ${objectPath}`);
    throw new Error(`Storage download failed (${objectPath}): ${e.message ?? "unknown"}`);
  }
}

/** Read a file as UTF-8 string. */
export async function getObjectString(objectPath: string): Promise<string> {
  const buf = await getObjectBuffer(objectPath);
  return buf.toString("utf-8");
}

const PAGE_SIZE = 500;
const DELETE_CONCURRENCY = 16;

/** List all objects under a prefix (recursive), paginated under the hood. */
export async function listObjects(
  prefix: string,
): Promise<{ name: string; size: number; updated: string }[]> {
  if (useLocalStorage()) {
    const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    const dir = localFilePath(normalizedPrefix);
    const files = await walkLocalDir(dir, normalizedPrefix);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  const bucket = getBucket();
  const results: { name: string; size: number; updated: string }[] = [];
  let pageToken: string | undefined;

  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      maxResults: PAGE_SIZE,
      pageToken,
      autoPaginate: false,
    });
    for (const f of files) {
      results.push({
        name: f.name,
        size: Number(f.metadata.size ?? 0),
        updated: (f.metadata.updated as string | undefined) ?? "",
      });
    }
    pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
  } while (pageToken);

  return results;
}

/** Delete a single object. Best-effort (no error if missing). */
export async function deleteObject(objectPath: string): Promise<void> {
  if (useLocalStorage()) {
    try {
      await rm(localFilePath(objectPath), { force: true });
    } catch {
      // Best-effort
    }
    return;
  }

  try {
    await getBucket().file(objectPath).delete({ ignoreNotFound: true });
  } catch {
    // Best-effort
  }
}

/**
 * Delete all objects under a prefix. Returns count of objects we attempted to
 * delete. Streams pages and runs deletes with bounded concurrency to avoid
 * loading huge prefixes into memory or saturating the network.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  if (useLocalStorage()) {
    const items = await listObjects(prefix);
    for (const item of items) {
      await deleteObject(item.name);
    }
    return items.length;
  }

  const bucket = getBucket();
  let total = 0;
  let pageToken: string | undefined;

  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      maxResults: PAGE_SIZE,
      pageToken,
      autoPaginate: false,
    });

    let cursor = 0;
    const workers = Array.from({ length: Math.min(DELETE_CONCURRENCY, files.length) }, async () => {
      while (cursor < files.length) {
        const idx = cursor++;
        try {
          await files[idx].delete({ ignoreNotFound: true });
        } catch {
          // Best-effort
        }
      }
    });
    await Promise.all(workers);
    total += files.length;

    pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
  } while (pageToken);

  return total;
}
