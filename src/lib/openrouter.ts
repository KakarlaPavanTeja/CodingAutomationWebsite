const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterCompletion {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd?: number;
  };
}

export function resolveOpenRouterApiKey(apiKey?: string): string {
  const key = apiKey ?? process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return key;
}

export function resolveOpenRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL;
}

/** Bare model ids (no "/") get an OpenRouter provider prefix. */
export function normalizeOpenRouterModel(model: string): string {
  if (model.includes("/")) return model;
  if (model.startsWith("claude")) return `anthropic/${model}`;
  return `openai/${model}`;
}

interface OpenRouterChatResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
}

/** Hard ceiling on a single OpenRouter call so a stalled upstream cannot hold
 * the SSE stream open until the platform maxDuration. */
const REQUEST_TIMEOUT_MS = 120_000;

export async function openRouterChatCompletion(params: {
  apiKey?: string;
  model: string;
  messages: OpenRouterChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<OpenRouterCompletion> {
  const apiKey = resolveOpenRouterApiKey(params.apiKey);
  const baseUrl = resolveOpenRouterBaseUrl().replace(/\/$/, "");
  const model = normalizeOpenRouterModel(params.model);

  // Abort on our own timeout, or when the caller's signal fires (client disconnect).
  const timeout = AbortSignal.timeout(params.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const abortSignal = params.signal
    ? AbortSignal.any([timeout, params.signal])
    : timeout;

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: params.messages,
        max_tokens: params.maxTokens ?? 8000,
        usage: { include: true },
      }),
      signal: abortSignal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error("OpenRouter request timed out");
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("OpenRouter request aborted");
    }
    throw err;
  }

  // Read the body as text first so a non-JSON error page (proxy 5xx, empty body)
  // surfaces the real HTTP status instead of a confusing JSON parse error.
  const raw = await res.text();
  let data: OpenRouterChatResponse;
  try {
    data = JSON.parse(raw) as OpenRouterChatResponse;
  } catch {
    if (!res.ok) {
      throw new Error(`OpenRouter request failed (${res.status}): ${raw.slice(0, 300)}`);
    }
    throw new Error("OpenRouter returned a non-JSON response");
  }
  if (!res.ok) {
    const msg = data.error?.message ?? `OpenRouter request failed (${res.status})`;
    throw new Error(msg);
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("OpenRouter returned an empty completion");
  }

  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;

  return {
    content,
    model: data.model ?? model,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: typeof data.usage?.cost === "number" ? data.usage.cost : undefined,
    },
  };
}
