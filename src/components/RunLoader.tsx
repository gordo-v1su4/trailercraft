import { useState } from "react";
import { FolderOpen, Loader2, AlertTriangle } from "lucide-react";
import { loadRun, type RunManifest } from "../utils/api";
import { ImageLightbox } from "./ImageLightbox";

const DEFAULT_KEY =
  "media-uploads/2026/09_26/2026-09-26T16-55-00Z/1790461902687-run-manifest.json";

interface RunLoaderProps {
  onLoaded?: (manifest: RunManifest) => void;
}

export function RunLoader({ onLoaded }: RunLoaderProps) {
  const [key, setKey] = useState(DEFAULT_KEY);
  const [manifest, setManifest] = useState<RunManifest | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    setStatus("Loading run from RustFS…");
    try {
      const result = await loadRun(key.trim());
      setManifest(result);
      setStatus(
        `Loaded ${result.title ?? result.runId} — ${result.characters.length} characters, ` +
          `${result.locations.length} location${result.locations.length === 1 ? "" : "s"}, ` +
          `${result.shotSheets?.length ?? 0} shot sheets`,
      );
      onLoaded?.(result);
    } catch (e) {
      setManifest(null);
      setError(e instanceof Error ? e.message : "Could not load run");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <header className="mb-3 flex items-center gap-2">
        <FolderOpen size={16} className="text-white/60" />
        <h2 className="text-sm font-semibold text-white/90">Published run</h2>
      </header>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          spellCheck={false}
          placeholder="RustFS object key of a run manifest"
          className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white/80 outline-none focus:border-white/30"
        />
        <button
          onClick={load}
          disabled={busy || !key.trim()}
          className="inline-flex shrink-0 items-center gap-2 rounded bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Load run
        </button>
      </div>

      {error ? (
        <p className="mt-3 flex items-start gap-2 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
      {status ? <p className="mt-3 text-xs text-white/60">{status}</p> : null}

      {manifest ? (
        <div className="mt-4 space-y-4">
          {manifest.characters.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-white/50">
                Establishing sheets — characters
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {manifest.characters.map((c) => (
                  <figure key={c.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setZoom({ src: c.sheetUrl, alt: c.name })}
                      className="block w-full overflow-hidden rounded border border-white/10"
                    >
                      <img
                        src={c.sheetUrl}
                        alt={c.name}
                        loading="lazy"
                        className="aspect-video w-full object-cover"
                      />
                    </button>
                    <figcaption className="truncate text-xs text-white/75">
                      {c.name}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          {manifest.locations.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-white/50">
                Establishing sheets — locations
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {manifest.locations.map((l) => (
                  <figure key={l.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => setZoom({ src: l.sheetUrl, alt: l.name })}
                      className="block w-full overflow-hidden rounded border border-white/10"
                    >
                      <img
                        src={l.sheetUrl}
                        alt={l.name}
                        loading="lazy"
                        className="aspect-video w-full object-cover"
                      />
                    </button>
                    <figcaption className="truncate text-xs text-white/75">
                      {l.name}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}

          {manifest.shotSheets && manifest.shotSheets.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs uppercase tracking-wide text-white/50">
                Shot sheets (generated in shot context)
              </h3>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {manifest.shotSheets.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setZoom({ src: s.url, alt: s.id })}
                    className="overflow-hidden rounded border border-white/10"
                  >
                    <img
                      src={s.url}
                      alt={s.id}
                      loading="lazy"
                      className="aspect-video w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {zoom ? (
        <ImageLightbox
          src={zoom.src}
          alt={zoom.alt}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </section>
  );
}
