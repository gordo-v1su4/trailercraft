/**
 * Single-image generation via OpenRouter's /images endpoint, persisted to RustFS.
 *
 * Sunburst is the only image model in this project. It is served from
 * /images/generations and rejects /chat/completions outright, so there is no
 * second endpoint to dispatch to and no `modalities` field to remember.
 *
 * The image comes back as base64 in `data[0].b64_json`. It is uploaded
 * immediately and never returned to the client as-is.
 */

import { uploadBase64Image, StorageError, type StorageEnv } from "./storage";

export interface ImageEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_IMAGE_MODEL?: string;
}

export interface GenerateImageRequest {
  prompt: string;
  /** Object key prefix, e.g. "shots" or "qc". */
  prefix?: string;
  model?: string;
}

export interface GenerateImageResult {
  url: string;
  key: string;
  bytes: number;
  model: string;
}

export class ImageGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

const IMAGES_URL = "https://openrouter.ai/api/v1/images/generations";

/** 2048x1152 is Sunburst's largest preset and the only one that is exactly 16:9. */
const SIZE = "2048x1152";
const QUALITY = "high";
const DEFAULT_MODEL = "openai/gpt-image-2.5-sunburst";

interface ImagesResponse {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string };
}

export async function generateImage(
  req: GenerateImageRequest,
  imageEnv: ImageEnv,
  storageEnv: StorageEnv,
  timeoutMs = 180_000,
): Promise<GenerateImageResult> {
  const apiKey = imageEnv.OPENROUTER_API_KEY;
  if (!apiKey) throw new ImageGenerationError("OPENROUTER_API_KEY not set");

  const model = req.model || imageEnv.OPENROUTER_IMAGE_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let dataUrl: string;
  try {
    const res = await fetch(IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: req.prompt,
        size: SIZE,
        quality: QUALITY,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new ImageGenerationError(
        `Image provider ${res.status}: ${raw.slice(0, 300)}`,
      );
    }

    let parsed: ImagesResponse;
    try {
      parsed = JSON.parse(raw) as ImagesResponse;
    } catch {
      throw new ImageGenerationError(`Non-JSON response: ${raw.slice(0, 200)}`);
    }

    if (parsed.error?.message) {
      throw new ImageGenerationError(parsed.error.message);
    }

    const entry = parsed.data?.[0];
    if (!entry?.b64_json) {
      throw new ImageGenerationError("Provider returned no image data");
    }
    dataUrl = `data:${entry.media_type ?? "image/png"};base64,${entry.b64_json}`;
  } finally {
    clearTimeout(timer);
  }

  try {
    const uploaded = await uploadBase64Image(dataUrl, req.prefix ?? "shots", storageEnv);
    return { ...uploaded, model };
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ImageGenerationError(`Image generated but upload failed: ${error.message}`);
    }
    throw error;
  }
}
