import type { LucideIcon } from "lucide-react";

export interface StoryBeat {
  id: string;
  label: string;
  placeholder: string;
  description: string;
}

export type StoryBeatsMap = Record<string, string>;

export interface ImageData {
  base64: string;
  mimeType: string;
}

export interface CharacterDescription {
  name: string;
  description: string;
  role: string;
  distinctiveFeatures: string;
  /**
   * Canonical reference sheet. Once this exists it is the source of truth for the
   * character, and shot prompts refer to `name` rather than restating prose.
   */
  sheetUrl?: string;
  sheetStatus?: "idle" | "generating" | "ready" | "failed";
  sheetError?: string;
  /** Which uploaded reference this character was detected in, for provenance. */
  sourceImageIndex?: number;
}

export interface Scene {
  id: string;
  beatId: string;
  beatTitle: string;
  title: string;
  variantType: string;
  prompt: string;
  color: string;
  icon: LucideIcon | null;
  duration: number;
  imageUrl: string | null;
  isRendering: boolean;
}

export interface TimelineClip extends Scene {
  instanceId: number;
  start: number;
  end: number;
}

export interface AudioMarker {
  id: number;
  time: number;
  type: "auto" | "manual";
  strength: number;
}

export type StepId = "story" | "generation" | "timeline";

export interface AccentColor {
  name: string;
  hex: string;
  ink: string;
}
