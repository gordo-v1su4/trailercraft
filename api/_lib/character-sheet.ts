/**
 * Canonical character sheet generation.
 *
 * A "character" in this app is an IMAGE, not a paragraph. Reference analysis
 * produces prose descriptions, and prose drifts: the model invents wardrobe,
 * tattoos and accessories that were never in the source, and every downstream
 * shot inherits the invention. So each detected character gets exactly one
 * generated reference sheet, and from that point on prompts refer to the
 * character BY NAME and treat the sheet as authoritative.
 *
 * The sheet is COMPOSED, not generated in one shot. Asking a single image call
 * for a multi-panel labelled sheet is not reliable: it approximates the
 * arrangement, then crops heads out of panels and garbles the labels ("3/4"
 * comes back as "9/4"). So each panel is generated on its own — where framing is
 * a simple, satisfiable instruction — and the grid, gutters, labels and the
 * exact 16:9 canvas are drawn locally with sharp, which cannot hallucinate,
 * crop, or misspell.
 *
 * Why not Sunburst for this: it is text-to-image only. It accepts an `input`
 * image field, returns HTTP 200, and silently ignores it — verified by asking
 * for a sheet of a specific man and receiving a completely different person.
 * The OpenAI reference-image models honour the input. Sunburst stays in use for
 * the 2x2 shot sheets, which need no reference and where it is ~20x cheaper.
 */

import sharp, { type OverlayOptions } from "sharp";
import { uploadBase64Image, StorageError, type StorageEnv } from "./storage";
import { hasHiggsfield, higgsfieldImage, type HiggsfieldEnv } from "./higgsfield";

const CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Reference-capable OpenAI image model. Verified to preserve facial identity. */
const SHEET_MODEL = "openai/gpt-5-image";

const SHEET_WIDTH = 2048;
const SHEET_HEIGHT = 1152;
const COLS = 2;
const ROWS = 2;
const GUTTER = 10;
const LABEL_BAR = 34;
const FOOTER_HEIGHT = 54;

const VIEWS: Array<{ label: string; prompt: string }> = [
  {
    label: "FRONT",
    prompt:
      "a straight-on FRONT portrait, framed from the top of the head to mid-chest, looking at " +
      "the camera, neutral expression",
  },
  {
    label: "3/4",
    prompt:
      "a THREE-QUARTER portrait turned about 40 degrees to one side, framed from the top of the " +
      "head to mid-chest, neutral expression",
  },
  {
    label: "PROFILE",
    prompt:
      "a full PROFILE portrait with the head turned 90 degrees to the side, framed from the top " +
      "of the head to mid-chest, neutral expression",
  },
  {
    label: "FULL BODY",
    prompt:
      "a FULL-BODY shot, standing straight and facing the camera, arms relaxed at the sides. " +
      "The complete figure must sit entirely inside the frame with a clear empty margin above " +
      "the top of his hair and below his shoes, and empty space to both sides. Frame it wide " +
      "and pulled back so he occupies only the middle two thirds of the picture",
  },
];

export interface CharacterSheetEnv extends HiggsfieldEnv {
  OPENROUTER_API_KEY?: string;
  /** Override the sheet model. Must be a model that accepts image input. */
  CHARACTER_SHEET_MODEL?: string;
}

export class CharacterSheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterSheetError";
  }
}

export interface CharacterSheetRequest {
  /** Data URL of the source reference image the character was detected in. */
  sourceImageDataUrl: string;
  /** Display name, used in the sheet's metadata footer. */
  name: string;
  /** Optional short notes. Deliberately brief — the image must drive the likeness. */
  notes?: string;
}

interface ChatImageResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      images?: Array<{ type?: string; image_url?: { url?: string } }>;
    };
  }>;
  error?: { message?: string };
}

