/**
 * Client for the app's own /api routes. Provider keys stay server-side; this
 * module only ever sees URLs and JSON.
 */

export interface ProviderAttempt {
  provider: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly attempts: ProviderAttempt[];

  constructor(message: string, status: number, attempts: ProviderAttempt[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.attempts = attempts;
  }

  /** Human-readable summary of which providers were tried and why they failed. */
  describe(): string {
    if (this.attempts.length === 0) return this.message;
    const lines = this.attempts.map((a) =>
      a.ok ? `${a.provider}: ok` : `${a.provider}: ${a.error ?? "failed"}`,
    );
    return `${this.message} (${lines.join("; ")})`;
  }
}

async function readError(res: Response): Promise<{ message: string; attempts: ProviderAttempt[] }> {
  let message = `${res.status} ${res.statusText}`;
  let attempts: ProviderAttempt[] = [];
  try {
    const body = (await res.json()) as {
      error?: string;
      detail?: unknown;
    };
    if (body?.error) message = body.error;
    if (Array.isArray(body?.detail)) {
      attempts = body.detail as ProviderAttempt[];
    }
  } catch {
    // Non-JSON error body; the status line is all we have.
  }
  return { message, attempts };
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      error instanceof Error ? error.message : "Network request failed",
      0,
    );
  }
  if (!res.ok) throw new ApiError((await readError(res)).message, res.status);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(
      `Could not reach ${path}. Is the dev server or deployment running?`,
      0,
    );
  }

  if (!res.ok) {
    const { message, attempts } = await readError(res);
    throw new ApiError(message, res.status, attempts);
  }

  return (await res.json()) as T;
}

export interface LlmOptions {
  prefer?: "kimi" | "hyper";
  maxTokens?: number;
  signal?: AbortSignal;
  /** Image data URLs to attach for vision analysis. */
  images?: string[];
}

export async function callKimi<T = unknown>(
  prompt: string,
  systemInstruction: string | null = null,
  options: LlmOptions = {},
): Promise<T> {
  const result = await post<{ data: T; provider: string; attempts: ProviderAttempt[] }>(
    "/api/llm",
    {
      prompt,
      systemInstruction,
      prefer: options.prefer,
      maxTokens: options.maxTokens,
      images: options.images,
    },
    options.signal,
  );
  return result.data;
}

export interface GeneratedImage {
  url: string;
  key: string;
  bytes: number;
  model: string;
}

export async function callImagen(
  prompt: string,
  options: { prefix?: string; signal?: AbortSignal } = {},
): Promise<GeneratedImage> {
  return post<GeneratedImage>(
    "/api/image",
    { prompt, prefix: options.prefix ?? "shots" },
    options.signal,
  );
}

export interface SheetTile {
  index: number;
  row: number;
  column: number;
  url: string;
  key: string;
  width: number;
  height: number;
  /** Character names burned into the tile's bottom-right plate. */
  names: string[];
}

export interface SheetResult {
  sourceUrl: string;
  sourceKey: string;
  sourceWidth: number;
  sourceHeight: number;
  tiles: SheetTile[];
  preset: string;
}

export type SheetPreset = "sunburst" | "sunburstFast";

/**
 * One call produces a sequence grid, which the server slices into 16:9 tiles.
 * Four shots cost one call at 2x2, so a delivered shot is far cheaper.
 */
export async function generateSheet(
  tilePrompts: string[],
  options: {
    sharedDirection?: string;
    preset?: SheetPreset;
    gridSize?: "2x2" | "3x3";
    prefix?: string;
    /** Character names per tile, parallel to `tilePrompts`. Burned in locally. */
    tileNames?: string[][];
    signal?: AbortSignal;
  } = {},
): Promise<SheetResult> {
  return post<SheetResult>(
    "/api/sheet",
    {
      tilePrompts,
      tileNames: options.tileNames,
      sharedDirection: options.sharedDirection,
      preset: options.preset ?? "sunburst",
      gridSize: options.gridSize ?? "2x2",
      prefix: options.prefix ?? "sheets",
    },
    options.signal,
  );
}

export interface CharacterSheetResult {
  url: string;
  key: string;
  bytes: number;
  model: string;
  name: string;
  runId: string;
}

export async function createCharacterSheet(
  sourceImage: string,
  name: string,
  notes?: string,
  options: { runId?: string; slug?: string; signal?: AbortSignal } = {},
): Promise<CharacterSheetResult> {
  return post<CharacterSheetResult>(
    "/api/character-sheet",
    {
      sourceImage,
      name,
      notes,
      runId: options.runId,
      slug: options.slug,
    },
    options.signal,
  );
}

export interface QcShotInput {
  url: string;
  title?: string;
  prompt?: string;
}

export interface QcFinding {
  shotIndex: number;
  severity: "low" | "medium" | "high";
  category: "consistency" | "composition" | "style" | "artifact" | "prompt-drift";
  note: string;
}

export interface QcReport {
  overallScore: number;
  verdict: string;
  consistency: {
    characterConsistency: string;
    lightingContinuity: string;
    paletteContinuity: string;
  };
  findings: QcFinding[];
  editSuggestions: string[];
}

export async function runQc(
  shots: QcShotInput[],
  direction?: string,
  signal?: AbortSignal,
): Promise<{ report: QcReport; provider: string; shotCount: number }> {
  return post<{ report: QcReport; provider: string; shotCount: number }>(
    "/api/qc",
    { shots, direction },
    signal,
  );
}

export interface RunManifest {
  runId: string;
  createdAt?: string;
  title?: string;
  style?: string;
  characters: Array<{
    id: string;
    name: string;
    sheetUrl: string;
    sourceImageIndex?: number;
  }>;
  locations: Array<{ id: string; name: string; sheetUrl: string }>;
  shotSheets?: Array<{ id: string; url: string }>;
}

export async function loadRun(key: string): Promise<RunManifest> {
  return get<RunManifest>(`/api/run?key=${encodeURIComponent(key)}`);
}
