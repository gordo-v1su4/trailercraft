import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import type { Plugin, ViteDevServer } from "vite";

// The API surface lives in api/ as real Vercel Functions. We import the same
// handlers here so `vite dev` and production run identical code — previously the
// dev server had its own copy of every provider call, which is how the two drifted
// apart and left the deployed app with no backend at all.
import llmHandler from "./api/llm";
import imageHandler from "./api/image";
import qcHandler from "./api/qc";
import assetHandler from "./api/asset";
import sheetHandler from "./api/sheet";
import characterSheetHandler from "./api/character-sheet";
import runHandler from "./api/run";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Handler = (req: any, res: any) => Promise<void> | void;

const ROUTES: Array<[string, Handler]> = [
  ["/api/llm", llmHandler as Handler],
  ["/api/image", imageHandler as Handler],
  ["/api/qc", qcHandler as Handler],
  ["/api/asset", assetHandler as Handler],
  ["/api/sheet", sheetHandler as Handler],
  ["/api/character-sheet", characterSheetHandler as Handler],
  ["/api/run", runHandler as Handler],
];

/**
 * Vercel's Node handlers expect `req.body` to be pre-parsed. Connect gives us a
 * raw stream, so buffer it and hand over a compatible shape.
 */
/**
 * Vercel's Node handlers use the `res.status().json()` helper, which raw Node
 * response objects do not have. Provide a compatible shim so the exact same
 * handler code runs under `vite dev`.
 */
function decorateResponse(res: any) {
  if (typeof res.status === "function") return res;

  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    if (!res.headersSent) res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
    return res;
  };
  res.send = (payload: unknown) => {
    res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    return res;
  };
  return res;
}

function apiDevPlugin(env: Record<string, string>): Plugin {
  return {
    name: "trailercraft-api",
    configureServer(server: ViteDevServer) {
      // Vercel functions read secrets from process.env at call time.
      for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        const match = ROUTES.find(([prefix]) => url.startsWith(prefix));
        if (!match) {
          next();
          return;
        }

        const [prefix, handler] = match;
        const isReadOnly = prefix === "/api/asset" || prefix === "/api/run";

        if (isReadOnly) {
          const proxied = Object.create(req) as typeof req & {
            query: Record<string, string>;
          };
          proxied.query = Object.fromEntries(
            new URL(url, "http://localhost").searchParams,
          );
          const result = handler(proxied, decorateResponse(res));
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              if (res.headersSent) return;
              res.statusCode = 500;
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "Internal error",
                }),
              );
            });
          }
          return;
        }

        const chunks: Buffer[] = [];

        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("error", () => {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: "Request stream error" }));
        });
        req.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const proxied = Object.create(req) as typeof req & {
            body: string;
            query: Record<string, string>;
          };
          proxied.body = raw;
          proxied.query = Object.fromEntries(new URL(url, "http://localhost").searchParams);

          const result = handler(proxied, decorateResponse(res));
          if (result instanceof Promise) {
            result.catch((error: unknown) => {
              if (res.headersSent) return;
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : "Internal error",
                }),
              );
            });
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss(), apiDevPlugin(env), viteSingleFile()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  };
});
