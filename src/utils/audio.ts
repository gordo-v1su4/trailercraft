import type { AudioMarker } from "../types";

export function detectTransients(
  audioBuffer: AudioBuffer,
  { sensitivity = 0.65 }: { sensitivity?: number } = {}
): AudioMarker[] {
  const rawData = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const markers: AudioMarker[] = [];
  const normalizedSensitivity = Math.min(Math.max(sensitivity, 0.2), 0.95);
  const threshold = 0.15 + (1 - normalizedSensitivity) * 0.55;
  const minDistance = 0.12 + (1 - normalizedSensitivity) * 0.45;

  let lastMarkerTime = -minDistance;
  const windowSize = Math.floor(sampleRate * 0.01);

  for (let i = 0; i < rawData.length; i += windowSize) {
    let energy = 0;
    let peak = 0;
    for (let j = 0; j < windowSize && i + j < rawData.length; j++) {
      const sample = rawData[i + j];
      energy += Math.abs(sample);
      if (Math.abs(sample) > peak) peak = Math.abs(sample);
    }
    const avgEnergy = energy / windowSize;

    if (avgEnergy > threshold) {
      const time = i / sampleRate;
      if (time - lastMarkerTime > minDistance) {
        markers.push({
          id: Date.now() + i,
          time: parseFloat(time.toFixed(3)),
          type: "auto",
          strength: parseFloat((avgEnergy * 0.7 + peak * 0.3).toFixed(4)),
        });
        lastMarkerTime = time;
      }
    }
  }
  return markers;
}

export const MARKER_DENSITY_LEVELS: Record<string, number> = {
  all: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

export function drawWaveform(canvas: HTMLCanvasElement, audioBuffer: AudioBuffer) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);
  ctx.beginPath();
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  for (let i = 0; i < width; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    ctx.moveTo(i, (1 + min) * amp);
    ctx.lineTo(i, (1 + max) * amp);
  }
  ctx.stroke();
}
