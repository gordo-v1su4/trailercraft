// Remove a single object from a specific bucket.
//
//   bun scripts/rm.mjs <bucket> <objectKey>
//
// Used to clear stray writes that landed in a neighbour's bucket. Verify the key
// before running: this deletes immediately and there is no undo.

import { readFileSync } from "node:fs";
import { deleteObject } from "../api/_lib/storage.ts";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const [, , bucket, objectKey] = process.argv;
if (!bucket || !objectKey) {
  console.error("usage: bun scripts/rm.mjs <bucket> <objectKey>");
  process.exit(1);
}

await deleteObject(objectKey, env, bucket);
console.log(`deleted ${bucket}/${objectKey}`);
