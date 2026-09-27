import sharp from "sharp";

export interface TileLabelOptions {
  /** Character names present in this shot. Rendered in the order given. */
  names: string[];
  tileWidth: number;
  tileHeight: number;
}

const FONT_STACK =
  "Helvetica Neue, Helvetica, Arial, DejaVu Sans, sans-serif";

const escapeXml = (value: string): string =>
  value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );

/**
 * Scale font/padding with tile size so a 2x2 sheet and a 3x3 sheet match visually.
 */
function metrics(tileWidth: number) {
  const fontSize = Math.max(14, Math.round(tileWidth * 0.032));
  return {
    fontSize,
    padX: Math.round(fontSize * 0.7),
    padY: Math.round(fontSize * 0.45),
    margin: Math.round(fontSize * 0.7),
    radius: Math.round(fontSize * 0.28),
  };
}

function textWidth(text: string, fontSize: number): number {
  return Math.round(text.length * fontSize * 0.62);
}

/**
 * Burn a bottom-right name plate into one shot.
 *
 * Text is composited locally rather than requested from the image model: models
 * misspell and mis-style text, and a wrong character name on a continuity sheet is
 * worse than no name at all. The plate sits inside the frame because the sheet
 * layout forbids borders and margins between cells.
 */
export async function labelTile(
  image: Buffer,
  { names, tileWidth, tileHeight }: TileLabelOptions,
): Promise<Buffer> {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return image;

  const { fontSize, padX, padY, margin, radius } = metrics(tileWidth);
  const lines = clean.slice(0, 3);
  const lineHeight = Math.round(fontSize * 1.22);

  const boxWidth = Math.min(
    tileWidth - margin * 2,
    Math.max(...lines.map((l) => textWidth(l, fontSize))) + padX * 2,
  );
  const boxHeight = lines.length * lineHeight + padY * 2;
  const boxX = tileWidth - margin - boxWidth;
  const boxY = tileHeight - margin - boxHeight;

  const tspans = lines
    .map(
      (line, i) =>
        `<tspan x="${boxX + padX}" y="${
          boxY + padY + fontSize + i * lineHeight
        }">${escapeXml(line.toUpperCase())}</tspan>`,
    )
    .join("");

  const svg = `<svg width="${tileWidth}" height="${tileHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}"
        rx="${radius}" ry="${radius}"
        fill="rgba(0,0,0,0.62)" stroke="rgba(255,255,255,0.28)" stroke-width="1"/>
  <text font-family="${FONT_STACK}" font-size="${fontSize}" font-weight="700"
        letter-spacing="0.6" fill="#ffffff"
        stroke="rgba(0,0,0,0.85)" stroke-width="${Math.max(1, Math.round(fontSize * 0.06))}"
        paint-order="stroke fill">${tspans}</text>
</svg>`;

  return sharp(image)
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
