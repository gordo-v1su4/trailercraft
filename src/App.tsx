import { useState } from "react";
import { usePersistedState } from "./hooks/usePersistedState";
import {
  Film, Zap, Clapperboard, Layers, Activity,
  CheckCircle, ChevronRight,
} from "lucide-react";
import { SAVE_THE_CAT_BEATS } from "./constants/storyBeats";
import { CINEMATIC_QUALITY_TERMS } from "./constants";
import { createCharacterSheet, callKimi, callImagen, generateSheet, ApiError, type SheetResult } from "./utils/api";
import { StoryStep } from "./components/StoryStep";
import { RunLoader } from "./components/RunLoader";
import { GenerationStep } from "./components/GenerationStep";
import { TimelineStep } from "./components/TimelineStep";
import type {
  StepId, AccentColor, StoryBeatsMap, ImageData,
  CharacterDescription, Scene, TimelineClip, AudioMarker,
} from "./types";

const ACCENTS: AccentColor[] = [
  { name: "Indigo", hex: "#3a7bff", ink: "#c7ddff" },
  { name: "Cyan", hex: "#22b8cf", ink: "#a7f3ff" },
  { name: "Amber", hex: "#f5a524", ink: "#fed7aa" },
  { name: "Mint", hex: "#2ee6a6", ink: "#a7f3d0" },
];

const STEPS: { id: StepId; label: string; icon: typeof Film }[] = [
  { id: "story", label: "Story", icon: Zap },
  { id: "generation", label: "Generation", icon: Layers },
  { id: "timeline", label: "Timeline", icon: Film },
];

const BEAT_GRADIENTS: Record<string, string> = {
  openingImage: "from-[#1e293b] to-[#0a0a0b]",
  themeStated: "from-[#1e293b] to-[#0a0a0b]",
  setup: "from-[#1c1917] to-[#0a0a0b]",
  catalyst: "from-[#1c1917] to-[#0a0a0b]",
  debate: "from-[#1c1917] to-[#0a0a0b]",
  breakIntoTwo: "from-[#1a1020] to-[#0a0a0b]",
  bStory: "from-[#1a1020] to-[#0a0a0b]",
  funAndGames: "from-[#1e1a0c] to-[#0a0a0b]",
  midpoint: "from-[#1e1a0c] to-[#0a0a0b]",
  badGuysCloseIn: "from-[#0c1420] to-[#0a0a0b]",
  allIsLost: "from-[#0c1420] to-[#0a0a0b]",
  darkNight: "from-[#0c1420] to-[#0a0a0b]",
  breakIntoThree: "from-[#1c0c14] to-[#0a0a0b]",
  finale: "from-[#1c0c14] to-[#0a0a0b]",
  finalImage: "from-[#0c1c10] to-[#0a0a0b]",
};

const BEAT_ICONS: Record<string, any> = {
  openingImage: Film, themeStated: Zap, setup: Activity, catalyst: Zap,
  debate: Layers, breakIntoTwo: ChevronRight, bStory: Film,
  funAndGames: Activity, midpoint: Zap, badGuysCloseIn: ChevronRight,
  allIsLost: Film, darkNight: Activity, breakIntoThree: Zap,
  finale: Clapperboard, finalImage: CheckCircle,
};

interface ShotPlan {
  beatId: string;
  beatTitle: string;
  /** Exactly four, ordered for a 2x2 sheet: TL, TR, BL, BR. */
  shots: string[];
}

interface ShotPlanResponse {
  plan: ShotPlan[];
}

