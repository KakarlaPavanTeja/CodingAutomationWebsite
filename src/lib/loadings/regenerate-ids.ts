import { randomUUID } from "crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Replace every UUID with a fresh one, keeping identical ids consistent, so a
 * reload creates a genuinely new question instead of colliding with the
 * already-loaded one.
 */
export function regenerateQuestionIds<T>(value: T, map = new Map<string, string>()): T {
  if (typeof value === "string" && UUID_RE.test(value)) {
    if (!map.has(value)) map.set(value, randomUUID());
    return map.get(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => regenerateQuestionIds(v, map)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = regenerateQuestionIds(v, map);
    return out as T;
  }
  return value;
}
