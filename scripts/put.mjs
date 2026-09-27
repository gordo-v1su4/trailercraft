// Publish a local image through the app's own storage layer.
//
//   bun scripts/put.mjs <localFile> <runId> [segment...]
//
// Example:
//   bun scripts/put.mjs proof/sheet-nico-16x9.png 2026-09-26T16-55-00Z character-sheets nico-marzano
//
// Goes through storeImage(), so it prefers the RustFS Media API gateway and falls
// back to direct S3 exactly like the running app. Keys land in the house layout
// documented in proxmox-home/hostinger-ops/docs/rustfs-object-layout.md:
//   media-uploads/YYYY/MM_DD/<runId>/<segment...>/<timestamp>-<filename>
// Writes are timestamped and never overwrite.

import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { buildRunFolder, storeImage } from "../api/_lib/storage.ts";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const [, , localFile, runId, ...segments] = process.argv;
if (!localFile || !runId) {
  console.error("usage: bun scripts/put.mjs <localFile> <runId> [segment...]");
  process.exit(1);
}

const contentType =
  extname(localFile).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";

const result = await storeImage(
  readFileSync(localFile),
  {
    folder: buildRunFolder(runId, segments),
    filename: basename(localFile),
    contentType,
  },
  env,
);

console.log(JSON.stringify(result, null, 2));
