/**
 * RustFS (S3-compatible) object storage.
 *
 * Images arrive from the model as ~2.6 MB base64 data URLs. Handing those back to
 * the browser would blow past Vercel's 4.5 MB function response limit and pin
 * ~160 MB of strings into React state for a full 60-shot run. Instead we upload
 * once and hand back a short public URL.
 */

import { createHash, createHmac } from "node:crypto";

export interface StorageEnv {
  RUSTFS_ACCESS_KEY?: string;
  RUSTFS_SECRET_KEY?: string;
  RUSTFS_REGION?: string;
  RUSTFS_S3_ENDPOINT?: string;
  RUSTFS_PUBLIC_BASE_URL?: string;
  RUSTFS_FORCE_PATH_STYLE?: string;
  TRAILERCRAFT_BUCKET?: string;
  MEDIA_GATEWAY_URL?: string;
  MEDIA_GATEWAY_TOKEN?: string;
  MEDIA_GATEWAY_BUCKET?: string;
  MEDIA_GATEWAY_USER_ID?: string;
  MEDIA_GATEWAY_UPLOAD_PREFIX?: string;
}

const DEFAULTS = {
  region: "us-east-1",
  bucket: "trailercraft",
  publicBaseUrl: "https://s3.v1su4.dev",
} as const;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

const sha256Hex = (input: string | Buffer): string =>
  createHash("sha256").update(input).digest("hex");

const hmac = (key: Buffer | string, msg: string): Buffer =>
  createHmac("sha256", key).update(msg, "utf8").digest();

interface SigV4Target {
  method: string;
  /** Absolute URL, used to derive the canonical host. */
  url: string;
  body?: Buffer;
  contentType?: string;
}