const IDENTITY_RULES = [
  "Reproduce the EXACT same person from the reference image: identical face, bone structure,",
  "skin tone, haircut and hairline, facial hair, eyes, nose, mouth, scars, tattoos, piercings",
  "and jewellery. Reproduce the exact clothing and outer layer they are wearing.",
  "Do not beautify, age, de-age, lighten, slim or otherwise alter them.",
].join(" ");

function panelPrompt(name: string, viewPrompt: string, notes?: string): string {
  const noteLine = notes?.trim() ? ` Keep these observed traits: ${notes.trim()}` : "";
  return [
    `${viewPrompt}.`,
    IDENTITY_RULES + noteLine,
    "Plain flat light-grey seamless studio background, soft even neutral lighting, sharp focus,",
    "photorealistic, no colour grade, no vignette, no environment, no props, no text, no watermark.",
    `This is a reference panel for the character ${name}.`,
  ].join(" ");
}

async function requestPanelViaOpenRouter(
  apiKey: string,
  model: string,
  sourceImageDataUrl: string,
  prompt: string,
  timeoutMs: number,
): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: sourceImageDataUrl } },
            ],
          },
        ],
        // Required: without this the model answers with text only and HTTP 200.
        modalities: ["image", "text"],
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) throw new CharacterSheetError(`Sheet provider ${res.status}: ${raw.slice(0, 300)}`);

    let parsed: ChatImageResponse;
    try {
      parsed = JSON.parse(raw) as ChatImageResponse;
    } catch {
      throw new CharacterSheetError(`Non-JSON response: ${raw.slice(0, 200)}`);
    }

    if (parsed.error?.message) throw new CharacterSheetError(parsed.error.message);

    const url = parsed.choices?.[0]?.message?.images?.find((i) => i.image_url?.url)?.image_url
      ?.url;
    if (!url) throw new CharacterSheetError("Provider returned no image for a panel.");
    return Buffer.from(url.split(",", 2)[1], "base64");
  } finally {
    clearTimeout(timer);
  }
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

