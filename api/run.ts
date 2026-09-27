import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchObject, StorageError, type StorageEnv } from "./_lib/storage";
import { toErrorBody, HttpError } from "./_lib/http";

/**
 * Serve a published run manifest.
 *
 * Reads go through RustFS rather than the public URL because the CDN in front of the
 * bucket replays cross-origin responses without CORS headers, which breaks fetch()
 * from the browser while <img> keeps working.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const key = String(req.query.key ?? "").trim();
    if (!key) throw new HttpError(400, 'Missing "key" query parameter');
    if (key.length > 512) throw new HttpError(400, "Object key too long");
    if (key.startsWith("/") || key.includes("..")) {
      throw new HttpError(400, "Invalid object key");
    }
    if (!key.endsWith(".json")) {
      throw new HttpError(400, "Object key must point at a .json manifest");
    }

    const { buffer } = await fetchObject(key, process.env as StorageEnv);

    let manifest: unknown;
    try {
      manifest = JSON.parse(buffer.toString("utf8"));
    } catch {
      throw new HttpError(422, "Manifest is not valid JSON");
    }

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(manifest);
  } catch (error) {
    if (error instanceof StorageError) {
      res.status(404).json({ error: error.message });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
