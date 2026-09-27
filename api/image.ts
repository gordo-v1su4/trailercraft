import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateImage, ImageGenerationError, type ImageEnv } from "./_lib/image";
import { readJsonBody, requireString, toErrorBody } from "./_lib/http";
import type { StorageEnv } from "./_lib/storage";

interface Body {
  prompt?: unknown;
  prefix?: unknown;
  model?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = readJsonBody<Body>(req.body as unknown as string);
    const prompt = requireString(body.prompt, "prompt", 8_000);

    const result = await generateImage(
      {
        prompt,
        prefix: typeof body.prefix === "string" ? body.prefix : "shots",
        model: typeof body.model === "string" ? body.model : undefined,
      },
      process.env as ImageEnv,
      process.env as StorageEnv,
    );

    // Only the URL crosses the wire — never the base64 payload.
    res.status(200).json(result);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      res.status(502).json({ error: error.message });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
