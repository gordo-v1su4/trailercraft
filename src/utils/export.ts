import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { TimelineClip } from "../types";

export interface ExportOptions {
  clips: TimelineClip[];
  audioBuffer: AudioBuffer | null;
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: number;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Tried in order; the first config the browser accepts wins. `avc1.42001f` is
 * Baseline 3.1, which caps out at 720p30, so 1080p needs a High profile codec.
 */
const VIDEO_CODECS = [
  "avc1.640028", // High 4.0 — 1080p
  "avc1.4d0028", // Main 4.0 — 1080p
  "avc1.42001f", // Baseline 3.1 — 720p
];

const AUDIO_CODEC = "mp4a.40.2";
const AUDIO_FRAME_SAMPLES = 1024;
const QUEUE_HIGH_WATER = 8;

interface ChosenVideoConfig {
  codec: string;
  width: number;
  height: number;
}

function abortError(): DOMException {
  return new DOMException("Export cancelled", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

async function pickVideoConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number,
): Promise<ChosenVideoConfig | null> {
  if (typeof VideoEncoder === "undefined") return null;

  for (const codec of VIDEO_CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: "avc" },
      hardwareAcceleration: "prefer-hardware",
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return { codec: support.config?.codec ?? codec, width, height };
      }
    } catch {
      // Try the next codec string.
    }
  }
  return null;
}

async function audioSupported(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: AUDIO_CODEC,
      sampleRate: 44100,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
    return Boolean(support.supported);
  } catch {
    return false;
  }
}

export async function isExportSupported(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined" || typeof OffscreenCanvas === "undefined") {
    return false;
  }
  const video = await pickVideoConfig(1280, 720, 30, 5_000_000);
  return video !== null;
}

export async function exportTimelineToMp4(opts: ExportOptions): Promise<Blob> {
  const {
    clips,
    audioBuffer,
    fps = 30,
    onProgress,
    signal,
  } = opts;

  const usable = clips.filter((c) => c.imageUrl);
  if (usable.length === 0) {
    throw new Error("Add at least one rendered clip to the timeline before exporting.");
  }

  throwIfAborted(signal);

  // Cap dimensions to what the first supported codec can actually do.
  const probe = await pickVideoConfig(1280, 720, fps, 1_000_000);
  if (!probe) {
    throw new Error("This browser cannot encode H.264 with WebCodecs.");
  }
  const maxWidth = 1920;
  const maxHeight = 1080;
  const sourceAspect = 16 / 9;
  let width = even(Math.min(maxWidth, opts.width ?? maxWidth));
  let height = even(Math.min(maxHeight, opts.height ?? maxHeight));
  if (width / height > sourceAspect) {
    width = even(height * sourceAspect);
  } else {
    height = even(width / sourceAspect);
  }

  const bitrate = opts.videoBitrate ?? Math.round(width * height * fps * 0.09);
  const chosen = await pickVideoConfig(width, height, fps, bitrate);
  if (!chosen) throw new Error("No supported H.264 encoder configuration found.");
  width = chosen.width;
  height = chosen.height;

  const totalSeconds = usable.reduce((sum, c) => sum + (c.duration || 0), 0);
  if (totalSeconds <= 0) throw new Error("Timeline has zero total duration.");

  const withAudio = audioBuffer !== null && (await audioSupported());
  const sampleRate = withAudio && audioBuffer ? audioBuffer.sampleRate : 44100;
  const channels = withAudio && audioBuffer ? Math.min(2, audioBuffer.numberOfChannels) : 2;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer<ArrayBufferTarget>({
    target,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
    video: { codec: "avc", width, height, frameRate: fps },
    ...(withAudio ? { audio: { codec: "aac" as const, numberOfChannels: channels, sampleRate } } : {}),
  });

  let encodeError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encodeError = e instanceof Error ? e : new Error(String(e));
    },
  });
  videoEncoder.configure({
    codec: chosen.codec,
    width,
    height,
    bitrate,
    framerate: fps,
    avc: { format: "avc" },
    hardwareAcceleration: "prefer-hardware",
  });

  let audioEncoder: AudioEncoder | null = null;
  if (withAudio && audioBuffer) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => {
        encodeError = e instanceof Error ? e : new Error(String(e));
      },
    });
    audioEncoder.configure({
      codec: AUDIO_CODEC,
      sampleRate,
      numberOfChannels: channels,
      bitrate: 128_000,
    });
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not acquire a 2D canvas context for export.");

  const totalFrames = Math.max(1, Math.round(totalSeconds * fps));
  let frameIndex = 0;
  let elapsed = 0;

  try {
    for (const clip of usable) {
      throwIfAborted(signal);
      if (encodeError) throw encodeError;

      const bitmap = await fetchClipImage(clip.imageUrl as string, signal);
      const frames = Math.max(1, Math.round((clip.duration || 0) * fps));

      // Cover-fit the source into the output frame.
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      const drawW = bitmap.width * scale;
      const drawH = bitmap.height * scale;

      for (let i = 0; i < frames; i++) {
        throwIfAborted(signal);
        if (encodeError) throw encodeError;

        const timestamp = Math.round((elapsed + i / fps) * 1_000_000);
        const isKey = i === 0;

        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(bitmap, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);

        const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(1_000_000 / fps) });
        try {
          videoEncoder.encode(frame, { keyFrame: isKey });
        } finally {
          frame.close();
        }

        // Without this the encoder queue grows without bound and the tab OOMs.
        while (videoEncoder.encodeQueueSize > QUEUE_HIGH_WATER) {
          await new Promise<void>((resolve) => {
            videoEncoder.addEventListener("dequeue", () => resolve(), { once: true });
          });
        }

        frameIndex++;
        onProgress?.(Math.min(0.99, frameIndex / totalFrames));
      }

      bitmap.close();
      elapsed += clip.duration || 0;
    }

    throwIfAborted(signal);
    if (encodeError) throw encodeError;

    await videoEncoder.flush();
    if (audioEncoder) await audioEncoder.flush();

    if (withAudio && audioBuffer && audioEncoder) {
      encodeAudio(audioEncoder, audioBuffer, sampleRate, channels, signal);
      await audioEncoder.flush();
    }

    muxer.finalize();
    onProgress?.(1);

    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    if (videoEncoder.state !== "closed") videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== "closed") audioEncoder.close();
  }
}

