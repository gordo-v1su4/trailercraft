/**
 * Shared plumbing for the /api routes so the Vercel handlers and the local Vite
 * dev middleware parse requests and shape errors identically.
 */

export function readJsonBody<T>(raw: string): T {
  if (!raw.trim()) {
    throw new HttpError(400, "Request body is empty");
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

export class HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }
}

export interface ErrorBody {
  error: string;
  detail?: unknown;
}

export function toErrorBody(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message, detail: error.detail } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: message } };
}

/** Guard against absurd payloads before they reach a paid upstream call. */
export function requireString(
  value: unknown,
  field: string,
  maxLength = 32_000,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `"${field}" is required and must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new HttpError(400, `"${field}" exceeds ${maxLength} characters`);
  }
  return value;
}
