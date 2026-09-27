/**
 * Provider chain for structured (JSON) text generation.
 *
 * Order is deliberate and user-specified: Kimi first, Hyper second, OpenRouter last.
 * Every provider returns raw text; we parse JSON defensively because all three can
 * wrap output in prose or markdown fences even when told not to.
 */

export type ProviderId = "kimi" | "hyper";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface LlmRequest {
  prompt: string | ContentBlock[];
  systemInstruction?: string | null;
  /** Preferred provider. Falls through the chain if it fails. */
  prefer?: ProviderId;
  maxTokens?: number;
  /** Data URLs attached as image content blocks. */
  images?: string[];
}

export interface LlmAttempt {
  provider: ProviderId;
  ok: boolean;
  /** Populated on failure, for surfacing to the user. */
  error?: string;
  durationMs: number;
}

export interface LlmResult<T = unknown> {
  data: T;
  provider: ProviderId;
  attempts: LlmAttempt[];
}

export class AllProvidersFailedError extends Error {
  readonly attempts: LlmAttempt[];
  constructor(attempts: LlmAttempt[]) {
    const detail = attempts.map((a) => `${a.provider}: ${a.error}`).join(" | ");
    super(`All LLM providers failed — ${detail}`);
    this.name = "AllProvidersFailedError";
    this.attempts = attempts;
  }
}

async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image for Kimi: ${res.status}`);
  const mime = res.headers.get("content-type") ?? "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${mime};base64,${buf.toString("base64")}`;
}

const DEFAULTS = {
  kimiUrl: "https://api.kimi.com/coding/v1/messages",
  kimiModel: "kimi-k3",
  hyperUrl: "https://hyper.charm.land/v1/chat/completions",
  hyperModel: "kimi-k3",
} as const;

export interface LlmEnv {
  KIMI_API_KEY?: string;
  HYPER_API_KEY?: string;
  KIMI_API_URL?: string;
  KIMI_MODEL?: string;
  HYPER_API_URL?: string;
  HYPER_MODEL?: string;
}

const DEFAULT_SYSTEM =
  "You are a world-class film director and screenwriter. Return strict JSON only — no prose, no markdown fences, no commentary.";

/**
 * Pull a JSON object out of a model response. Handles bare JSON, ```json fences,
 * and JSON buried in surrounding chatter.
 */
export function extractJsonObject(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fence) {
    const inner = fence.trim();
    if (inner.startsWith("{") && inner.endsWith("}")) return inner;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);

  return "";
}

export function parseModelJson<T>(text: string): T {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    throw new Error("Model returned no JSON object");
  }
  return JSON.parse(candidate) as T;
}

interface FetchOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs: number;
}