function labelSvg(text: string, width: number, height: number): Buffer {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${width}" height="${height}" fill="#ffffff" fill-opacity="0.93"/>
       <text x="12" y="${Math.round(height * 0.72)}" font-family="Helvetica, Arial, sans-serif"
             font-size="19" font-weight="700" letter-spacing="1.2" fill="#1a1a1a">${escapeXml(text)}</text>
     </svg>`,
  );
}

/**
 * Fit one panel into its cell without ever cropping it.
 *
 * A centre-crop ("cover") of a square render into a landscape cell cuts the top
 * and bottom off, which is precisely how full-body panels lose their heads. Each
 * panel is therefore letterboxed onto its own background colour, sampled from
 * the panel's corner so the padding is invisible against the studio backdrop.
 */
async function fitPanel(image: Buffer, width: number, height: number): Promise<Buffer> {
  const { data: corner } = await sharp(image)
    .extract({ left: 0, top: 0, width: 2, height: 2 })
    .resize(1, 1)
    .raw()
    .toBuffer({ resolveWithObject: true });

  return sharp(image)
    .resize(width, height, {
      fit: "contain",
      background: { r: corner[0] ?? 226, g: corner[1] ?? 226, b: corner[2] ?? 226 },
    })
    .png()
    .toBuffer();
}

/**
 * Lay the panels out on an exact 16:9 canvas, with sharp-drawn labels so the
 * text is always spelled correctly and the canvas is always exactly 16:9.
 */
async function composeSheet(
  panels: Array<{ label: string; image: Buffer }>,
  name: string,
): Promise<Buffer> {
  const cellW = Math.floor((SHEET_WIDTH - GUTTER * (COLS + 1)) / COLS);
  const cellH = Math.floor((SHEET_HEIGHT - FOOTER_HEIGHT - GUTTER * (ROWS + 1)) / ROWS);
  const imageH = cellH - LABEL_BAR;

  const composites: OverlayOptions[] = [];

  for (const [i, { label, image }] of panels.entries()) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const left = GUTTER + col * (cellW + GUTTER);
    const top = GUTTER + row * (cellH + GUTTER);

    const fitted = await fitPanel(image, cellW, imageH);

    composites.push({ input: fitted, left, top });
    composites.push({ input: labelSvg(label, cellW, LABEL_BAR), left, top: top + imageH });
  }

  composites.push({
    input: labelSvg(`NAME: ${name}`, SHEET_WIDTH, FOOTER_HEIGHT),
    left: 0,
    top: SHEET_HEIGHT - FOOTER_HEIGHT,
  });

  return sharp({
    create: {
      width: SHEET_WIDTH,
      height: SHEET_HEIGHT,
      channels: 3,
      background: { r: 226, g: 226, b: 226 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

export async function generateCharacterSheet(
  req: CharacterSheetRequest,
  env: CharacterSheetEnv,
  storageEnv: StorageEnv,
  prefix: string,
  timeoutMs = 240_000,
  attempts = 3,
): Promise<{
  url: string;
  key: string;
  bytes: number;
  model: string;
  name: string;
  panels: number;
}> {
  // Higgsfield is preferred when configured: it runs the same class of image
  // model on daily credits, while the OpenRouter key is a metered account that
  // runs out. Falls back to OpenRouter so the feature still works without it.
  const useHiggsfield = hasHiggsfield(env);
  const apiKey = env.OPENROUTER_API_KEY;
  if (!useHiggsfield && !apiKey) {
    throw new CharacterSheetError(
      "No image provider configured. Set HIGGSFIELD_API_KEY_ID/HIGGSFIELD_API_KEY_SECRET/" +
        "CHARACTER_SHEET_HF_MODEL, or OPENROUTER_API_KEY.",
    );
  }

  const model = env.CHARACTER_SHEET_MODEL || SHEET_MODEL;
  const sourceBuffer = Buffer.from(req.sourceImageDataUrl.split(",", 2)[1], "base64");
  const sourceMime = /^data:([^;,]+)/.exec(req.sourceImageDataUrl)?.[1] ?? "image/jpeg";

  // Panels are independent, so they overlap, but not all at once: six concurrent
  // reference-image calls reliably trip the provider's limit and come back with
  // empty responses, which costs more wall-clock than a small pool does.
  const CONCURRENCY = 2;
  const panels: Array<{ label: string; image: Buffer }> = new Array(VIEWS.length);
  let cursor = 0;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= VIEWS.length) return;
      const spec = VIEWS[index];

      let lastError: Error | null = null;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const prompt = panelPrompt(req.name, spec.prompt, req.notes);
          const image = useHiggsfield
            ? await higgsfieldImage(
                prompt,
                { buffer: sourceBuffer, mime: sourceMime },
                env,
                { aspectRatio: "16:9", resolution: "1k", timeoutMs },
              )
            : await requestPanelViaOpenRouter(apiKey as string, model, req.sourceImageDataUrl, prompt, timeoutMs);
          panels[index] = { label: spec.label, image };
          lastError = null;
          break;
        } catch (error) {
          lastError = new CharacterSheetError(
            `Panel "${spec.label}": ${error instanceof Error ? error.message : String(error)}`,
          );
          if (/safety|401|403|invalid_api_key/.test(lastError.message) || attempt === attempts) {
            break;
          }
          // Empty image responses are transient; space the retries out.
          await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
      }
      if (lastError) throw lastError;
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const sheet = await composeSheet(panels, req.name);

  try {
    const uploaded = await uploadBase64Image(
      `data:image/png;base64,${sheet.toString("base64")}`,
      prefix,
      storageEnv,
    );
    return {
      ...uploaded,
      model: useHiggsfield ? (env.CHARACTER_SHEET_HF_MODEL as string) : model,
      name: req.name,
      panels: panels.length,
    };
  } catch (error) {
    if (error instanceof StorageError) {
      throw new CharacterSheetError(`Sheet composed but upload failed: ${error.message}`);
    }
    throw error;
  }
}