function signRequest(
  { method, url, body = Buffer.alloc(0), contentType }: SigV4Target,
  env: Required<Pick<StorageEnv, "RUSTFS_ACCESS_KEY" | "RUSTFS_SECRET_KEY">> & { region: string },
): Record<string, string> {
  const parsed = new URL(url);
  const host = parsed.host;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames
    .map((n) => `${n}:${String(headers[n]).trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    parsed.pathname,
    parsed.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${env.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  let signingKey: Buffer = hmac(`AWS4${env.RUSTFS_SECRET_KEY}`, dateStamp);
  signingKey = hmac(signingKey, env.region);
  signingKey = hmac(signingKey, "s3");
  signingKey = hmac(signingKey, "aws4_request");
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    ...headers,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${env.RUSTFS_ACCESS_KEY}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function requireEnv(env: StorageEnv): {
  RUSTFS_ACCESS_KEY: string;
  RUSTFS_SECRET_KEY: string;
  region: string;
  endpoint: string;
  publicBaseUrl: string;
  bucket: string;
} {
  const { RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY } = env;
  if (!RUSTFS_ACCESS_KEY || !RUSTFS_SECRET_KEY) {
    throw new StorageError(
      "RustFS credentials missing (RUSTFS_ACCESS_KEY / RUSTFS_SECRET_KEY)",
    );
  }
  return {
    RUSTFS_ACCESS_KEY,
    RUSTFS_SECRET_KEY,
    region: env.RUSTFS_REGION || DEFAULTS.region,
    endpoint: (env.RUSTFS_S3_ENDPOINT || "").replace(/\/+$/, ""),
    publicBaseUrl: (env.RUSTFS_PUBLIC_BASE_URL || DEFAULTS.publicBaseUrl).replace(/\/+$/, ""),
    bucket: env.TRAILERCRAFT_BUCKET || DEFAULTS.bucket,
  };
}

/** Split a `data:image/png;base64,...` URL into its mime type and raw bytes. */
export function decodeDataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new StorageError("Not a data URL");
  const [, mimeType, isBase64, payload] = match;
  if (!isBase64) throw new StorageError("Expected a base64 data URL");
  return { mimeType, buffer: Buffer.from(payload, "base64") };
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

export interface UploadResult {
  url: string;
  key: string;
  bytes: number;
}

/** Strip anything that could escape the intended namespace. */
export function sanitizePrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "");
}

export interface UploadObjectOptions {
  /** Namespace, e.g. "shots" or `runs/<id>/sheets/<slug>`. */
  prefix: string;
  contentType: string;
  /**
   * Explicit object key. When omitted a unique `<timestamp>-<uuid>.<ext>` name is
   * generated. Pass a key only when the caller needs a stable, human-findable
   * path — never to overwrite: a run folder is write-once by design.
   */
  key?: string;
}

/**
 * Upload raw bytes to RustFS and return the public URL.
 *
 * The public URL includes the bucket segment (`<base>/<bucket>/<key>`) because
 * that is how the RustFS CDN is mounted. Byte reads that must survive the CDN's
 * CORS behaviour should go through `/api/asset?key=<key>` instead of this URL.
 */
export async function uploadObject(
  buffer: Buffer,
  { prefix, contentType, key }: UploadObjectOptions,
  env: StorageEnv,
): Promise<UploadResult> {
  const cfg = requireEnv(env);
  if (!cfg.endpoint) {
    throw new StorageError("RUSTFS_S3_ENDPOINT not set");
  }

  const safePrefix = sanitizePrefix(prefix);
  if (!safePrefix) throw new StorageError("Empty upload prefix");

  const objectKey =
    key ??
    `${safePrefix}/${Date.now()}-${crypto.randomUUID()}.${
      EXTENSION_BY_MIME[contentType] ?? "bin"
    }`;

  if (objectKey.startsWith("/") || objectKey.includes("..")) {
    throw new StorageError("Invalid object key");
  }

  const pathStyle = (env.RUSTFS_FORCE_PATH_STYLE ?? "true") !== "false";
  const url = pathStyle
    ? `${cfg.endpoint}/${cfg.bucket}/${objectKey}`
    : `${cfg.endpoint}/${objectKey}`;

  const headers = signRequest(
    { method: "PUT", url, body: buffer, contentType },
    { RUSTFS_ACCESS_KEY: cfg.RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY: cfg.RUSTFS_SECRET_KEY, region: cfg.region },
  );

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(buffer),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new StorageError(`Upload failed: ${res.status} ${detail.slice(0, 200)}`);
  }

  return {
    url: `${cfg.publicBaseUrl}/${cfg.bucket}/${objectKey}`,
    key: objectKey,
    bytes: buffer.byteLength,
  };
}

/**
 * Upload a base64 image and return its public URL.
 * `prefix` namespaces objects per project, e.g. "shots" or "qc".
 */
export async function uploadBase64Image(
  dataUrl: string,
  prefix: string,
  env: StorageEnv,
): Promise<UploadResult> {
  const { mimeType, buffer } = decodeDataUrl(dataUrl);
  return uploadObject(buffer, { prefix, contentType: mimeType }, env);
}

/**
 * Build a house-style object folder.
 *
 * Layout is fixed by proxmox-home/hostinger-ops/docs/rustfs-object-layout.md:
 *   media-uploads/YYYY/MM_DD/<run-id>/<segment...>
 * The bucket is never repeated inside the key. Every level is stripped to a safe
 * character set so a run id or slug can be passed through without escaping the
 * namespace.
 */
export function buildRunFolder(
  runId: string,
  segments: string[] = [],
  when: Date = new Date(),
): string {
  const year = when.toISOString().slice(0, 4);
  const monthDay = when.toISOString().slice(5, 10).replace("-", "_");
  const parts = ["media-uploads", year, monthDay, runId, ...segments]
    .map((part) => sanitizePrefix(part))
    .filter(Boolean);
  return parts.join("/");
}

interface GatewayUploadResponse {
  bucket?: string;
  publicUrl?: string;
  path?: string;
  objectKey?: string;
  mime?: string;
}

/**
 * Upload through the RustFS Media API gateway.
 *
 * `bucket` must be sent explicitly: the gateway resolves the bucket from the bearer
 * token, so omitting it writes into whatever bucket that token is scoped to. That
 * silently cross-writes another app's data, which is exactly what happened on the
 * first attempt here.
 */
export async function uploadViaMediaGateway(
  buffer: Buffer,
  args: { folder: string; filename: string; contentType: string },
  env: StorageEnv,
): Promise<UploadResult> {
  const url = env.MEDIA_GATEWAY_URL;
  const token = env.MEDIA_GATEWAY_TOKEN;
  if (!url || !token) throw new StorageError("Media gateway not configured");

  const bucket = env.MEDIA_GATEWAY_BUCKET || env.TRAILERCRAFT_BUCKET || DEFAULTS.bucket;
  const userId = env.MEDIA_GATEWAY_USER_ID || bucket;
  const prefix = sanitizePrefix(env.MEDIA_GATEWAY_UPLOAD_PREFIX || "media-uploads");

  const folder = args.folder.startsWith(`${prefix}/`)
    ? args.folder
    : `${prefix}/${sanitizePrefix(args.folder)}`;

  const form = new FormData();
  form.append("userId", userId);
  form.append("bucket", bucket);
  form.append("folder", folder);
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: args.contentType }),
    args.filename,
  );

  const res = await fetch(`${url.replace(/\/+$/, "")}/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new StorageError(`Media gateway upload failed: ${res.status} ${text.slice(0, 200)}`);
  }

  let parsed: GatewayUploadResponse;
  try {
    parsed = JSON.parse(text) as GatewayUploadResponse;
  } catch {
    throw new StorageError("Media gateway returned a non-JSON response");
  }

  const publicUrl = parsed.publicUrl;
  const objectKey = parsed.objectKey ?? parsed.path;
  if (!publicUrl || !objectKey) {
    throw new StorageError("Media gateway response missing publicUrl/objectKey");
  }
  if (parsed.bucket && parsed.bucket !== bucket) {
    throw new StorageError(
      `Media gateway wrote to bucket "${parsed.bucket}" but "${bucket}" was requested`,
    );
  }

  return { url: publicUrl, key: objectKey, bytes: buffer.byteLength };
}

