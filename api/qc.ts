import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runQc, type QcShot, type QcEnv } from "./_lib/qc";
import { readJsonBody, toErrorBody, HttpError } from "./_lib/http";

interface Body {
  shots?: unknown;
  direction?: unknown;
}

/** Vision models accept a limited number of images; keep the payload sane. */
const MAX_SHOTS = 24;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = readJsonBody<Body>(req.body as unknown as string);

    if (!Array.isArray(body.shots) || body.shots.length === 0) {
      throw new HttpError(400, '"shots" must be a non-empty array');
    }
    if (body.shots.length > MAX_SHOTS) {
      throw new HttpError(400, `Too many shots (max ${MAX_SHOTS} per QC pass)`);
    }

    const shots: QcShot[] = body.shots.map((shot, i) => {
      const s = shot as Partial<QcShot> | null;
      if (!s || typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) {
        throw new HttpError(400, `shots[${i}].url must be an absolute http(s) URL`);
      }
      return {
        url: s.url,
        title: typeof s.title === "string" ? s.title : undefined,
        prompt: typeof s.prompt === "string" ? s.prompt : undefined,
      };
    });

    const { report, provider } = await runQc(
      shots,
      typeof body.direction === "string" ? body.direction : undefined,
      process.env as QcEnv,
    );

    res.status(200).json({ report, provider, shotCount: shots.length });
  } catch (error) {
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
