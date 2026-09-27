import { AlertTriangle, X, RotateCcw } from "lucide-react";

interface ErrorBannerProps {
  title: string;
  detail?: string | null;
  onRetry?: () => void;
  onDismiss?: () => void;
  accentHex: string;
}

export function ErrorBanner({ title, detail, onRetry, onDismiss, accentHex }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-[8px] border px-3 py-2.5 flex items-start gap-2.5"
      style={{ backgroundColor: "rgba(239,67,67,0.07)", borderColor: "rgba(239,67,67,0.28)" }}
    >
      <AlertTriangle size={13} className="shrink-0 mt-0.5 text-[#ef4343]" />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-[#ffb4b4]">{title}</div>
        {detail && (
          <div className="text-[10px] text-[#c98d8d] mt-1 font-mono break-words leading-relaxed">
            {detail}
          </div>
        )}
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 h-6 px-2.5 rounded-[4px] text-[10px] font-medium flex items-center gap-1.5 transition-all border border-white/15 hover:border-white/30"
            style={{ color: accentHex, backgroundColor: `${accentHex}12` }}
          >
            <RotateCcw size={10} /> Retry
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-[#8a5a5a] hover:text-[#ffb4b4] transition-colors p-0.5"
          aria-label="Dismiss error"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
