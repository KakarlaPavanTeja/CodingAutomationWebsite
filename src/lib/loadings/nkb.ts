/**
 * NKB content-loading REST API (beta) + public S3 zip upload.
 *
 * Ported from the Loadings app (lib/nkb-beta-load.js). The zip must be publicly
 * readable because the NKB backend fetches it by URL.
 */

import { randomUUID } from "crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  NKB_BETA_API_BASE,
  ZIP_KEY_PREFIX,
  ZIP_PUBLIC_URL_BASE,
  nkbLoadCredentials,
} from "./config";

let _s3: S3Client | null = null;

/**
 * The content-loading prefix needs its own credentials: the platform's normal
 * AWS key can write to its own prefix in this bucket but not to
 * frontend/ccbp_beta/content_loading/uploads/. Falls back to AWS_* when the
 * dedicated pair is unset.
 */
function s3Client(): S3Client {
  if (_s3) return _s3;
  const accessKeyId = (
    process.env.NKB_ZIP_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || ""
  ).trim();
  const secretAccessKey = (
    process.env.NKB_ZIP_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || ""
  ).trim();
  _s3 = new S3Client({
    region: (process.env.NKB_ZIP_AWS_REGION || process.env.AWS_REGION || "ap-south-1").trim(),
    credentials: { accessKeyId, secretAccessKey },
  });
  return _s3;
}

/** Upload the admin zip and return the CDN URL that goes into input_data. */
export async function uploadZipToS3(zip: Buffer): Promise<string> {
  const fileName = `${randomUUID()}.zip`;
  const bucket = (process.env.NKB_ZIP_BUCKET || process.env.AWS_BUCKET_NAME || "new-assets.ccbp.in").trim();
  await s3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${ZIP_KEY_PREFIX}${fileName}`,
      Body: zip,
      ContentType: "application/zip",
      ACL: "public-read",
    }),
  );
  return `${ZIP_PUBLIC_URL_BASE}/${fileName}`;
}

export type NkbTaskType = "SHEET_LOADING" | "JSON_LOADING" | "UNLOCK_RESOURCES_FOR_USERS";

export interface NkbTaskResult {
  success: boolean;
  status: string;
  error?: string;
  taskId?: string;
  taskOutputUrl?: string;
  taskOutputRaw?: string;
}

const CONTENT_LOADING_URL = `${NKB_BETA_API_BASE}/nkb_load_data/content/loading/v1/`;
const STATUS_URL = `${NKB_BETA_API_BASE}/nkb_load_data/content/loading/status/v1/`;

async function parseBody(res: Response): Promise<{ data: Record<string, unknown>; text: string }> {
  const text = await res.text();
  try {
    return { data: text ? JSON.parse(text) : {}, text };
  } catch {
    return { data: {}, text };
  }
}

/** Pull the first http(s) link out of the poll response, for the "view output" link. */
function firstUrl(raw: string): string {
  const urls = raw.match(/https?:\/\/[^\s"',\\]+/g);
  return urls?.length ? urls[urls.length - 1] : "";
}

/** Create the task, then poll status until SUCCESS / FAILURE / timeout. */
export async function runNkbTask(
  taskType: NkbTaskType,
  inputData: Record<string, unknown>,
  poll: { maxAttempts: number; pollMs: number } = { maxAttempts: 100, pollMs: 3000 },
): Promise<NkbTaskResult> {
  const { username, password } = nkbLoadCredentials();
  if (!password) {
    return { success: false, status: "CREATE_FAILED", error: "NKB_LOAD_DATA_PASSWORD is not set." };
  }

  let created: Response;
  try {
    created = await fetch(CONTENT_LOADING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        task_type: taskType,
        content_data: { type: taskType, data: inputData },
      }),
    });
  } catch (err) {
    return {
      success: false,
      status: "CREATE_FAILED",
      error: `NKB API request failed: ${(err as Error).message}`,
    };
  }

  const { data, text } = await parseBody(created);
  if (!created.ok) {
    const msg = data.message || data.error || data.detail || text || `HTTP ${created.status}`;
    return { success: false, status: "CREATE_FAILED", error: `${taskType}: ${msg}`, taskOutputRaw: text };
  }
  const nested = data.data as Record<string, unknown> | undefined;
  const taskId = String(data.task_id || data.taskId || nested?.task_id || nested?.taskId || "");
  if (!taskId) {
    return {
      success: false,
      status: "CREATE_FAILED",
      error: `${taskType} created but no task_id in the response.`,
      taskOutputRaw: text,
    };
  }

  let lastText = "";
  for (let attempt = 0; attempt < poll.maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${STATUS_URL}?task_id=${encodeURIComponent(taskId)}`);
    } catch (err) {
      return {
        success: false,
        status: "NETWORK_ERROR",
        error: `Status poll failed: ${(err as Error).message}`,
        taskId,
      };
    }
    const polled = await parseBody(res);
    lastText = polled.text;
    if (!res.ok) {
      return {
        success: false,
        status: "HTTP_ERROR",
        error: `Status poll HTTP ${res.status} for ${taskType}`,
        taskId,
        taskOutputRaw: polled.text,
      };
    }

    const status = String(polled.data.status || polled.data.task_status || "")
      .trim()
      .toUpperCase();
    if (status === "SUCCESS") {
      return {
        success: true,
        status,
        taskId,
        taskOutputUrl: firstUrl(polled.text),
        taskOutputRaw: polled.text,
      };
    }
    if (status === "FAILURE" || status === "FAILED" || status === "FAIL") {
      return {
        success: false,
        status: "FAILURE",
        error: String(polled.data.message || `${taskType} failed`),
        taskId,
        taskOutputUrl: firstUrl(polled.text),
        taskOutputRaw: polled.text,
      };
    }
    if (attempt < poll.maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, poll.pollMs));
    }
  }

  return {
    success: false,
    status: "TIMEOUT",
    error: `${taskType} still running after ${poll.maxAttempts} polls — it may still finish on the backend.`,
    taskId,
    taskOutputRaw: lastText,
  };
}
