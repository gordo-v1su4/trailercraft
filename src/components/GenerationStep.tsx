import { useState } from "react";
import { Loader2, RotateCcw, Layers, Film } from "lucide-react";
import { ErrorBanner } from "./ErrorBanner";
import { ImageLightbox } from "./ImageLightbox";
import { SceneCard } from "./SceneCard";
import type { Scene, CharacterDescription, ImageData, StoryBeatsMap } from "../types";

interface GenerationStepProps {
  storyBeats: StoryBeatsMap;
  generatedScenes: Scene[];
  setGeneratedScenes: (scenes: Scene[]) => void;
  visualStyle: string;
  characterDescriptions: CharacterDescription[];
  referenceImageData: ImageData[];
  isAIProcessing: boolean;
  setIsAIProcessing: (v: boolean) => void;
  generationStatus: string;
  setGenerationStatus: (s: string) => void;
  accentHex: string;
  onRenderImage: (sceneId: string, prompt: string) => void;
  onGenerateAssets: () => void;
  onRegenerateBeat: (beatId: string) => void;
  onPrev: () => void;
  onNext: () => void;
  error?: string | null;
  onDismissError?: () => void;
}

export function GenerationStep(props: GenerationStepProps) {
  const [preview, setPreview] = useState<{ src: string; alt: string; caption: string } | null>(null);
  const {
    storyBeats, generatedScenes, setGeneratedScenes: _setGeneratedScenes,
    visualStyle, characterDescriptions, referenceImageData: _referenceImageData,
    isAIProcessing, generationStatus, accentHex,
    onRenderImage, onGenerateAssets, onRegenerateBeat, onPrev, onNext, error, onDismissError,
  } = props;

  const hasContent = Object.values(storyBeats).some((v) => v.length > 0);

  // Group scenes by beatTitle
  const groupedScenes: Record<string, Scene[]> = {};
  generatedScenes.forEach((scene) => {
    if (!groupedScenes[scene.beatTitle]) groupedScenes[scene.beatTitle] = [];
    groupedScenes[scene.beatTitle].push(scene);
  });

  const renderedCount = generatedScenes.filter((s) => s.imageUrl).length;
  const totalCount = generatedScenes.length;

  return (
    <div className="max-w-[920px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 border-b border-white/5 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border mb-3" style={{ backgroundColor: `${accentHex}12`, borderColor: `${accentHex}30` }}>
            <span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentHex }} />
            <span className="text-[10px] font-mono text-white/90 tracking-wide">STEP 02 • GENERATION • SEQUENCE GRIDS</span>
          </div>
          <h1 className="text-[40px] sm:text-[56px] lg:text-[64px] font-[800] tracking-[-0.04em] leading-[0.85] text-white" style={{ fontFamily: "Archivo Narrow, sans-serif" }}>
            SEQUENCE GRIDS
          </h1>
          <p className="text-[13px] text-[#7a8089] mt-3 max-w-md">One sequence grid per story beat, sliced into four 16:9 shots. Generate the grid outside the app, then drop it back on the row.</p>
        </div>
        <div className="hidden sm:block text-right text-[10px] font-mono text-[#5a616c] leading-relaxed pt-2">
          {totalCount} scenes<br />
          {renderedCount} rendered<br />
          {characterDescriptions.length} characters
          {(() => {
            const ready = characterDescriptions.filter((c) => c.sheetUrl).length;
            return ready > 0 ? ` • ${ready} sheet-locked` : "";
          })()}
          <br />
          <span style={{ color: accentHex }}>{visualStyle}</span>
        </div>
      </div>

      {preview && (
        <ImageLightbox src={preview.src} alt={preview.alt} caption={preview.caption} onClose={() => setPreview(null)} />
      )}

      {error && (
        <ErrorBanner
          title="Generation failed"
          detail={error}
          accentHex={accentHex}
          onRetry={onGenerateAssets}
          onDismiss={onDismissError}
        />
      )}

      {/* Action bar */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={onGenerateAssets}
          disabled={isAIProcessing || !hasContent}
          className="h-9 px-5 rounded-[6px] text-[12px] font-medium text-white flex items-center gap-2 transition-all disabled:opacity-40"
          style={{ backgroundColor: accentHex }}
        >
          {isAIProcessing && (generationStatus.includes("Creating") || generationStatus.includes("Rendering")) ? (
            <><Loader2 size={14} className="animate-spin" /> {generationStatus}</>
          ) : (
            <><Layers size={14} /> Build Sequence Grids</>
          )}
        </button>
        {generatedScenes.length > 0 && (
          <button
            onClick={onGenerateAssets}
            disabled={isAIProcessing}
            className="h-8 px-3 rounded-[5px] text-[11px] font-medium text-[#c9ccd1] border border-white/10 hover:border-white/20 hover:text-white flex items-center gap-1.5 transition-all disabled:opacity-40 bg-white/5"
          >
            <RotateCcw size={12} /> Regenerate All
          </button>
        )}
        {isAIProcessing && !generationStatus && (
          <div className="flex items-center gap-2 text-[11px] text-[#7a8089]">
            <Loader2 size={12} className="animate-spin" style={{ color: accentHex }} />
            {generationStatus}
          </div>
        )}
        <div className="flex-1" />
        {totalCount > 0 && (
          <span className="text-[10px] font-mono text-[#5a616c]">
            {renderedCount} / {totalCount} rendered
          </span>
        )}
      </div>

      {/* Empty state */}
      {generatedScenes.length === 0 ? (
        <div className="rounded-[10px] border border-dashed border-white/10 p-12 text-center bg-[#0b0b0e]">
          {isAIProcessing ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={32} className="animate-spin" style={{ color: accentHex }} />
              <p className="text-[12px] text-[#9aa0a8]">{generationStatus || "Generating..."}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="p-4 rounded-full bg-white/5 border border-white/10">
                <Film size={28} className="text-[#5a616c]" />
              </div>
              <p className="text-[13px] text-[#9aa0a8] font-medium">No assets generated yet</p>
              <p className="text-[11px] text-[#5a616c] max-w-sm">One 2x2 sequence grid per story beat, sliced into four 1280x720 shots</p>
            </div>
          )}
        </div>
      ) : (
        /* Scene groups */
        <div className="space-y-6">
          {Object.keys(groupedScenes).map((beatTitle, idx) => (
            <div key={beatTitle} className="rounded-[10px] bg-[#0b0b0e] border border-white/[0.06] p-4">
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/5">
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentHex }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[#9aa0a8]">
                  {String(idx + 1).padStart(2, "0")} • {beatTitle}
                </span>
                <span className="text-[9px] font-mono text-[#5a616c] ml-auto">
                  {groupedScenes[beatTitle].filter((s) => s.imageUrl).length} / {groupedScenes[beatTitle].length}
                </span>
                <button
                  onClick={() => onRegenerateBeat(groupedScenes[beatTitle][0].beatId)}
                  disabled={isAIProcessing}
                  title="Regenerate this beat's sequence grid"
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-white/10 text-[#5a616c] hover:text-white hover:border-white/25 transition-all disabled:opacity-40 flex items-center gap-1"
                >
                  <RotateCcw size={8} /> SHEET
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {groupedScenes[beatTitle].map((scene) => (
                  <SceneCard
                    key={scene.id}
                    scene={scene}
                    onRenderImage={onRenderImage}
                    accentHex={accentHex}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onPrev}
          className="h-9 px-4 rounded-[6px] text-[12px] font-medium text-[#c9ccd1] border border-white/10 hover:border-white/20 hover:text-white transition-all"
        >
          ← Back to Story
        </button>
        <button
          onClick={onNext}
          disabled={generatedScenes.length === 0}
          className="h-9 px-5 rounded-[6px] text-[12px] font-medium text-white transition-all disabled:opacity-40 flex items-center gap-2"
          style={{ backgroundColor: accentHex }}
        >
          Continue to Timeline →
        </button>
      </div>
    </div>
  );
}
