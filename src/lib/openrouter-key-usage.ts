import { resolveOpenRouterBaseUrl } from "@/lib/openrouter";

/** What OpenRouter reports about a key — the same numbers as
 * `curl https://openrouter.ai/api/v1/key` and `/api/v1/credits`. */
export interface OpenRouterKeyUsage {
  label: string | null;
  usage: number;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  limit: number | null;
  limitRemaining: number | null;
  isFreeTier: boolean;
  totalCredits: number | null;
  totalUsage: number | null;
}

type KeyResponse = {
  data?: {
    label?: string;
    usage?: number;
    usage_daily?: number;
    usage_weekly?: number;
    usage_monthly?: number;
    limit?: number | null;
    limit_remaining?: number | null;
    is_free_tier?: boolean;
  };
};
type CreditsResponse = { data?: { total_credits?: number; total_usage?: number } };

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function parseOpenRouterKeyUsage(
  key: KeyResponse | null,
  credits: CreditsResponse | null
): OpenRouterKeyUsage {
  const d = key?.data ?? {};
  return {
    label: d.label ?? null,
    usage: num(d.usage) ?? 0,
    usageDaily: num(d.usage_daily),
    usageWeekly: num(d.usage_weekly),
    usageMonthly: num(d.usage_monthly),
    limit: num(d.limit),
    limitRemaining: num(d.limit_remaining),
    isFreeTier: d.is_free_tier === true,
    totalCredits: num(credits?.data?.total_credits),
    totalUsage: num(credits?.data?.total_usage),
  };
}

async function getJson<T>(url: string, apiKey: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Returns null only when OpenRouter answered neither endpoint. */
export async function fetchOpenRouterKeyUsage(apiKey: string): Promise<OpenRouterKeyUsage | null> {
  const base = resolveOpenRouterBaseUrl().replace(/\/$/, "");
  const [key, credits] = await Promise.all([
    getJson<KeyResponse>(`${base}/key`, apiKey),
    getJson<CreditsResponse>(`${base}/credits`, apiKey),
  ]);
  if (!key && !credits) return null;
  return parseOpenRouterKeyUsage(key, credits);
}
