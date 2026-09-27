/**
 * Contact-sheet image generation.
 *
 * Asking a model for nine separate shots costs nine calls. Asking for one
 * 3x3 contact sheet and slicing it costs one, and measured on this stack the
 * grid is ~9x cheaper per delivered shot. A 16:9 sheet divided 3x3 also yields
 * 16:9 tiles for free, which is why the grid is generated at 16:9.
 *
 * Tiles are centre-cropped to exact 16:9 because the models treat "16:9" as
 * exact for Sunburst (2048x1152 == 16:9), but tiles are still centre-cropped
 * defensively so a future size change cannot distort the grid.
 */

import sharp from "sharp";
import { labelTile } from "./tile-label";
import { uploadBase64Image, type StorageEnv } from "./storage";

/**
 * Tiles stay 16:9 only when the grid is square, because the sheet is 16:9.
 * 2x2 is the default: it yields 1024x576 raw tiles from a 2048x1152 sheet
 * (1.25x upscale), where 3x3 drops to 682x384 (1.9x upscale).
 */
export const GRID_ROWS = 2;
export const GRID_COLUMNS = 2;
export const TILES_PER_SHEET = GRID_ROWS * GRID_COLUMNS;
export const TILE_ASPECT = 16 / 9;

export const GRID_SIZES = { "2x2": 4, "3x3": 9 } as const;
export type GridSize = keyof typeof GRID_SIZES;

export function gridDimensions(size: GridSize): { rows: number; columns: number } {
  const [rows, columns] = size.split("x").map(Number);
  return { rows, columns };
}

export interface SheetTile {
  index: number;
  row: number;
  column: number;
  url: string;
  key: string;
  width: number;
  height: number;
  /** Character names burned into the tile's bottom-right plate. */
  names: string[];
}

export interface SheetResult {
  sourceUrl: string;
  sourceKey: string;
  sourceWidth: number;
  sourceHeight: number;
  gridSize: GridSize;
  tiles: SheetTile[];
}

export interface GenerateSheetRequest {
  /** One prompt per tile, in reading order (left-to-right, top-to-bottom). */
  tilePrompts: string[];
  sharedDirection?: string;
  prefix?: string;
  model?: string;
  /** Square grid to slice. Defaults to 2x2. */
  gridSize?: GridSize;
  /** Character names per tile, in the same order as `tilePrompts`. */
  tileNames?: string[][];
}

export interface ImageEnv {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_API_URL?: string;
  OPENROUTER_IMAGE_MODEL?: string;
}

const IMAGES_URL = "https://openrouter.ai/api/v1/images/generations";
const DEFAULT_TIMEOUT_MS = 240_000;

export class SheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SheetError";
  }
}

/**
 * Which API a model is served by. OpenAI's image models reject
 */
export function usesImagesApi(model: string): boolean {
  return /^openai\//.test(model) || /gpt-image/i.test(model);
}

/**
 * Sunburst only. It is the project's single image model: it is the cheapest per
 * sheet, 2048x1152 is its largest preset, and that preset is exactly 16:9.
 */
export const SHEET_MODELS = {
  sunburst: {
    model: "openai/gpt-image-2.5-sunburst",
    size: "2048x1152",
    quality: "high" as const,
  },
  sunburstFast: {
    model: "openai/gpt-image-2.5-sunburst",
    size: "2048x1152",
    quality: "low" as const,
  },
} as const;

export type SheetPreset = keyof typeof SHEET_MODELS;

interface RawImage {
  data: Buffer;
  mediaType: string;
}

