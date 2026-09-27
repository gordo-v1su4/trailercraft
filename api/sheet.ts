import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  generateContactSheet,
  SheetError,
  GRID_SIZES,
  SHEET_MODELS,
  type GridSize,
  type GenerateSheetRequest,
  type ImageEnv,
  type SheetPreset,
} from "./_lib/sheet";
import { readJsonBody, toErrorBody, HttpError } from "./_lib/http";
import type { StorageEnv } from "./_lib/storage";

interface Body {
  tilePrompts?: unknown;
  tileNames?: unknown;
  sharedDirection?: unknown;
  prefix?: unknown;
  preset?: unknown;
  gridSize?: unknown;
}

const VALID_GRIDS = Object.keys(GRID_SIZES) as GridSize[];

const VALID_PRESETS = Object.keys(SHEET_MODELS) as SheetPreset[];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = readJsonBody<Body>(req.body as unknown as string);

    const gridSize: GridSize =
      typeof body.gridSize === "string" &&
      VALID_GRIDS.includes(body.gridSize as GridSize)
        ? (body.gridSize as GridSize)
        : "2x2";
    const capacity = GRID_SIZES[gridSize];

    if (!Array.isArray(body.tilePrompts) || body.tilePrompts.length === 0) {
      throw new HttpError(400, '"tilePrompts" must be a non-empty array of strings');
    }
    if (body.tilePrompts.length > capacity) {
      throw new HttpError(
        400,
        `A ${gridSize} sheet holds ${capacity} tiles; got ${body.tilePrompts.length}`,
      );
    }
    body.tilePrompts.forEach((p, i) => {
      if (typeof p !== "string" || !p.trim()) {
        throw new HttpError(400, `tilePrompts[${i}] must be a non-empty string`);
      }
      if (p.length > 2000) {
        throw new HttpError(400, `tilePrompts[${i}] is too long`);
      }
    });

    const preset: SheetPreset =
      typeof body.preset === "string" &&
      VALID_PRESETS.includes(body.preset as SheetPreset)
        ? (body.preset as SheetPreset)
        : "sunburst";

    let tileNames: string[][] | undefined;
    if (body.tileNames !== undefined) {
      if (!Array.isArray(body.tileNames)) {
        throw new HttpError(400, '"tileNames" must be an array of arrays of strings');
      }
      if (body.tileNames.length > capacity) {
        throw new HttpError(
          400,
          `"tileNames" has ${body.tileNames.length} entries but a ${gridSize} sheet holds ${capacity}`,
        );
      }
      tileNames = body.tileNames.map((entry, i) => {
        if (!Array.isArray(entry)) {
          throw new HttpError(400, `tileNames[${i}] must be an array of strings`);
        }
        if (entry.length > 3) {
          throw new HttpError(400, `tileNames[${i}] holds more than 3 names`);
        }
        return entry.map((name) => {
          if (typeof name !== "string") {
            throw new HttpError(400, `tileNames[${i}] must contain only strings`);
          }
          if (name.length > 60) {
            throw new HttpError(400, `tileNames[${i}] contains an over-long name`);
          }
          return name;
        });
      });
    }

    const result = await generateContactSheet(
      {
        tilePrompts: body.tilePrompts as string[],
        tileNames,
        sharedDirection:
          typeof body.sharedDirection === "string" ? body.sharedDirection : undefined,
        prefix: typeof body.prefix === "string" ? body.prefix : "sheets",
        gridSize,
      } as GenerateSheetRequest,
      process.env as ImageEnv,
      process.env as StorageEnv,
      preset,
    );

    res.status(200).json({ ...result, preset });
  } catch (error) {
    if (error instanceof SheetError) {
      res.status(502).json({ error: error.message });
      return;
    }
    const { status, body } = toErrorBody(error);
    res.status(status).json(body);
  }
}