function mergeScenes(existing: Scene[], incoming: Scene[]): Scene[] {
  const touched = new Set(incoming.map((sc) => sc.beatId));
  return [...existing.filter((sc) => !touched.has(sc.beatId)), ...incoming];
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<StepId>("story");
  const [accent, setAccent] = useState<AccentColor>(ACCENTS[0]);

  // Story state
  const [storyBeats, setStoryBeats] = usePersistedState<StoryBeatsMap>(
    "trailercraft.storyBeats",
    () => {
      const beats: StoryBeatsMap = {};
      SAVE_THE_CAT_BEATS.forEach((b) => { beats[b.id] = ""; });
      return beats;
    },
  );
  const [visualStyle, setVisualStyle] = usePersistedState("trailercraft.visualStyle", "Cinematic, High Contrast");
  const [inspirationImages, setInspirationImages] = useState<string[]>([]);
  const [referenceImageData, setReferenceImageData] = useState<ImageData[]>([]);
  const [characterDescriptions, setCharacterDescriptions] = usePersistedState<CharacterDescription[]>("trailercraft.characters", []);
  const [projectTitle, setProjectTitle] = usePersistedState("trailercraft.projectTitle", "Untitled Project");
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [showTitleOptions, setShowTitleOptions] = useState(false);


  // Generation state
  const [generatedScenes, setGeneratedScenes] = usePersistedState<Scene[]>("trailercraft.scenes", []);

  // Timeline state
  const [timeline, setTimeline] = usePersistedState<TimelineClip[]>("trailercraft.timeline", []);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioMarkers, setAudioMarkers] = useState<AudioMarker[]>([]);
  const [markerDensity, setMarkerDensity] = useState("all");
  const [markerSensitivity, setMarkerSensitivity] = useState(0.7);
  const [isDecoding, setIsDecoding] = useState(false);

  // AI state
  const [isAIProcessing, setIsAIProcessing] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState("");

  // --- Sequence grids: one 2x2 sequence grid per beat ---

  /**
   * Beats planned per model call.
   *
   * Asking for all 15 beats in one call means ~60 detailed shot descriptions in a
   * single response, which runs past the request timeout and aborts mid-flight
   * (both providers report "operation was aborted"). Chunking keeps each call
   * small enough to finish comfortably, and it means a per-beat retry only
   * re-plans its own chunk instead of the whole series.
   */
  const PLAN_CHUNK_SIZE = 5;

  const planShots = async (): Promise<ShotPlan[]> => {
    const filled = SAVE_THE_CAT_BEATS.filter((b) => (storyBeats[b.id] || "").length > 0);
    if (filled.length === 0) throw new Error("No story beats have content yet.");

    const canonical = characterDescriptions.filter((c) => c.sheetUrl && c.name.trim());
    // Once a character has a canonical sheet it is the only version of that
    // person. Any detected character without a sheet is excluded outright rather
    // than described, because prose descriptions are how invented wardrobe and
    // features leak into every downstream shot.
    const characterSection =
      canonical.length > 0
        ? `CHARACTERS (refer to these by name only — do not describe their appearance):\n${canonical
            .map((c) => `- ${c.name.trim()}`)
            .join("\n")}\n\nEach named character's canonical reference sheet is the authoritative record of their face, body and wardrobe. Reproduce them exactly as shown there. Never invent, swap, or add clothing, tattoos, jewellery or features. Any other person mentioned in the story beats is background/extras and must stay unnamed, out of focus, or off-screen.\n\n`
        : characterDescriptions.length > 0
          ? `CHARACTERS (no canonical sheet yet — describe only what is visible, and do not invent wardrobe or features):\n${characterDescriptions
              .map((c, i) => `${i + 1}. ${c.name || `Character ${i + 1}`}`)
              .join("\n")}\n\n`
          : "";

    const byId = new Map(filled.map((b) => [b.id, b]));
    const chunks: typeof SAVE_THE_CAT_BEATS[] = [];
    for (let i = 0; i < filled.length; i += PLAN_CHUNK_SIZE) {
      chunks.push(filled.slice(i, i + PLAN_CHUNK_SIZE));
    }

    const planned: ShotPlan[] = [];
    for (const [index, chunk] of chunks.entries()) {
      setGenerationStatus(
        `Planning shots (beats ${index * PLAN_CHUNK_SIZE + 1}-${index * PLAN_CHUNK_SIZE + chunk.length} of ${filled.length})...`,
      );

      const prompt = `You are a film director planning the shot list for a series trailer.

${characterSection}VISUAL STYLE: ${visualStyle}

For EACH story beat below, write exactly 4 distinct shot descriptions that together
cover one beat. Choose framings deliberately and vary them between beats:
use a mix of extreme macro detail, low angle, wide establishing, medium two-shot,
over-the-shoulder, tracking dolly, aerial top-down, Dutch angle close-up.
Every shot must be a single photorealistic cinematic film frame, described in one
sentence, and must follow the story progression of its beat.

When a character appears, refer to them ONLY by their name. Never restate their
appearance, clothing, hair, tattoos or accessories in the shot text — the canonical
character sheet already defines all of that, and repeating it in prose is what causes
the appearance to drift between shots. Describe the framing, action, lens and
lighting instead, and let the name carry the identity.

Story beats:
${chunk.map((b, i) => `${i + 1}. id=${b.id} | ${b.label}: ${storyBeats[b.id]}`).join("\n")}

Return JSON: { "plan": [{ "beatId": "<exact id>", "beatTitle": "<short label>", "shots": ["shot 1","shot 2","shot 3","shot 4"] }] }`;

      const result = await callKimi<ShotPlanResponse>(
        prompt,
        "You are a world-class Film Director and Cinematographer. Return strict JSON only.",
      );

      for (const p of result?.plan ?? []) {
        if (!byId.has(p.beatId) || !Array.isArray(p.shots) || p.shots.length === 0) continue;
        planned.push({
          beatId: p.beatId,
          beatTitle: p.beatTitle || byId.get(p.beatId)?.label || p.beatId,
          shots: p.shots.slice(0, 4),
        });
      }
    }

    if (planned.length === 0) throw new Error("Model returned no shot plan.");
    return planned;
  };

  /**
   * The only sanctioned way character information reaches an image model.
   *
   * Prose descriptions are not passed downstream: they are model-authored and
   * drift (invented wardrobe, tattoos, accessories) once per generation. When a
   * canonical sheet exists the character is referenced by name alone and the
   * sheet is authoritative; characters without a sheet are left out entirely
   * rather than described.
   */
  const characterPromptForImages = (): string => {
    const canonical = characterDescriptions.filter((c) => c.sheetUrl && c.name.trim());
    if (canonical.length > 0) {
      return (
        `CHARACTERS (name only, do not describe their appearance): ` +
        canonical.map((c) => c.name.trim()).join(", ") +
        ". Reproduce each exactly per their canonical reference sheet. " +
        "Any other person stays unnamed, out of focus, or off-screen. "
      );
    }
    if (characterDescriptions.length > 0) {
      return (
        "CHARACTERS (no canonical sheet yet, do not invent wardrobe or features): " +
        characterDescriptions.map((c, i) => c.name || `Character ${i + 1}`).join(", ") +
        ". "
      );
    }
    return "";
  };

  const handleCreateCharacterSheet = async (character: CharacterDescription, index: number) => {
    const sourceIndex = character.sourceImageIndex ?? 0;
    const source = referenceImageData[sourceIndex];
    if (!source) {
      setGenerationError(`No reference image behind ${character.name || "this character"}.`);
      return;
    }

    const name = character.name.trim() || `Character ${index + 1}`;
    const mark = (patch: Partial<CharacterDescription>) => {
      setCharacterDescriptions((prev) =>
        prev.map((c, i) => (i === index ? { ...c, ...patch } : c)),
      );
    };

    mark({ sheetStatus: "generating", sheetError: undefined, name });
    try {
      const result = await createCharacterSheet(
        `data:${source.mimeType};base64,${source.base64}`,
        name,
        character.distinctiveFeatures || undefined,
        { slug: name },
      );
      mark({ sheetStatus: "ready", sheetUrl: result.url, sheetError: undefined });
    } catch (error) {
      mark({
        sheetStatus: "failed",
        sheetError: error instanceof Error ? error.message : "Sheet generation failed",
      });
    }
  };

  const scenesFromSheet = (plan: ShotPlan, sheet: SheetResult): Scene[] =>    sheet.tiles.map((tile) => ({
      id: `sheet_${plan.beatId}_${tile.index}`,
      beatId: plan.beatId,
      beatTitle: plan.beatTitle,
      title: `${plan.beatTitle} · ${tile.row + 1}${tile.column + 1}`,
      variantType: `Sheet ${tile.index + 1}`,
      prompt: plan.shots[tile.index] ?? plan.shots[0] ?? plan.beatTitle,
      color: BEAT_GRADIENTS[plan.beatId] || "from-[#1e293b] to-[#0a0a0b]",
      icon: BEAT_ICONS[plan.beatId] || Film,
      duration: 2 + (tile.index % 3) * 0.7,
      imageUrl: tile.url,
      isRendering: false,
    }));

  const generateStyledAssets = async (onlyBeatId?: string) => {
    const hasContent = Object.values(storyBeats).some((v) => v.length > 0);
    if (!hasContent) return;

    setIsAIProcessing(true);
    setGenerationError(null);
    if (!onlyBeatId) setCurrentStep("generation");

    try {
      setGenerationStatus("Planning shots...");
      const allPlans = await planShots();
      const targets = onlyBeatId
        ? allPlans.filter((p) => p.beatId === onlyBeatId)
        : allPlans;

      if (targets.length === 0) {
        throw new Error(
          onlyBeatId ? "That beat has no shot plan to render." : "No beats to render.",
        );
      }

      const collected: Scene[] = [];
      for (const [index, plan] of targets.entries()) {
        setGenerationStatus(
          `Sequence grid ${index + 1}/${targets.length} — ${plan.beatTitle}`,
        );
        // Show the planned frames immediately so the beat is not empty while we wait.
        const placeholder: Scene[] = plan.shots.map((shot, i) => ({
          id: `sheet_${plan.beatId}_${i}`,
          beatId: plan.beatId,
          beatTitle: plan.beatTitle,
          title: `${plan.beatTitle} · ${Math.floor(i / 2) + 1}${(i % 2) + 1}`,
          variantType: `Sheet ${i + 1}`,
          prompt: shot,
          color: BEAT_GRADIENTS[plan.beatId] || "from-[#1e293b] to-[#0a0a0b]",
          icon: BEAT_ICONS[plan.beatId] || Film,
          duration: 2 + (i % 3) * 0.7,
          imageUrl: null,
          isRendering: true,
        }));
        setGeneratedScenes((prev) => mergeScenes(prev, placeholder));

        const tileNames = plan.shots.map((shot) => {
          const haystack = shot.toLowerCase();
          return characterDescriptions
            .filter((c) => c.sheetUrl && c.name.trim())
            .map((c) => c.name.trim())
            .filter((name) => haystack.includes(name.toLowerCase()));
        });

        const sheet = await generateSheet(plan.shots, {
          sharedDirection: [visualStyle, characterPromptForImages()]
            .filter(Boolean)
            .join(". "),
          tileNames,
          gridSize: "2x2",
          prefix: `beats/${plan.beatId}`,
        });

        const rendered = scenesFromSheet(plan, sheet);
        collected.push(...rendered);
        setGeneratedScenes((prev) => mergeScenes(prev, rendered));
      }

      setGenerationStatus(
        `${collected.length} shots across ${targets.length} beat sheet(s)`,
      );
    } catch (e) {
      // Drop any placeholders for beats that failed rather than leaving them spinning.
      setGeneratedScenes((prev) =>
        prev.map((sc) => (sc.isRendering && !sc.imageUrl ? { ...sc, isRendering: false } : sc)),
      );
      setGenerationError(
        e instanceof ApiError ? e.describe() : e instanceof Error ? e.message : String(e),
      );
    } finally {
      setIsAIProcessing(false);
    }
  };

  const handleRenderImage = async (sceneId: string, prompt: string) => {
    setGeneratedScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, isRendering: true } : s))
    );

    try {
      const characterPrompt = characterPromptForImages();

      const referencePrompt = referenceImageData.length > 0
        ? "Create the next shot in the sequence and world, hyper realistic cinematic and detailed film shot, the people are photorealistic, improve the image as if it is a live action film shot on an anamorphic lens with a film camera. Image should be either a macro or dynamic action shot that follows the same style, action, and color palette. Make each shot unique. "
        : "";

      const fullPrompt = `${referencePrompt}${characterPrompt}${prompt}, ${visualStyle}, ${CINEMATIC_QUALITY_TERMS}, consistent character appearance, unique shot composition`;
      const { url: imageUrl } = await callImagen(fullPrompt);

      setGeneratedScenes((prev) =>
        prev.map((s) => (s.id === sceneId ? { ...s, imageUrl, isRendering: false } : s))
      );
      setTimeline((prev) =>
        prev.map((s) => (s.id === sceneId ? { ...s, imageUrl } : s))
      );
    } catch (e) {
      setGeneratedScenes((prev) =>
        prev.map((s) => (s.id === sceneId ? { ...s, isRendering: false } : s))
      );
      setGenerationError(
        e instanceof ApiError ? e.describe() : e instanceof Error ? e.message : String(e),
      );
    }
  };

  const currentStepIdx = STEPS.findIndex((s) => s.id === currentStep);

  return (
    <div className="h-[100dvh] bg-[#08080a] text-[#c9ccd1] flex flex-col overflow-hidden" style={{ fontFamily: "Geist, Inter, system-ui, sans-serif", fontSize: 13, lineHeight: 1.45 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&family=Archivo+Narrow:wght@700;800&display=swap');
        * { scrollbar-width: thin; scrollbar-color: #1f1f25 #08080a; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #1f1f25; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #2a2a33; }
        .custom-scrollbar-thin::-webkit-scrollbar { width: 4px; height: 4px; }
        .custom-scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar-thin::-webkit-scrollbar-thumb { background: #1f1f25; border-radius: 2px; }
        html { scroll-behavior: smooth; }
        button:focus { outline: none !important; }
        button:focus-visible { outline: none !important; }
        button:active { transform: scale(0.98); }
        input[type="range"].slider-circle {
          -webkit-appearance: none;
          appearance: none;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: #1f1f25;
          border: 1px solid rgba(255,255,255,0.1);
          cursor: pointer;
          outline: none;
        }
        input[type="range"].slider-circle::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--accent, #3a7bff);
          border: 1px solid rgba(255,255,255,0.2);
          margin-top: 7px;
        }
        input[type="range"].slider-circle::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--accent, #3a7bff);
          border: 1px solid rgba(255,255,255,0.2);
          border: none;
        }
        input[type="range"].slider-circle::-webkit-slider-runnable-track {
          background: transparent;
          height: 26px;
          border-radius: 50%;
        }
        input[type="range"].slider-circle::-moz-range-track {
          background: transparent;
          height: 26px;
          border-radius: 50%;
        }
      `}</style>

      {/* Topbar — 48px, Pindeck spec */}
      <div className="sticky top-0 z-40 h-12 border-b border-white/[0.06] bg-[#0c0c0f]/90 backdrop-blur-xl shrink-0">
        <div className="h-full max-w-[1400px] mx-auto px-4 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 shrink-0 mr-2">
            <div className="h-7 w-7 rounded-[8px] flex items-center justify-center text-white" style={{ backgroundColor: accent.hex }}>
              <Film size={14} />
            </div>
            <div className="leading-[1.15] hidden sm:block pr-1">
              <div className="text-[11px] font-semibold text-white tracking-tight" style={{ fontFamily: "Archivo Narrow, sans-serif" }}>
                TRAILERCRAFT
              </div>
              <div className="text-[9px] font-mono text-[#6c727c] tracking-wide mt-0.5">TRAILER • STORY → GEN → TIMELINE</div>
            </div>
          </div>

          {/* Divider */}
          <div className="h-5 w-px bg-white/10 hidden sm:block" />

          {/* Step Stepper */}
          <div className="flex items-center gap-1">
            {STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = currentStep === step.id;
              const isComplete = currentStepIdx > i;
              return (
                <div key={step.id} className="flex items-center">
                  <button
                    onClick={() => setCurrentStep(step.id)}
                    className={`flex items-center gap-1.5 px-2.5 h-7 rounded-[5px] text-[11px] font-medium transition-colors ${
                      isActive
                        ? "text-white border border-white/20"
                        : isComplete
                        ? "text-[#9aa0a8] border border-transparent hover:border-white/10"
                        : "text-[#5a616c] border border-transparent hover:text-[#7a8089]"
                    }`}
                    style={isActive ? { backgroundColor: `${accent.hex}18` } : undefined}
                  >
                    <StepIcon size={12} style={isActive ? { color: accent.hex } : undefined} />
                    <span className="hidden md:inline">{step.label}</span>
                    <span className={`w-2.5 h-2.5 shrink-0 ${isComplete ? "opacity-100" : "opacity-0"}`}>
                      <CheckCircle size={10} className="text-[#2ee6a6]" />
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <ChevronRight size={12} className="text-[#2a2a33] mx-0.5" />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex-1" />

          {/* Accent picker */}
          <div className="hidden md:flex items-center gap-1">
            <span className="text-[10px] font-mono text-[#6c727c] mr-1.5">ACCENT</span>
            {ACCENTS.map((a) => (
              <button
                key={a.hex}
                onClick={() => setAccent(a)}
                className="w-5 h-5 rounded-[4px] border transition-all relative"
                style={{
                  backgroundColor: a.hex,
                  borderColor: accent.hex === a.hex ? "white" : "#2a2a33",
                  boxShadow: accent.hex === a.hex ? `0 0 0 1px #0c0c0f, 0 0 0 3px ${a.hex}50` : "none",
                }}
                title={a.name}
              />
            ))}
          </div>

          {/* Project title */}
          <div className="hidden lg:flex items-center gap-2 text-[10px] font-mono px-2.5 py-1 rounded bg-[#111116] border border-white/10 text-[#8a8f98] max-w-[200px]">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: accent.hex }} />
            <span className="truncate">{projectTitle}</span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-[#08080a]">
        <div className="mx-auto max-w-6xl px-6 pt-5">
          <RunLoader
            onLoaded={(manifest) => {
              setProjectTitle(manifest.title ?? projectTitle);
              if (manifest.style) setVisualStyle(manifest.style);
              setCharacterDescriptions(
                manifest.characters.map((c) => ({
                  name: c.name,
                  description: "",
                  role: "",
                  distinctiveFeatures: "",
                  sheetUrl: c.sheetUrl,
                  sheetStatus: "ready" as const,
                  sourceImageIndex: c.sourceImageIndex ?? 0,
                })),
              );
            }}
          />
        </div>
        {currentStep === "story" && (
          <StoryStep
            storyBeats={storyBeats}
            setStoryBeats={setStoryBeats}
            visualStyle={visualStyle}
            setVisualStyle={setVisualStyle}
            inspirationImages={inspirationImages}
            setInspirationImages={setInspirationImages}
            referenceImageData={referenceImageData}
            setReferenceImageData={setReferenceImageData}
            characterDescriptions={characterDescriptions}
            setCharacterDescriptions={setCharacterDescriptions}
            onCreateSheet={handleCreateCharacterSheet}
            isAIProcessing={isAIProcessing}
            setIsAIProcessing={setIsAIProcessing}
            generationStatus={generationStatus}
            setGenerationStatus={setGenerationStatus}
            projectTitle={projectTitle}
            setProjectTitle={setProjectTitle}
            suggestedTitles={suggestedTitles}
            setSuggestedTitles={setSuggestedTitles}
            showTitleOptions={showTitleOptions}
            setShowTitleOptions={setShowTitleOptions}
            accentHex={accent.hex}
            onNext={() => setCurrentStep("generation")}
          />
        )}


        {currentStep === "generation" && (
          <GenerationStep
            error={generationError}
            onDismissError={() => setGenerationError(null)}
            storyBeats={storyBeats}
            generatedScenes={generatedScenes}
            setGeneratedScenes={setGeneratedScenes}
            visualStyle={visualStyle}
            characterDescriptions={characterDescriptions}
            referenceImageData={referenceImageData}
            isAIProcessing={isAIProcessing}
            setIsAIProcessing={setIsAIProcessing}
            generationStatus={generationStatus}
            setGenerationStatus={setGenerationStatus}
            accentHex={accent.hex}
            onRenderImage={handleRenderImage}
            onGenerateAssets={() => generateStyledAssets()}
            onRegenerateBeat={(beatId) => generateStyledAssets(beatId)}
            onPrev={() => setCurrentStep("generation")}
            onNext={() => setCurrentStep("timeline")}
          />
        )}

        {currentStep === "timeline" && (
          <TimelineStep
            error={generationError}
            onDismissError={() => setGenerationError(null)}
            timeline={timeline}
            setTimeline={setTimeline}
            generatedScenes={generatedScenes}
            setGeneratedScenes={setGeneratedScenes}
            currentTime={currentTime}
            setCurrentTime={setCurrentTime}
            duration={duration}
            setDuration={setDuration}
            isPlaying={isPlaying}
            setIsPlaying={setIsPlaying}
            audioFile={audioFile}
            setAudioFile={setAudioFile}
            audioBuffer={audioBuffer}
            setAudioBuffer={setAudioBuffer}
            isDecoding={isDecoding}
            setIsDecoding={setIsDecoding}
            audioMarkers={audioMarkers}
            setAudioMarkers={setAudioMarkers}
            markerDensity={markerDensity}
            setMarkerDensity={setMarkerDensity}
            markerSensitivity={markerSensitivity}
            setMarkerSensitivity={setMarkerSensitivity}
            accentHex={accent.hex}
            onRenderImage={handleRenderImage}
            onGenerateAssets={() => generateStyledAssets()}
            isAIProcessing={isAIProcessing}
            generationStatus={generationStatus}
            onPrev={() => setCurrentStep("generation")}
          />
        )}
      </div>
    </div>
  );
}