async function callModel(
  preset: (typeof SHEET_MODELS)[SheetPreset],
  prompt: string,
  apiKey: string,
  timeoutMs: number,
): Promise<RawImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(IMAGES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: preset.model,
        prompt,
        size: preset.size,
        quality: preset.quality,
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) throw new SheetError(`sheet ${res.status}: ${raw.slice(0, 240)}`);

    const data = JSON.parse(raw) as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new SheetError(data.error.message);
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new SheetError("provider returned no image data");

    return {
      data: Buffer.from(b64, "base64"),
      mediaType: data.data?.[0]?.media_type ?? "image/png",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildSheetPrompt(
  tilePrompts: string[],
  sharedDirection?: string,
  gridSize: GridSize = "2x2",
): string {
  const { rows, columns } = gridDimensions(gridSize);
  const total = rows * columns;

  const cells = tilePrompts
    .map((p, i) => {
      const row = Math.floor(i / columns) + 1;
      const col = (i % columns) + 1;
      return `Cell ${i} (row ${row}, column ${col}): ${p}`;
    })
    .join("\n");

  return [
    `Generate ONE image that is a seamless ${rows}x${columns} contact-sheet grid of ${total} different photorealistic film stills.`,
    "",
    "LAYOUT RULES — follow exactly:",
    `- The ${total} cells must tile the entire canvas edge to edge in a ${rows} row by ${columns} column grid.`,
    "- Each cell must be filled completely with imagery.",
    "- No borders, no frames, no black bars, no grid lines, no gutters.",
    "- Absolutely no text, letters, numbers, captions, labels, logos or watermarks anywhere.",
    "- Every cell is an independent shot. Do not merge cells and do not repeat a shot.",
    "",
    "CONTINUITY RULES:",
    `- All ${total} shots must read as the same film: same character, same costume, same location, same lighting setup, same colour grade.`,
    "- Vary the framing and camera position between cells so the set does not look repetitive.",
    "",
    sharedDirection ? `CREATIVE DIRECTION: ${sharedDirection}` : "",
    "",
    `THE ${total} SHOTS:`,
    cells,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateContactSheet(
  req: GenerateSheetRequest,
  imageEnv: ImageEnv,
  storageEnv: StorageEnv,
  presetName: SheetPreset = "sunburst",
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SheetResult> {
  const apiKey = imageEnv.OPENROUTER_API_KEY;
  if (!apiKey) throw new SheetError("OPENROUTER_API_KEY not set");

  const preset = SHEET_MODELS[presetName];
  if (!preset) throw new SheetError(`Unknown sheet preset: ${presetName}`);

  const gridSize: GridSize = req.gridSize ?? "2x2";
  const { rows, columns } = gridDimensions(gridSize);
  const tileCount = rows * columns;

  const prompts = req.tilePrompts.slice(0, tileCount);
  if (prompts.length === 0) throw new SheetError("No tile prompts supplied");
  while (prompts.length < tileCount) {
    prompts.push(prompts[prompts.length % req.tilePrompts.length]);
  }

  const raw = await callModel(
    preset,
    buildSheetPrompt(prompts, req.sharedDirection, gridSize),
    apiKey,
    timeoutMs,
  );

  const prefix = req.prefix ?? "sheets";
  const source = await uploadBase64Image(
    `data:${raw.mediaType};base64,${raw.data.toString("base64")}`,
    prefix,
    storageEnv,
  );

  const meta = await sharp(raw.data).metadata();
  const srcW = meta.width ?? 0;
  const srcH = meta.height ?? 0;
  if (!srcW || !srcH) throw new SheetError("Could not read generated sheet dimensions");

  const cellW = Math.floor(srcW / columns);
  const cellH = Math.floor(srcH / rows);

  const tiles: SheetTile[] = [];
  for (let i = 0; i < tileCount; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const left = col * cellW;
    const top = row * cellH;

    const cropped = await sharp(raw.data)
      .extract({ left, top, width: cellW, height: cellH })
      .resize({ width: 1280, height: 720, fit: "cover", position: "centre" })
      .png({ compressionLevel: 9 })
      .toBuffer();

    const names = (req.tileNames?.[i] ?? []).filter(Boolean);
    const labelled = names.length
      ? await labelTile(cropped, { names, tileWidth: 1280, tileHeight: 720 })
      : cropped;

    const uploaded = await uploadBase64Image(
      `data:image/png;base64,${labelled.toString("base64")}`,
      `${prefix}-tiles`,
      storageEnv,
    );

    tiles.push({
      index: i,
      row,
      column: col,
      url: uploaded.url,
      key: uploaded.key,
      width: 1280,
      height: 720,
      names,
    });
  }

  return {
    sourceUrl: source.url,
    sourceKey: source.key,
    sourceWidth: srcW,
    sourceHeight: srcH,
    gridSize,
    tiles,
  };
}