/**
 * Store an image, preferring the Media API gateway and falling back to direct S3.
 *
 * The gateway provisions the bucket on first write and owns the public-read/CORS
 * policy, so it is the path that matches the rest of the fleet. Direct S3 stays
 * available as a fallback because the same credentials already work for reads.
 */
export async function storeImage(
  buffer: Buffer,
  args: { folder: string; filename: string; contentType: string; key?: string },
  env: StorageEnv,
): Promise<UploadResult> {
  if (env.MEDIA_GATEWAY_URL && env.MEDIA_GATEWAY_TOKEN) {
    return uploadViaMediaGateway(buffer, args, env);
  }
  return uploadObject(
    buffer,
    { prefix: args.folder, contentType: args.contentType, key: args.key },
    env,
  );
}

/**
 * Delete an object.
 *
 * The bucket is a parameter rather than always TRAILERCRAFT_BUCKET so a stray write
 * into a neighbour's bucket can be cleaned up without hand-rolling signing.
 */
export async function deleteObject(
  key: string,
  env: StorageEnv,
  bucketOverride?: string,
): Promise<void> {
  const cfg = requireEnv(env);
  if (!cfg.endpoint) throw new StorageError("RUSTFS_S3_ENDPOINT not set");

  const safeKey = key.replace(/^\/+/, "");
  if (!safeKey || safeKey.includes("..")) {
    throw new StorageError("Invalid object key");
  }

  const bucket = bucketOverride || cfg.bucket;
  const encodedKey = safeKey.split("/").map(encodeURIComponent).join("/");
  const url = `${cfg.endpoint}/${bucket}/${encodedKey}`;

  const headers = signRequest(
    { method: "DELETE", url },
    {
      RUSTFS_ACCESS_KEY: cfg.RUSTFS_ACCESS_KEY,
      RUSTFS_SECRET_KEY: cfg.RUSTFS_SECRET_KEY,
      region: cfg.region,
    },
  );

  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) {
    const detail = await res.text().catch(() => "");
    throw new StorageError(`Delete failed: ${res.status} ${detail.slice(0, 200)}`);
  }
}

/** Fetch an object back as a data URL (used to hand frames to the QC model). */
export async function fetchObjectAsDataUrl(
  key: string,
  env: StorageEnv,
): Promise<string> {
  const { buffer, contentType } = await fetchObject(key, env);
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export interface FetchedObject {
  buffer: Buffer;
  contentType: string;
}

/**
 * Read an object as raw bytes.
 *
 * The bucket is public-read so the QC model can fetch image URLs server-side,
 * but the CDN in front of it will happily cache a response that was requested
 * without an `Origin` header and then replay it *without* CORS headers. That
 * breaks `fetch()` from the browser while `<img>` still works, which is a
 * maddening failure to debug. Serving bytes through the app's own same-origin
 * route sidesteps it entirely.
 */
export async function fetchObject(
  key: string,
  env: StorageEnv,
): Promise<FetchedObject> {
  const cfg = requireEnv(env);
  if (!cfg.endpoint) throw new StorageError("RUSTFS_S3_ENDPOINT not set");

  const safeKey = key.replace(/^\/+/, "");
  if (safeKey.includes("..")) throw new StorageError("Invalid object key");

  const url = `${cfg.endpoint}/${cfg.bucket}/${safeKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const headers = signRequest(
    { method: "GET", url },
    { RUSTFS_ACCESS_KEY: cfg.RUSTFS_ACCESS_KEY, RUSTFS_SECRET_KEY: cfg.RUSTFS_SECRET_KEY, region: cfg.region },
  );

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new StorageError(`Fetch failed: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    buffer,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
