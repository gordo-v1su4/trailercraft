import { useState } from "react";
import { Upload, Plus, Trash2, Sparkles, Edit3, Loader2, AlertTriangle } from "lucide-react";
import { SAVE_THE_CAT_BEATS } from "../constants/storyBeats";
import { FILM_DIRECTOR_SYSTEM_INSTRUCTION_IMAGE } from "../constants";
import { fileToDataUrl, fileToVisionDataUrl } from "../utils/helpers";
import { callKimi, ApiError } from "../utils/api";
import { ErrorBanner } from "./ErrorBanner";
import { ImageLightbox } from "./ImageLightbox";
import { StoryBeatInput } from "./StoryBeatInput";
import type { CharacterDescription, ImageData, StoryBeatsMap } from "../types";

interface StoryStepProps {
  storyBeats: StoryBeatsMap;
  setStoryBeats: (beats: StoryBeatsMap) => void;
  visualStyle: string;
  setVisualStyle: (style: string) => void;
  inspirationImages: string[];
  setInspirationImages: (images: string[]) => void;
  referenceImageData: ImageData[];
  setReferenceImageData: (data: ImageData[]) => void;
  characterDescriptions: CharacterDescription[];
  setCharacterDescriptions: (chars: CharacterDescription[]) => void;
  onCreateSheet: (character: CharacterDescription, index: number) => void;
  isAIProcessing: boolean;
  setIsAIProcessing: (v: boolean) => void;
  generationStatus: string;
  setGenerationStatus: (s: string) => void;
  projectTitle: string;
  setProjectTitle: (t: string) => void;
  suggestedTitles: string[];
  setSuggestedTitles: (t: string[]) => void;
  showTitleOptions: boolean;
  setShowTitleOptions: (v: boolean) => void;
  accentHex: string;
  onNext: () => void;
}