/**
 * Same-origin by design. Fetching the RustFS public URL directly works in dev
 * and then fails intermittently in production, because the CDN caches responses
 * that were requested without an `Origin` header and replays them without CORS
 * headers. Going through /api/asset removes that whole class of failure.
 */
function toAssetPath(publicUrl: string): string | null {
  const withoutScheme = publicUrl.replace(/^https?:\/\/[^/]+/i, "");
  const segments = withoutScheme.split("/").filter(Boolean);
  // Expect: <bucket>/<objectKey...>
  if (segments.length < 2) return null;
  const [bucket, ...keyParts] = segments;
  if (bucket !== "trailercraft") return null;
  return `/api/asset?key=${encodeURIComponent(keyParts.join("/"))}`;
}

async function fetchClipImage(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  const path = toAssetPath(url);
  if (!path) {
    throw new Error(`Clip image is not a TRAILERCRAFT asset URL: ${url}`);
  }
  const res = await fetch(path, { signal });
  if (!res.ok) {
    throw new Error(`Could not fetch clip image (${res.status}).`);
  }
  return createImageBitmap(await res.blob());
}

function encodeAudio(
  encoder: AudioEncoder,
  buffer: AudioBuffer,
  sampleRate: number,
  channels: number,
  signal?: AbortSignal,
): void {
  // Planar f32 keeps this simple; downmix to the target channel count inline.
  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const source = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
    planes.push(source instanceof Float32Array ? source : new Float32Array(source));
  }

  const totalFrames = buffer.length;
  const frameCount = Math.ceil(totalFrames / AUDIO_FRAME_SAMPLES);

  for (let f = 0; f < frameCount; f++) {
    if (signal?.aborted) throw abortError();

    const offset = f * AUDIO_FRAME_SAMPLES;
    const count = Math.min(AUDIO_FRAME_SAMPLES, totalFrames - offset);
    const interleavedPlanar = new Float32Array(count * channels);
    for (let c = 0; c < channels; c++) {
      interleavedPlanar.set(planes[c].subarray(offset, offset + count), c * count);
    }

    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: channels,
      timestamp: Math.round((offset / buffer.sampleRate) * 1_000_000),
      data: interleavedPlanar,
    });

    try {
      encoder.encode(data);
    } finally {
      data.close();
    }
  }
}