async function postJson({ url, headers, body, timeoutMs }: FetchOptions): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — ${raw.slice(0, 300)}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Non-JSON response: ${raw.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- providers ------------------------------- */

async function callKimi(
  req: LlmRequest,
  env: LlmEnv,
  timeoutMs: number,
): Promise<string> {
  const system = req.systemInstruction || DEFAULT_SYSTEM;

  if (Array.isArray(req.prompt)) {
    const hydrated: unknown[] = [];
    for (const block of req.prompt) {
      if (block.type === "text") {
        hydrated.push(block);
        continue;
      }
      const url = block.image_url.url;
      const dataUrl = url.startsWith("data:") ? url : await toDataUrl(url);
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
      if (!match) throw new Error("Kimi images must be base64 data URLs");
      hydrated.push({
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      });
    }
    const blockData = (await postJson({
      url: env.KIMI_API_URL || DEFAULTS.kimiUrl,
      timeoutMs,
      headers: {
        "x-api-key": env.KIMI_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: env.KIMI_MODEL || DEFAULTS.kimiModel,
        max_tokens: req.maxTokens ?? 8000,
        system,
        messages: [{ role: "user", content: hydrated }],
      },
    })) as { content?: Array<{ type?: string; text?: string }> };
    const blockText = (blockData.content ?? [])
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    if (!blockText.trim()) throw new Error("Kimi returned no text block");
    return blockText;
  }

  const images = req.images ?? [];

  const content: unknown[] = [];
  for (const image of images) {
    // Kimi's block format is base64-only, so hydrate any https reference here
    // rather than forcing every caller to inline multi-megabyte payloads.
    const dataUrl = image.startsWith("data:")
      ? image
      : await toDataUrl(image);
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error("Kimi images must be base64 data URLs");
    content.push({
      type: "image",
      source: { type: "base64", media_type: match[1], data: match[2] },
    });
  }
  content.push({ type: "text", text: req.prompt });

  const data = (await postJson({
    url: env.KIMI_API_URL || DEFAULTS.kimiUrl,
    timeoutMs,
    headers: {
      "x-api-key": env.KIMI_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: {
      model: env.KIMI_MODEL || DEFAULTS.kimiModel,
      max_tokens: req.maxTokens ?? 8000,
      system,
      messages: [{ role: "user", content: content as never }],
    },
  })) as { content?: Array<{ type?: string; text?: string }> };

  // Anthropic-shaped responses interleave thinking + text blocks; only text counts.
  const text = (data.content ?? [])
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");

  if (!text.trim()) throw new Error("Kimi returned no text block");
  return text;
}

async function callOpenAiCompatible(
  req: LlmRequest,
  opts: {
    url: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    /** Hyper honours response_format; OpenRouter text models may not. */
    jsonMode: boolean;
  },
): Promise<string> {
  const system = req.systemInstruction || DEFAULT_SYSTEM;
  if (Array.isArray(req.prompt)) {
    const blockData = (await postJson({
      url: opts.url,
      timeoutMs: opts.timeoutMs,
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: { model: opts.model, messages: [{ role: "system", content: system }, { role: "user", content: req.prompt }], ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}) },
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const blockText = blockData.choices?.[0]?.message?.content ?? "";
    if (!blockText.trim()) throw new Error("Empty message content");
    return blockText;
  }

  const images = req.images ?? [];

  const userContent: unknown = images.length
    ? [
        { type: "text", text: req.prompt },
        ...images.map((url) => ({ type: "image_url", image_url: { url } })),
      ]
    : req.prompt;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userContent },
  ];

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    max_tokens: req.maxTokens ?? 8000,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };

  const data = (await postJson({
    url: opts.url,
    timeoutMs: opts.timeoutMs,
    headers: { Authorization: `Bearer ${opts.apiKey}` },
    body,
  })) as { choices?: Array<{ message?: { content?: string } }> };

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("Empty message content");
  return text;
}

/* --------------------------------- chain --------------------------------- */

const CHAIN: ProviderId[] = ["kimi", "hyper"];

export async function generateJson<T = unknown>(
  req: LlmRequest,
  env: LlmEnv,
  timeoutMs = 240_000,
): Promise<LlmResult<T>> {
  const order = req.prefer
    ? [req.prefer, ...CHAIN.filter((p) => p !== req.prefer)]
    : CHAIN;

  const attempts: LlmAttempt[] = [];

  for (const provider of order) {
    const started = Date.now();
    try {
      let text: string;

      switch (provider) {
        case "kimi": {
          if (!env.KIMI_API_KEY) throw new Error("KIMI_API_KEY not set");
          text = await callKimi(req, env, timeoutMs);
          break;
        }
        case "hyper": {
          if (!env.HYPER_API_KEY) throw new Error("HYPER_API_KEY not set");
          text = await callOpenAiCompatible(req, {
            url: env.HYPER_API_URL || DEFAULTS.hyperUrl,
            apiKey: env.HYPER_API_KEY,
            model: env.HYPER_MODEL || DEFAULTS.hyperModel,
            timeoutMs,
            jsonMode: true,
          });
          break;
        }
      }

      const data = parseModelJson<T>(text);
      attempts.push({ provider, ok: true, durationMs: Date.now() - started });
      return { data, provider, attempts };
    } catch (error) {
      attempts.push({
        provider,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  }

  throw new AllProvidersFailedError(attempts);
}
