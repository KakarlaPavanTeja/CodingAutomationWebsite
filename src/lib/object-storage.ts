/**
 * Object storage for Next.js — priority order:
 *   1. AWS S3 when AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION +
 *      AWS_BUCKET_NAME are set (local dev / shared team bucket). Object keys
 *      are prefixed with AWS_OBJECT_KEY_PREFIX when set.
 *   2. Replit App Storage (GCS) when DEFAULT_OBJECT_STORAGE_BUCKET_ID is set.
 *   3. Local filesystem under LOCAL_OBJECT_STORAGE_ROOT (default
 *      `.local-object-storage` in the project root).
 */

import { mkdir, readFile, writeFile, readdir, stat, rm } from "fs/promises";
import path from "path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Storage, type Bucket } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

type StorageBackend = "s3" | "gcs" | "local";

let _client: Storage | null = null;
let _bucket: Bucket | null = null;
let _s3Client: S3Client | null = null;

function isS3Storage(): boolean {
  return (
    !!process.env.AWS_ACCESS_KEY_ID?.trim() &&
    !!process.env.AWS_SECRET_ACCESS_KEY?.trim() &&
    !!process.env.AWS_REGION?.trim() &&
    !!process.env.AWS_BUCKET_NAME?.trim()
  );
}

function isGcsStorage(): boolean {
  return !!process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID?.trim();
}

function storageBackend(): StorageBackend {
  if (isS3Storage()) return "s3";
  if (isGcsStorage()) return "gcs";
  return "local";
}

function isLocalStorage(): boolean {
  return storageBackend() === "local";
}

function localStorageRoot(): string {
  const root =
    process.env.LOCAL_OBJECT_STORAGE_ROOT?.trim() || ".local-object-storage";
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

function s3BucketName(): string {
  return process.env.AWS_BUCKET_NAME!.trim();
}

/** S3 key prefix (e.g. `testing-coding-question-test-cases/CodingAutomationData/`). */
function s3ObjectKeyPrefix(): string {
  const raw = process.env.AWS_OBJECT_KEY_PREFIX?.trim() ?? "";
  if (!raw) return "";
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error("Invalid AWS_OBJECT_KEY_PREFIX");
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeObjectPath(objectPath: string): string {
  const normalized = objectPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new Error(`Invalid object path: ${objectPath}`);
  }
  return normalized;
}

/** Map an app-relative object path to the full S3 object key. */
function toS3Key(objectPath: string): string {
  return s3ObjectKeyPrefix() + normalizeObjectPath(objectPath);
}

/** Map an S3 object key back to the app-relative path returned by listObjects. */
function fromS3Key(s3Key: string): string {
  const prefix = s3ObjectKeyPrefix();
  if (!prefix || !s3Key.startsWith(prefix)) return s3Key;
  return s3Key.slice(prefix.length);
}

/** Map an app-relative list/delete prefix to the S3 prefix. */
function toS3Prefix(prefix: string): string {
  const normalized = prefix.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized.includes("..")) {
    throw new Error(`Invalid object prefix: ${prefix}`);
  }
  const base = s3ObjectKeyPrefix();
  return normalized ? `${base}${normalized}/` : base;
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

function getS3Client(): S3Client {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    region: process.env.AWS_REGION!.trim(),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
    },
  });
  return _s3Client;
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
  if (storageBackend() !== "gcs") {
    throw new Error(
      "getBucket() is unavailable outside GCS mode. Set DEFAULT_OBJECT_STORAGE_BUCKET_ID for Replit App Storage.",
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

  if (isLocalStorage()) {
    const filePath = localFilePath(objectPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, buf);
    void contentType;
    return;
  }

  if (storageBackend() === "s3") {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: s3BucketName(),
        Key: toS3Key(objectPath),
        Body: buf,
        ContentType: contentType,
      }),
    );
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
  if (isLocalStorage()) {
    try {
      return await readFile(localFilePath(objectPath));
    } catch {
      throw new Error(`File not found: ${objectPath}`);
    }
  }

  if (storageBackend() === "s3") {
    try {
      const response = await getS3Client().send(
        new GetObjectCommand({
          Bucket: s3BucketName(),
          Key: toS3Key(objectPath),
        }),
      );
      if (!response.Body) {
        throw new Error(`File not found: ${objectPath}`);
      }
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NoSuchKey" || e.name === "NotFound") {
        throw new Error(`File not found: ${objectPath}`);
      }
      throw new Error(`Storage download failed (${objectPath}): ${e.message ?? "unknown"}`);
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

async function listS3Objects(
  prefix: string,
): Promise<{ name: string; size: number; updated: string }[]> {
  const results: { name: string; size: number; updated: string }[] = [];
  let continuationToken: string | undefined;
  const s3Prefix = toS3Prefix(prefix);

  do {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: s3BucketName(),
        Prefix: s3Prefix,
        MaxKeys: PAGE_SIZE,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (!item.Key) continue;
      results.push({
        name: fromS3Key(item.Key),
        size: item.Size ?? 0,
        updated: item.LastModified?.toISOString() ?? "",
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}

/** List all objects under a prefix (recursive), paginated under the hood. */
export async function listObjects(
  prefix: string,
): Promise<{ name: string; size: number; updated: string }[]> {
  if (isLocalStorage()) {
    const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/, "");
    const dir = localFilePath(normalizedPrefix);
    const files = await walkLocalDir(dir, normalizedPrefix);
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  if (storageBackend() === "s3") {
    const files = await listS3Objects(prefix);
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
  if (isLocalStorage()) {
    try {
      await rm(localFilePath(objectPath), { force: true });
    } catch {
      // Best-effort
    }
    return;
  }

  if (storageBackend() === "s3") {
    try {
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: s3BucketName(),
          Key: toS3Key(objectPath),
        }),
      );
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

async function deleteS3Prefix(prefix: string): Promise<number> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  const s3Prefix = toS3Prefix(prefix);

  do {
    const response = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: s3BucketName(),
        Prefix: s3Prefix,
        MaxKeys: PAGE_SIZE,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  for (let i = 0; i < keys.length; i += PAGE_SIZE) {
    const batch = keys.slice(i, i + PAGE_SIZE);
    if (batch.length === 0) continue;
    try {
      await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: s3BucketName(),
          Delete: {
            Objects: batch.map((Key) => ({ Key })),
            Quiet: true,
          },
        }),
      );
    } catch {
      // Best-effort
    }
  }

  return keys.length;
}

/**
 * Delete all objects under a prefix. Returns count of objects we attempted to
 * delete. Streams pages and runs deletes with bounded concurrency to avoid
 * loading huge prefixes into memory or saturating the network.
 */
export async function deletePrefix(prefix: string): Promise<number> {
  if (isLocalStorage()) {
    const items = await listObjects(prefix);
    for (const item of items) {
      await deleteObject(item.name);
    }
    return items.length;
  }

  if (storageBackend() === "s3") {
    return deleteS3Prefix(prefix);
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
