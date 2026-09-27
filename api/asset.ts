import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchObject, StorageError, type StorageEnv } from "./_lib/storage";
import { toErrorBody, HttpError } from "./_lib/http";

const DEFAULT_BUCKET = "trailercraft";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const key = String(req.query.key ?? "");
    if (!key) throw new HttpError(400, 'Missing "key" query parameter');
    if (key.length > 512) throw new HttpError(400, "Object key too long");

    const bucket = process.env.TRAILERCRAFT_BUCKET || DEFAULT_BUCKET;
    // Reject any attempt to address a different bucket than the configured one.
    if (key.startsWith("/") || key.includes("..") || key.startsWith(`${bucket}/`)) {
      throw new HttpError(400, "Invalid object key");
    }

    const { buffer, contentType } = await fetchObject(key, process.env as StorageEnv);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Length", String(buffer.byteLength));
    res.status(200).end(buffer);
  } catch (error) {
    if (error instanceof StorageError) {
      res.status(404).json({ error: error.message });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
