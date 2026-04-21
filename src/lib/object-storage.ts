/**
 * Replit App Storage (GCS-backed) client for Next.js.
 *
 * Uses the Replit object-storage sidecar for credentials and the standard
 * @google-cloud/storage SDK for file operations.
 */

import { Storage, type Bucket } from "@google-cloud/storage";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

let _client: Storage | null = null;
let _bucket: Bucket | null = null;

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
  if (_bucket) return _bucket;
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) {
    throw new Error(
      "DEFAULT_OBJECT_STORAGE_BUCKET_ID is not set. App Storage bucket missing.",
    );
  }
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
  const file = getBucket().file(objectPath);
  await file.save(buf, {
    resumable: false,
    contentType: contentType,
    metadata: contentType ? { contentType } : undefined,
  });
}

/** Read a file as Buffer. Throws if not found. */
export async function getObjectBuffer(objectPath: string): Promise<Buffer> {
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

    // Bounded concurrency
    let cursor = 0;
    const workers = Array.from({ length: Math.min(DELETE_CONCURRENCY, files.length) }, async () => {
      while (cursor < files.length) {
        const idx = cursor++;
        try {
          await files[idx].delete({ ignoreNotFound: true });
        } catch {
          // Best-effort; per-object failures don't abort the batch
        }
      }
    });
    await Promise.all(workers);
    total += files.length;

    pageToken = (nextQuery as { pageToken?: string } | undefined)?.pageToken;
  } while (pageToken);

  return total;
}
