/**
 * In-memory TTL cache for pipeline state queries.
 *
 * The pipeline dashboard polls /api/pipeline/state every 30 seconds per open
 * problem page. With 10 team members watching pipeline progress, that's
 * hundreds of identical DB queries for the same stepStatuses data — the state
 * only changes when a step finishes or a pipeline run starts/stops.
 *
 * This cache absorbs repeated reads within a 5‑second window so the database
 * is only hit once per ttl window per problem, regardless of how many clients
 * are watching.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 5_000;

/** Evict entries whose TTL has expired. Runs inline on every get. */
function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export function pipelineStateCacheGet<T>(problemId: string): T | undefined {
  evictStale();
  const entry = cache.get(problemId);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(problemId);
    return undefined;
  }
  return entry.data as T;
}

export function pipelineStateCacheSet<T>(
  problemId: string,
  data: T,
  ttlMs = DEFAULT_TTL_MS,
): void {
  cache.set(problemId, { data, expiresAt: Date.now() + ttlMs });
}

/** Invalidate a specific problem's cache entry (call after state mutations). */
export function pipelineStateCacheInvalidate(problemId: string): void {
  cache.delete(problemId);
}

/** Purge the entire cache. */
export function pipelineStateCacheClear(): void {
  cache.clear();
}