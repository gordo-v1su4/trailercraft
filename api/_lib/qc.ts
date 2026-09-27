/**
 * Shot QC: a vision model grades consistency across rendered shots and returns
 * structured, actionable edit notes.
 *
 * Images are passed to the model as public RustFS URLs rather than base64. That
 * keeps the request small and avoids re-uploading 2.6 MB per shot on every pass.
 */

import { generateJson, type LlmEnv } from "./llm";

export type QcEnv = LlmEnv;

export interface QcShot {
  /** Public URL of the rendered shot. */
  url: string;
  title?: string;
  /** The prompt the shot was generated from. */
  prompt?: string;
}

export interface QcFinding {
  shotIndex: number;
  severity: "low" | "medium" | "high";
  category: "consistency" | "composition" | "style" | "artifact" | "prompt-drift";
  note: string;
}

export interface QcReport {
  overallScore: number;
  verdict: string;
  consistency: {
    characterConsistency: string;
    lightingContinuity: string;
    paletteContinuity: string;
  };
  findings: QcFinding[];
  editSuggestions: string[];
}

const SYSTEM = `You are a strict film continuity supervisor doing picture QC on AI-generated trailer shots.

You will be given several shots in narrative order. Judge them as a sequence, not in isolation.

Return strict JSON only, matching exactly:
{
  "overallScore": <0-100 integer>,
  "verdict": "<one sentence>",
  "consistency": {
    "characterConsistency": "<assessment>",
    "lightingContinuity": "<assessment>",
    "paletteContinuity": "<assessment>"
  },
  "findings": [
    { "shotIndex": <0-based index>, "severity": "low"|"medium"|"high", "category": "consistency"|"composition"|"style"|"artifact"|"prompt-drift", "note": "<specific, actionable>" }
  ],
  "editSuggestions": ["<concrete cut/reorder/regenerate instruction>"]
}

Be specific and critical. Reference shots by index. Do not invent problems that are not visible.`;


export async function runQc(
  shots: QcShot[],
  direction: string | undefined,
  env: QcEnv,
  timeoutMs = 180_000,
): Promise<{ report: QcReport; provider: string }> {
  if (shots.length === 0) {
    throw new Error("runQc requires at least one shot");
  }

  const content: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text:
        `Grade these ${shots.length} trailer shots for continuity.\n` +
        (direction ? `Creative direction: ${direction}\n` : "") +
        "Shots in order:",
    },
  ];

  shots.forEach((shot, i) => {
    content.push({ type: "text", text: `\n[Shot ${i}] ${shot.title ?? "Untitled"}` });
    content.push({ type: "image_url", image_url: { url: shot.url } });
  });

  const { data: report, provider } = await generateJson<QcReport>(
    { prompt: content, systemInstruction: SYSTEM, maxTokens: 4000 },
    env,
    timeoutMs,
  );

  return { report, provider };
}
