/**
 * Validate that a relative storage path is safe to join with a problem prefix.
 *
 * Rejects:
 *   - absolute paths
 *   - paths containing `..` segments (path traversal)
 *   - null bytes
 *   - excessively long paths
 *
 * Throws on invalid input so callers can return a 400.
 */
const MAX_PATH_LEN = 512;

export function assertSafeRelativePath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error("Path is required.");
  }
  if (p.length > MAX_PATH_LEN) {
    throw new Error("Path is too long.");
  }
  if (p.includes("\0")) {
    throw new Error("Invalid path.");
  }
  // Reject absolute, drive-letter, and parent-segment patterns.
  if (p.startsWith("/") || p.startsWith("\\") || /^[a-zA-Z]:[\\/]/.test(p)) {
    throw new Error("Path must be relative.");
  }
  const parts = p.split(/[/\\]/);
  for (const part of parts) {
    if (part === "..") throw new Error("Path traversal is not allowed.");
  }
  return p;
}

export function assertSafeProblemId(id: unknown): string {
  if (typeof id !== "string") throw new Error("problemId required.");
  // UUIDs only — strict allowlist.
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error("Invalid problemId.");
  return id;
}