export function StoryStep(props: StoryStepProps) {
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ src: string; alt: string; caption: string } | null>(null);
  const [sheetUrls, setSheetUrls] = useState<Record<number, string>>({});
  const [lastAction, setLastAction] = useState<(() => void) | null>(null);
  const {
    storyBeats, setStoryBeats, visualStyle, setVisualStyle,
    inspirationImages, setInspirationImages, referenceImageData, setReferenceImageData,
    characterDescriptions, setCharacterDescriptions, onCreateSheet,
    isAIProcessing, setIsAIProcessing, generationStatus, setGenerationStatus,
    projectTitle: _projectTitle, setProjectTitle, suggestedTitles, setSuggestedTitles,
    showTitleOptions, setShowTitleOptions, accentHex, onNext,
  } = props;

  const needsCharacter = characterDescriptions.length === 0;

  const handleInspirationUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).slice(0, 8);
    if (files.length === 0) return;

    try {
      setIsAIProcessing(true);
      setGenerationStatus(`Analyzing ${files.length} reference image(s)...`);

      const dataUrls = await Promise.all(files.map(fileToDataUrl));
      setInspirationImages([...inspirationImages, ...dataUrls]);
      setReferenceImageData(
        [...referenceImageData, ...files.map((f, i) => ({
          base64: dataUrls[i].split(",")[1] ?? "",
          mimeType: f.type || "image/jpeg",
        }))],
      );

      const visionImages = await Promise.all(files.slice(0, 4).map(fileToVisionDataUrl));

      const prompt = `
        Analyze this input image carefully:

        1. **INPUT IMAGE ANALYSIS:** Describe the subject, core action, setting, and existing composition.
        2. **CHARACTER IDENTIFICATION:** If the image contains characters, extract detailed descriptions for EACH character including:
           - Physical appearance (age, build, height, hair color/style, clothing, distinctive features, facial features)
           - Character role/archetype (hero, villain, supporting character, etc.)
           - Emotional state and expression
           - Any unique identifiers (scars, accessories, props, etc.)
        3. **STYLE IDENTIFICATION:** Identify its visual style (lighting, color palette, mood, film era, director influences).
        4. **STORY GENERATION:** Hallucinate a movie plot that this image would be a key scene in.
        5. **TRAILER STRUCTURE:** Generate a complete Save the Cat story structure (15 beats) for this plot.

        Return a JSON object with this schema:
        {
          "logic_engine": "vision-model",
          "input_image_analysis": { "subject": "string", "action": "string", "setting": "string", "composition": "string" },
          "characters": [{ "name": "string", "description": "detailed physical description", "role": "string", "distinctiveFeatures": "string" }],
          "visualStyle": "string",
          "story": { ${SAVE_THE_CAT_BEATS.map((b) => `"${b.id}": "string"`).join(", ")} }
        }

        Note: If no characters are present, return an empty array for "characters".
      `;

      const result = await callKimi<{
        characters?: Array<{ name: string; description: string; role: string; distinctiveFeatures: string }>;
        visualStyle?: string;
        story?: Record<string, string>;
      }>(prompt, FILM_DIRECTOR_SYSTEM_INSTRUCTION_IMAGE, { images: visionImages });

      if (result) {
        // A follow-up image may legitimately contain no faces. Merge rather than
        // overwrite so an earlier good detection is not lost.
        if (result.characters?.length) {
          const seen = new Set(characterDescriptions.map((c) => c.name));
          // Attribution is a guess here: one analysis call sees every reference at
          // once, so the model cannot say which face came from which file. Default
          // to the first reference and let the per-character selector correct it.
          const merged = [
            ...characterDescriptions,
            ...result.characters
              .filter((c) => !seen.has(c.name))
              .map((c) => ({ ...c, sourceImageIndex: 0, sheetStatus: "idle" as const })),
          ];
          setCharacterDescriptions(merged);
        }
        if (result.visualStyle) setVisualStyle(result.visualStyle);
        const newBeats: StoryBeatsMap = {};
        SAVE_THE_CAT_BEATS.forEach((beat) => {
          newBeats[beat.id] = result.story?.[beat.id] || storyBeats[beat.id] || "";
        });
        setStoryBeats({ ...storyBeats, ...newBeats });
      }
      setError(null);
    } catch (e) {
      setLastAction(null);
      setError(e instanceof ApiError ? e.describe() : String(e));
    } finally {
      setIsAIProcessing(false);
    }
  };

  const removeImage = (idx: number) => {
    setInspirationImages(inspirationImages.filter((_, i) => i !== idx));
    setReferenceImageData(referenceImageData.filter((_, i) => i !== idx));
  };

  const polishScript = async () => {
    const hasContent = Object.values(storyBeats).some((v) => v.length > 0);
    if (!hasContent) return;
    setIsAIProcessing(true);
    setGenerationStatus("Polishing Script...");

    try {
      const prompt = `Rewrite these story beats to be punchy, dramatic, and cinematic trailer narration following Save the Cat structure. Input Beats: ${JSON.stringify(storyBeats)} Return a JSON object with the same keys: ${SAVE_THE_CAT_BEATS.map((b) => b.id).join(", ")}.`;
      const result = await callKimi<StoryBeatsMap>(
        prompt,
        "You are a world-class Film Director and screenwriter. Return strict JSON only.",
      );
      if (result) {
        const polished: StoryBeatsMap = {};
        SAVE_THE_CAT_BEATS.forEach((beat) => {
          polished[beat.id] = result[beat.id] || storyBeats[beat.id] || "";
        });
        setStoryBeats(polished);
      }
      setError(null);
    } catch (e) {
      setLastAction(() => polishScript);
      setError(e instanceof ApiError ? e.describe() : String(e));
    } finally {
      setIsAIProcessing(false);
    }
  };

  const generateTitles = async () => {
    const hasContent = Object.values(storyBeats).some((v) => v.length > 0);
    if (!hasContent) return;
    setIsAIProcessing(true);
    setGenerationStatus("Generating Titles...");

    try {
      const keyBeats = [storyBeats.openingImage, storyBeats.catalyst, storyBeats.midpoint, storyBeats.finale].filter(Boolean).join("\n");
      const prompt = `Generate 5 catchy, cinematic movie titles based on this plot summary: ${keyBeats} Return a JSON object with a 'titles' array of strings.`;
      const result = await callKimi<{ titles?: string[] }>(
        prompt,
        "You are a world-class Film Director and screenwriter. Generate creative movie titles. Return strict JSON only.",
      );
      if (result?.titles) {
        setSuggestedTitles(result.titles);
        setShowTitleOptions(true);
      }
      setError(null);
    } catch (e) {
      setLastAction(() => generateTitles);
      setError(e instanceof ApiError ? e.describe() : String(e));
    } finally {
      setIsAIProcessing(false);
    }
  };

  const hasContent = Object.values(storyBeats).some((v) => v.length > 0);

  return (
    <div className="max-w-[920px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 border-b border-white/5 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border mb-3" style={{ backgroundColor: `${accentHex}12`, borderColor: `${accentHex}30` }}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentHex }} />
            <span className="text-[10px] font-mono text-white/90 tracking-wide">STEP 01 • STORY • SAVE THE CAT</span>
          </div>
          <h1 className="text-[40px] sm:text-[56px] lg:text-[64px] font-[800] tracking-[-0.04em] leading-[0.85] text-white" style={{ fontFamily: "Archivo Narrow, sans-serif" }}>
            CONSTRUCT NARRATIVE
          </h1>
          <p className="text-[13px] text-[#7a8089] mt-3 max-w-md">Map out the key moments. Upload reference images for AI analysis, or write manually.</p>
        </div>
        <div className="hidden sm:block text-right text-[10px] font-mono text-[#5a616c] leading-relaxed pt-2">
          {visualStyle}<br />
          {characterDescriptions.length} characters<br />
          <span style={{ color: accentHex }}>{hasContent ? "Ready →" : "Awaiting input"}</span>
        </div>
      </div>

      {/* Title suggestions dropdown */}
      {showTitleOptions && suggestedTitles.length > 0 && (
        <div className="mb-6 rounded-[8px] bg-[#111116] border border-white/10 p-3">
          <div className="flex justify-between items-center mb-2 border-b border-white/5 pb-2">
            <span className="text-[10px] font-mono text-[#6c727c] uppercase tracking-wide">Suggested Titles</span>
            <button onClick={() => setShowTitleOptions(false)} className="text-[#5a616c] hover:text-white text-[10px]">✕</button>
          </div>
          <div className="space-y-0.5">
            {suggestedTitles.map((t, i) => (
              <button
                key={i}
                onClick={() => { setProjectTitle(t); setShowTitleOptions(false); }}
                className="block w-full text-left px-2.5 py-2 hover:bg-white/5 text-[12px] rounded-[4px] text-[#c9ccd1] transition-all font-medium"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {needsCharacter && inspirationImages.length > 0 && (
        <div
          className="mb-4 rounded-[8px] border px-3 py-2.5 flex items-start gap-2.5"
          style={{ backgroundColor: "rgba(245,165,36,0.07)", borderColor: "rgba(245,165,36,0.3)" }}
        >
          <AlertTriangle size={13} className="shrink-0 mt-0.5" style={{ color: "#f5a524" }} />
          <div className="text-[10px] leading-relaxed">
            <div className="text-[#fed7aa] font-medium">
              No character detected — this is a hard stop.
            </div>
            <div className="text-[#c9a06a] mt-0.5">
              Character consistency is what keeps a face recognisable across every
              shot. Add a reference image that clearly shows a character (face
              visible, not a wide silhouette), or the beat cannot continue.
            </div>
          </div>
        </div>
      )}

      {/* Reference Images Upload */}
      <div className="mb-8">
        <div className="text-[10px] font-mono text-[#6c727c] uppercase tracking-wide mb-3">REFERENCE IMAGES • UP TO 8</div>
        <div className="rounded-[10px] border border-dashed border-white/10 p-4 transition-all hover:border-white/20 bg-[#0b0b0e]">
          {inspirationImages.length === 0 ? (
            <label className="cursor-pointer flex flex-col items-center gap-3 text-[#5a616c] hover:text-white transition-colors py-6">
              <div className="p-3 rounded-full bg-white/5 border border-white/10">
                <Upload size={20} />
              </div>
              <div className="flex flex-col gap-0.5 text-center">
                <span className="text-[12px] font-medium text-[#9aa0a8]">Upload Reference Images</span>
                <span className="text-[10px] text-[#5a616c]">AI will analyze style, characters, and generate story beats</span>
              </div>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleInspirationUpload} />
            </label>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {inspirationImages.map((url, idx) => (
                  <div key={idx} className="relative aspect-video rounded-[6px] overflow-hidden border border-white/10 bg-[#0c0c0f]">
                    <img src={url} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 p-1 bg-[#ef4343]/80 hover:bg-[#ef4343] rounded text-white"
                    >
                      <Trash2 size={10} />
                    </button>
                    <div className="absolute bottom-1 left-1 bg-black/80 px-1.5 py-0.5 rounded text-[8px] font-mono text-[#9aa0a8]">
                      {idx + 1}/{inspirationImages.length}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {inspirationImages.length < 8 && (
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-[5px] text-[11px] text-[#c9ccd1] transition-all border border-white/10">
                    <Plus size={12} /> Add More ({inspirationImages.length}/8)
                    <input type="file" accept="image/*" multiple className="hidden" onChange={handleInspirationUpload} />
                  </label>
                )}
                {isAIProcessing && generationStatus.includes("Analyzing") && (
                  <div className="flex items-center gap-2 text-[11px] text-[#9aa0a8]">
                    <Loader2 size={12} className="animate-spin" style={{ color: accentHex }} />
                    {generationStatus}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Characters detected */}
      {characterDescriptions.length > 0 && (
        <div className="mb-8">
          <div className="text-[10px] font-mono text-[#6c727c] uppercase tracking-wide mb-1">
            Characters detected • {characterDescriptions.length}
          </div>
          <p className="text-[9px] text-[#5a616c] mb-3 leading-snug">
            Each character needs one canonical reference sheet. Once a sheet exists, shots refer
            to that character by name and the sheet defines their appearance.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {characterDescriptions.map((char, i) => {
              const busy = char.sheetStatus === "generating";
              return (
                <div key={i} className="rounded-[6px] bg-[#0f0f12] border border-white/[0.08] p-3">
                  <div className="flex gap-3">
                    {char.sheetUrl ? (
                      <button
                        onClick={() =>
                          setPreview({
                            src: char.sheetUrl as string,
                            alt: `${char.name} character sheet`,
                            caption: `${char.name} — canonical reference sheet`,
                          })
                        }
                        title="Preview full size"
                        className="w-20 h-20 rounded-[4px] shrink-0 border border-white/10 overflow-hidden hover:border-white/40 transition-colors"
                      >
                        <img
                          src={char.sheetUrl}
                          alt={`${char.name} character sheet`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : char.sourceImageIndex !== undefined &&
                      referenceImageData[char.sourceImageIndex] ? (
                      <button
                        onClick={() =>
                          setPreview({
                            src: `data:${referenceImageData[char.sourceImageIndex as number].mimeType};base64,${referenceImageData[char.sourceImageIndex as number].base64}`,
                            alt: `Source reference ${(char.sourceImageIndex as number) + 1}`,
                            caption: `${char.name || "Character"} — detected in reference ${(char.sourceImageIndex as number) + 1}`,
                          })
                        }
                        title="Preview full size"
                        className="w-20 h-20 rounded-[4px] shrink-0 border border-white/10 overflow-hidden hover:border-white/40 transition-colors"
                      >
                        <img
                          src={`data:${referenceImageData[char.sourceImageIndex].mimeType};base64,${referenceImageData[char.sourceImageIndex].base64}`}
                          alt={`Source reference ${char.sourceImageIndex + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : null}

                    <div className="min-w-0 flex-1">
                      <input
                        value={char.name}
                        onChange={(e) => {
                          const next = [...characterDescriptions];
                          next[i] = { ...char, name: e.target.value };
                          setCharacterDescriptions(next);
                        }}
                        placeholder={`Character ${i + 1}`}
                        className="w-full bg-transparent border-b border-white/10 focus:border-white/30 outline-none text-[11px] font-medium text-white mb-1"
                      />
                      <div className="text-[10px] text-[#7a8089] leading-snug line-clamp-4">
                        {char.description}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2">
                    <span className="text-[9px] font-mono text-[#5a616c] uppercase">Source ref</span>
                    {referenceImageData.map((_, ri) => (
                      <button
                        key={ri}
                        onClick={() => {
                          const next = [...characterDescriptions];
                          next[i] = { ...char, sourceImageIndex: ri };
                          setCharacterDescriptions(next);
                        }}
                        className={`px-1.5 py-0.5 rounded-[3px] text-[9px] font-mono border transition-colors ${
                          (char.sourceImageIndex ?? 0) === ri
                            ? "border-white/40 text-white"
                            : "border-white/10 text-[#6c727c] hover:text-white"
                        }`}
                      >
                        {ri + 1}
                      </button>
                    ))}
                  </div>
                  {char.sheetError && (
                    <div className="text-[9px] text-red-400/80 mt-1">{char.sheetError}</div>
                  )}

                  <div className="flex gap-1 mt-2">
                    <input
                      value={sheetUrls[i] ?? char.sheetUrl ?? ""}
                      onChange={(e) => setSheetUrls((p) => ({ ...p, [i]: e.target.value }))}
                      placeholder="or paste a sheet URL"
                      className="flex-1 min-w-0 bg-black/30 border border-white/10 rounded-[4px] px-1.5 py-1 text-[9px] font-mono text-[#a0a6b0] placeholder:text-[#4a505a] focus:border-white/30 outline-none"
                    />
                    <button
                      onClick={() => {
                        const url = (sheetUrls[i] ?? "").trim();
                        if (!url) return;
                        const next = [...characterDescriptions];
                        next[i] = { ...char, sheetUrl: url, sheetStatus: "ready", sheetError: undefined };
                        setCharacterDescriptions(next);
                      }}
                      className="px-2 rounded-[4px] border border-white/10 text-[9px] font-mono uppercase text-[#a0a6b0] hover:text-white hover:border-white/25 transition-colors"
                    >
                      Attach
                    </button>
                  </div>

                  <button
                    onClick={() => onCreateSheet(char, i)}
                    disabled={busy || char.sourceImageIndex === undefined}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-[4px] border border-white/10 px-2 py-1.5 text-[9px] font-mono uppercase tracking-wide text-[#a0a6b0] hover:text-white hover:border-white/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {busy ? (
                      <>
                        <Loader2 size={10} className="animate-spin" /> Building sheet...
                      </>
                    ) : char.sheetUrl ? (
                      "Rebuild character sheet"
                    ) : (
                      <>
                        <Sparkles size={10} /> Create character sheet
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {preview && (
        <ImageLightbox src={preview.src} alt={preview.alt} caption={preview.caption} onClose={() => setPreview(null)} />
      )}

      {error && (
        <ErrorBanner
          title="Request failed"
          detail={error}
          accentHex={accentHex}
          onRetry={lastAction ?? undefined}
          onDismiss={() => setError(null)}
        />
      )}

      {/* AI Action Bar */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={polishScript}
          disabled={isAIProcessing || !hasContent}
          className="h-7 px-3 rounded-[5px] text-[11px] font-medium flex items-center gap-1.5 transition-all disabled:opacity-40 border border-white/10 text-[#c9ccd1] hover:border-white/20 hover:text-white"
          style={{ backgroundColor: `${accentHex}15` }}
        >
          <Sparkles size={12} style={{ color: accentHex }} /> Polish Script
        </button>
        <button
          onClick={generateTitles}
          disabled={isAIProcessing || !hasContent}
          className="h-7 px-3 rounded-[5px] text-[11px] font-medium flex items-center gap-1.5 transition-all disabled:opacity-40 border border-white/10 text-[#c9ccd1] hover:border-white/20 hover:text-white bg-white/5"
        >
          <Edit3 size={12} /> Gen Titles
        </button>
        <div className="flex-1" />
        {isAIProcessing && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-[#7a8089]">
            <Loader2 size={11} className="animate-spin" style={{ color: accentHex }} />
            {generationStatus}
          </div>
        )}
      </div>

      {/* Story Beats */}
      <div className="rounded-[10px] bg-[#0b0b0e] border border-white/[0.06] p-4 sm:p-5 space-y-4">
        {SAVE_THE_CAT_BEATS.map((beat) => (
          <StoryBeatInput
            key={beat.id}
            label={beat.label}
            description={beat.description}
            placeholder={beat.placeholder}
            value={storyBeats[beat.id] || ""}
            onChange={(v) => setStoryBeats({ ...storyBeats, [beat.id]: v })}
            accentHex={accentHex}
          />
        ))}
      </div>

      {/* Continue button */}
      <div className="mt-8 flex items-center justify-between">
        <div className="text-[10px] font-mono text-[#5a616c]">
          {Object.values(storyBeats).filter((v) => v.length > 0).length} / {SAVE_THE_CAT_BEATS.length} beats filled
        </div>
        <div className="flex items-center gap-3">
          {needsCharacter && (
            <span className="text-[10px] font-mono text-[#f5a524]">
              needs 1+ character
            </span>
          )}
          <button
            onClick={onNext}
            disabled={!hasContent || needsCharacter}
            title={
              needsCharacter
                ? "Detect at least one character from a reference image first"
                : undefined
            }
            className="h-9 px-5 rounded-[6px] text-[12px] font-medium text-white transition-all disabled:opacity-40 flex items-center gap-2"
            style={{ backgroundColor: accentHex }}
          >
            Continue to Generation →
          </button>
        </div>
      </div>
    </div>
  );
}
