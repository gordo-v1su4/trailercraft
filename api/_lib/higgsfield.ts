/**
 * Higgsfield image provider.
 *
 * Used for character-sheet panels. OpenRouter's balance is a paid metered
 * account; Higgsfield exposes the same class of OpenAI image models behind free
 * daily credits, which is what makes per-character sheets affordable here.
 *
 * Contract (from docs.higgsfield.ai):
 *   - auth:      Authorization: Key <KEY_ID>:<KEY_SECRET>
 *   - upload:    POST /files/generate-upload-url -> presigned PUT -> public_url
 *   - generate:  POST /<model_id> -> { request_id, status_url }
 *   - poll:      GET <status_url> until the request leaves the queued state
 *
 * The generate schema is model-specific and only discoverable from the console
 * with an account, so the image-input field name and the model id are
 * configuration rather than hard-coded guesses.
 */

const API_BASE = "https://api.higgsfield.ai";

export interface HiggsfieldEnv {
  HIGGSFIELD_API_KEY_ID?: string;
  HIGGSFIELD_API_KEY_SECRET?: string;
  /** Model id exactly as listed in the console, e.g. an OpenAI image model. */
  CHARACTER_SHEET_HF_MODEL?: string;
  /** Field name the model expects its reference image in. */
  CHARACTER_SHEET_HF_IMAGE_FIELD?: string;
}

export class HiggsfieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

export function hasHiggsfield(env: HiggsfieldEnv): boolean {
  return Boolean(env.HIGGSFIELD_API_KEY_ID && env.HIGGSFIELD_API_KEY_SECRET && env.CHARACTER_SHEET_HF_MODEL);
}

function authHeader(env: HiggsfieldEnv): string {
  return `Key ${env.HIGGSFIELD_API_KEY_ID}:${env.HIGGSFIELD_API_KEY_SECRET}`;
}

interface UploadTicket {
  public_url: string;
  upload_url: string;
  content_type?: string;
  upload_headers?: Record<string, string>;
}

/** Push the reference image to Higgsfield storage and return its public URL. */
async function uploadReference(image: Buffer, mime: string, env: HiggsfieldEnv): Promise<string> {
  const ticketRes = await fetch(`${API_BASE}/files/generate-upload-url`, {
    method: "POST",
    headers: { Authorization: authHeader(env), "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: mime }),
  });
  if (!ticketRes.ok) {
    throw new HiggsfieldError(`Upload ticket failed ${ticketRes.status}: ${(await ticketRes.text()).slice(0, 200)}`);
  }

  const ticket = (await ticketRes.json()) as UploadTicket;
  if (!ticket.upload_url || !ticket.public_url) {
    throw new HiggsfieldError("Upload ticket missing upload_url/public_url");
  }

  const putRes = await fetch(ticket.upload_url, {
    method: "PUT",
    headers: ticket.upload_headers ?? { "Content-Type": mime },
    body: new Uint8Array(image),
  });
  if (!putRes.ok) {
    throw new HiggsfieldError(`Upload PUT failed ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`);
  }

  return ticket.public_url;
}

interface SubmitResponse {
  request_id?: string;
  status_url?: string;
  status?: string;
  error?: { message?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Submit one generation and poll it to completion.
 *
 * Returns the raw bytes of the first output image. Throws when the request ends
 * in a failed state so the caller's retry policy can treat it as transient.
 */
export async function higgsfieldImage(
  prompt: string,
  reference: { buffer: Buffer; mime: string },
  env: HiggsfieldEnv,
  options: { aspectRatio?: string; resolution?: string; timeoutMs?: number } = {},
): Promise<Buffer> {
  const model = env.CHARACTER_SHEET_HF_MODEL;
  if (!model) throw new HiggsfieldError("CHARACTER_SHEET_HF_MODEL not set");

  const { aspectRatio = "16:9", resolution = "1k", timeoutMs = 180_000 } = options;
  const imageField = env.CHARACTER_SHEET_HF_IMAGE_FIELD || "image_url";

  const referenceUrl = await uploadReference(reference.buffer, reference.mime, env);

  const submitRes = await fetch(`${API_BASE}/${model}`, {
    method: "POST",
    headers: { Authorization: authHeader(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspect_ratio: aspectRatio,
      resolution,
      [imageField]: referenceUrl,
    }),
  });

  const submitRaw = await submitRes.text();
  if (!submitRes.ok) {
    throw new HiggsfieldError(`Generate failed ${submitRes.status}: ${submitRaw.slice(0, 300)}`);
  }

  const submitted = JSON.parse(submitRaw) as SubmitResponse;
  if (submitted.error?.message) throw new HiggsfieldError(submitted.error.message);

  const statusUrl = submitted.status_url ?? `${API_BASE}/requests/${submitted.request_id}/status`;
  if (!submitted.request_id) throw new HiggsfieldError("Submit returned no request_id");

  const deadline = Date.now() + timeoutMs;
  let delay = 1500;

  for (;;) {
    if (Date.now() > deadline) {
      throw new HiggsfieldError(`Generation ${submitted.request_id} timed out after ${timeoutMs}ms`);
    }
    await sleep(delay);
    delay = Math.min(Math.round(delay * 1.5), 8000);

    const statusRes = await fetch(statusUrl, {
      headers: { Authorization: authHeader(env) },
    });
    if (!statusRes.ok) {
      throw new HiggsfieldError(`Status failed ${statusRes.status}`);
    }

    const body = (await statusRes.json()) as {
      status?: string;
      error?: { message?: string };
      outputs?: Array<{ url?: string; type?: string }>;
      result?: { outputs?: Array<{ url?: string; type?: string }> };
    };

    const state = (body.status ?? "").toLowerCase();
    const outputs = body.outputs ?? body.result?.outputs ?? [];

    if (["completed", "succeeded", "success", "done"].includes(state) && outputs.length > 0) {
      const image = outputs.find((o) => (o.type ?? "").startsWith("image") || /\.(png|jpe?g|webp)/i.test(o.url ?? ""));
      const chosen = image ?? outputs[0];
      if (!chosen?.url) throw new HiggsfieldError("Completed with no output url");

      const fileRes = await fetch(chosen.url);
      if (!fileRes.ok) throw new HiggsfieldError(`Output download failed ${fileRes.status}`);
      return Buffer.from(await fileRes.arrayBuffer());
    }

    if (["failed", "error", "cancelled", "canceled"].includes(state)) {
      throw new HiggsfieldError(
        `Generation ${state}: ${body.error?.message ?? "no reason given"}`,
      );
    }
  }
}
