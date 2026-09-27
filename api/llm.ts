import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateJson, AllProvidersFailedError, type LlmEnv } from "./_lib/llm";
import { readJsonBody, requireString, toErrorBody, HttpError } from "./_lib/http";

interface Body {
  prompt?: unknown;
  systemInstruction?: unknown;
  prefer?: unknown;
  maxTokens?: unknown;
  images?: unknown;
}

/** Base64 image payloads are inlined in the request; Vercel caps bodies at 4.5 MB. */
const MAX_IMAGES = 8;
const MAX_TOTAL_IMAGE_BYTES = 3_000_000;

const VALID_PREFER = ["kimi", "hyper"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = readJsonBody<Body>(req.body as unknown as string);
    const prompt = requireString(body.prompt, "prompt");

    const prefer =
      typeof body.prefer === "string" && VALID_PREFER.includes(body.prefer as never)
        ? (body.prefer as (typeof VALID_PREFER)[number])
        : undefined;

    const images: string[] = [];
    if (body.images !== undefined) {
      if (!Array.isArray(body.images)) {
        throw new HttpError(400, '"images" must be an array of data URLs');
      }
      if (body.images.length > MAX_IMAGES) {
        throw new HttpError(400, `Too many images (max ${MAX_IMAGES})`);
      }
      let total = 0;
      for (const [i, image] of body.images.entries()) {
        if (typeof image !== "string" || !image.startsWith("data:image/")) {
          throw new HttpError(400, `images[${i}] must be an image data URL`);
        }
        total += image.length;
        images.push(image);
      }
      if (total > MAX_TOTAL_IMAGE_BYTES) {
        throw new HttpError(413, "Attached images exceed the 3 MB budget");
      }
    }

    const result = await generateJson(
      {
        prompt,
        systemInstruction:
          typeof body.systemInstruction === "string" ? body.systemInstruction : null,
        prefer,
        maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
        images,
      },
      process.env as LlmEnv,
    );

    res.status(200).json({
      data: result.data,
      provider: result.provider,
      attempts: result.attempts,
    });
  } catch (error) {
    if (error instanceof AllProvidersFailedError) {
      res.status(502).json({
        error: "All LLM providers failed",
        detail: error.attempts,
      });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}

export { HttpError };
