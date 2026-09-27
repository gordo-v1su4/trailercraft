import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  generateCharacterSheet,
  CharacterSheetError,
  type CharacterSheetEnv,
} from "./_lib/character-sheet";
import type { StorageEnv } from "./_lib/storage";
import { readJsonBody, requireString, toErrorBody, HttpError } from "./_lib/http";

interface Body {
  sourceImage?: unknown;
  name?: unknown;
  notes?: unknown;
  runId?: unknown;
  slug?: unknown;
}

/** Reference images are inlined; Vercel caps request bodies at 4.5 MB. */
const MAX_SOURCE_BYTES = 4_000_000;

function safeSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "character"
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = readJsonBody<Body>(req.body as unknown as string);
    const sourceImage = requireString(body.sourceImage, "sourceImage", MAX_SOURCE_BYTES);

    if (!sourceImage.startsWith("data:image/")) {
      throw new HttpError(400, '"sourceImage" must be an image data URL');
    }
    if (sourceImage.length > MAX_SOURCE_BYTES) {
      throw new HttpError(413, "Source image exceeds the 4 MB budget");
    }

    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Character";
    const notes = typeof body.notes === "string" ? body.notes : undefined;

    // Every run is timestamped so a regenerated sheet never overwrites an
    // earlier one. Callers that omit runId get a fresh one.
    const runId =
      typeof body.runId === "string" && body.runId.trim()
        ? body.runId.trim()
        : new Date().toISOString().replace(/[:.]/g, "-");
    const slug =
      typeof body.slug === "string" && body.slug.trim() ? safeSegment(body.slug) : safeSegment(name);

    const prefix = `runs/${runId}/sheets/${slug}`;

    const sheet = await generateCharacterSheet(
      { sourceImageDataUrl: sourceImage, name, notes },
      process.env as CharacterSheetEnv,
      process.env as StorageEnv,
      prefix,
    );

    res.status(200).json({
      // uploadBase64Image already returns a bucket-qualified public URL.
      url: sheet.url,
      key: sheet.key,
      bytes: sheet.bytes,
      model: sheet.model,
      name: sheet.name,
      panels: sheet.panels,
      runId,
    });
  } catch (error) {
    if (error instanceof CharacterSheetError) {
      res.status(502).json({ error: error.message });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
