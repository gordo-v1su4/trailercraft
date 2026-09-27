/**
 * Reference images are inlined as base64 in the /api/llm request body, which
 * Vercel caps at 4.5 MB. Phone photos routinely exceed that, so downscale and
 * re-encode before the request goes out.
 */

import type { ImageData } from "../types";

const MAX_EDGE = 1024;
const JPEG_QUALITY = 0.82;

export function fileToBase64(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file as data URL"));
        return;
      }
      const base64String = result.split(",")[1];
      resolve({ base64: base64String, mimeType: file.type });
    };
    reader.onerror = (error) => reject(error);
  });
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Failed to read file as data URL"));
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Produce a JPEG data URL small enough to send to a vision model.
 * Falls back to the original data URL if canvas is unavailable.
 */
export async function fileToVisionDataUrl(file: File): Promise<string> {
  const original = await fileToDataUrl(file);

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch {
    return original;
  }
}
