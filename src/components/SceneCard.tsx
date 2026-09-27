import { Film, Maximize, Eye, Aperture, Plus, Trash2, Loader2, Sparkles, RefreshCw } from "lucide-react";
import type { Scene } from "../types";

interface SceneCardProps {
  scene: Scene & { instanceId?: number };
  onAdd?: (scene: Scene) => void;
  onRemove?: (instanceId: number) => void;
  inTimeline?: boolean;
  onRenderImage?: (id: string, prompt: string) => void;
  isActive?: boolean;
  accentHex: string;
}

export function SceneCard({ scene, onAdd, onRemove, inTimeline, onRenderImage, isActive, accentHex }: SceneCardProps) {
  const Icon = scene.icon || Film;

  const VariantIcon = () => {
    switch (scene.variantType) {
      case "Wide": case "Establishing": return <Maximize size={10} />;
      case "Close Up": case "Character Focus": return <Eye size={10} />;
      case "Detail": case "Macro Detail": return <Aperture size={10} />;
      default: return <Film size={10} />;
    }
  };

  return (
    <div
      className={`relative group overflow-hidden rounded-[6px] border transition-all duration-200 aspect-video flex flex-col shrink-0 w-full max-w-full ${
        isActive
          ? "border-white/40 ring-1 ring-white/20 z-10"
          : "border-white/[0.08] hover:border-white/20 bg-[#0f0f12]"
      }`}
    >
      <div className="flex-1 w-full bg-[#0c0c0f] flex items-center justify-center relative overflow-hidden">
        {scene.imageUrl ? (
          <img src={scene.imageUrl} alt={scene.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <div className="p-2 rounded-full bg-white/5 border border-white/10">
              <Icon size={14} className="text-[#5a616c]" />
            </div>
            {!inTimeline && onRenderImage && (
              <button
                onClick={(e) => { e.stopPropagation(); onRenderImage(scene.id, scene.prompt); }}
                className="px-2 py-1 bg-white/5 hover:bg-white/10 text-[9px] font-medium rounded-[4px] text-[#c9ccd1] border border-white/10 flex items-center gap-1 transition-all"
                style={{ color: accentHex }}
              >
                {scene.isRendering ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
                {scene.isRendering ? "Rendering..." : "Render"}
              </button>
            )}
          </div>
        )}

        {!inTimeline && scene.variantType && (
          <div className="absolute top-1.5 left-1.5 bg-black/80 backdrop-blur px-1.5 py-0.5 rounded text-[8px] font-mono text-[#9aa0a8] border border-white/10 flex items-center gap-1">
            <VariantIcon /> {scene.variantType}
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/90 to-transparent pointer-events-none">
          <span className="text-[9px] font-medium text-[#c9ccd1] truncate block">{scene.title}</span>
        </div>

        <div className={`absolute inset-0 bg-[#08080a]/95 p-2 opacity-0 group-hover:opacity-100 transition-all duration-200 flex flex-col items-center justify-center text-center ${inTimeline ? "" : "cursor-help"}`}>
          {!inTimeline && <p className="text-[8px] text-[#7a8089] italic line-clamp-3 mb-2 leading-relaxed">"{scene.prompt}"</p>}
          <div className="flex gap-1.5 flex-wrap justify-center">
            {!inTimeline && onAdd && (
              <button
                onClick={() => onAdd(scene)}
                className="text-[9px] font-medium py-1 px-2 rounded-[4px] flex items-center gap-1 transition-all text-white"
                style={{ backgroundColor: accentHex }}
              >
                <Plus size={9} /> Add
              </button>
            )}
            {onRenderImage && (
              <button
                onClick={(e) => { e.stopPropagation(); onRenderImage(scene.id, scene.prompt); }}
                className="bg-white/5 hover:bg-white/10 text-[#9aa0a8] text-[9px] font-medium py-1 px-2 rounded-[4px] flex items-center gap-1 border border-white/10 transition-all"
                title="Regenerate Image"
              >
                <RefreshCw size={9} className={scene.isRendering ? "animate-spin" : ""} />
              </button>
            )}
          </div>
        </div>
      </div>

      {inTimeline && (
        <div className={`p-1.5 bg-[#0c0c0f] flex justify-between items-center h-6 border-t ${isActive ? "border-white/20" : "border-white/[0.06]"}`}>
          <span className={`text-[9px] font-mono ${isActive ? "text-white font-medium" : "text-[#5a616c]"}`}>{scene.duration}s</span>
          {onRemove && scene.instanceId !== undefined && (
            <button
              onClick={() => onRemove(scene.instanceId!)}
              className="p-0.5 rounded hover:bg-[#ef4343]/10 text-[#5a616c] hover:text-[#ef4343] transition-colors"
            >
              <Trash2 size={9} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
