# TRAILERCRAFT

Turn story beats into a series trailer. Four steps: **Story → Episodes → Generation → Timeline**.

Write or auto-generate a Save the Cat structure, break it into episodes, render
cinematic shot variants per beat, then cut the shots to music on a timeline and
export an MP4.

---

## Architecture

The critical property: **`api/` is the only place provider logic lives.** The Vite
dev server imports those exact handlers, so `bun run dev` and production run the
same code. Previously the dev server carried its own private copy of every provider
call, which is how the deployed app ended up with no backend at all while still
looking fine locally.

```
src/            React client — calls /api/* only, never a provider directly
api/
  llm.ts        POST  text + structured JSON   (Kimi → Hyper → OpenRouter)
  sheet.ts      POST  2x2 contact sheet → 4 sliced shots
  image.ts      POST  single image (per-tile refresh)
  qc.ts         POST  shot continuity grading  (Gemini vision via OpenRouter)
  asset.ts      GET   same-origin image bytes (see CORS note below)
  _lib/
    llm.ts      provider chain, failover, defensive JSON parsing
    sheet.ts    contact-sheet prompt + grid slicing with sharp
    image.ts    single-image call, dispatches on model id
    qc.ts       vision QC prompt + response shape
    storage.ts  RustFS SigV4 upload, returns public URLs
    http.ts     shared body parsing + error shaping
vite.config.ts  dev middleware that mounts the handlers above
vercel.json      function timeouts and memory
```

### Provider chain

Text and JSON generation is attempted in a fixed order, first success wins:

| Order | Provider | Endpoint | Protocol |
|-------|----------|----------|----------|
| 1 | Kimi | `api.kimi.com/coding/v1/messages` | Anthropic |
| 2 | Hyper | `hyper.charm.land/v1/chat/completions` | OpenAI |
| 3 | OpenRouter | `openrouter.ai/api/v1/chat/completions` | OpenAI |

Images and shot QC always use OpenRouter, because Gemini is only reachable there.

Every attempt is recorded and returned to the client, so when something fails the UI
tells you *which* provider failed and why rather than showing a generic failure.

### Two failure modes worth knowing

Both of these return **HTTP 200 while silently doing nothing**, and both have bitten
this codebase before:

1. **Omitting `modalities: ["image","text"]`** on the OpenRouter image call. The
   model returns text only and no images, with a success status. `api/_lib/image.ts`
   treats a missing image as an error for this reason.
2. **API errors swallowed into placeholder data.** The old `fallbackGeneration()`
   caught every failure and filled the grid with mock cards, so a completely dead
   backend looked like a working app. That function is deleted. Errors now render in
   `ErrorBanner` with a retry.

### Contact sheets

The Generation step asks for **one 2x2 contact sheet per story beat** and slices it
into four shots. Nine separate generations would cost nine calls; the sheet costs
one, so a delivered shot is roughly 9x cheaper.

| Model | Endpoint | Sheet size | Raw tile | Upscale to 1280x720 | Cost/sheet |
|---|---|---|---|---|---|
| `openai/gpt-image-2.5-sunburst` | `/images` | 2048x1152 | 1024x576 | 1.25x | ~$0.041 |
| `google/gemini-3.1-flash-image-preview` | `/chat` | 4K 5504x3072 | 2752x1536 | native | ~$0.153 |
| `google/gemini-3-pro-image` | `/chat` | 2K 2752x1536 | 1376x768 | 1.86x | ~$0.138 |

Two constraints the models impose:

- Tiles stay 16:9 only when the grid is **square**, because the sheet is 16:9. So
  2x2 or 3x3, nothing else. 2x2 is the default for the resolution win.
- Sunburst **rejects `/chat/completions`** and `4096x2304`. 2048x1152 is its largest
  preset and the only one that is exactly 16:9. The server picks the endpoint from
  the model id, so both families work through one route.

### Reading images back in the browser

The CDN in front of RustFS will cache a response that was fetched without an
`Origin` header and replay it *without* CORS headers. `<img>` still works, but
`fetch()` fails intermittently — which broke MP4 export in production only. All
byte reads therefore go through the same-origin `/api/asset` route.

### Image handling

Gemini returns each image as a ~2.6 MB base64 data URL, roughly $0.14 apiece. A full
60-shot run is ~160 MB — far past Vercel's 4.5 MB function body limit, and unusable
as React state. So `/api/image` uploads to RustFS and returns a short public URL.
The bucket is public-read; only URLs cross the wire.

Reference images going the other way (into a vision model) are downscaled to 1024px
JPEG in the browser first, to stay under the same 4.5 MB request cap.

---

## Setup

```bash
bun install
cp .env.example .env    # then fill in the values
bun run dev
```

Copy `.env.example` for the full annotated list of variables. Nothing in `.env` is
ever sent to the browser — the client only ever talks to `/api/*`.

### Storage

Generated images land in the `trailercraft` bucket on RustFS, served from
`https://s3.v1su4.dev/trailercraft/`. The bucket needs a public-read policy:

```json
{ "Version": "2012-10-17",
  "Statement": [{ "Sid": "AllowPublicRead", "Effect": "Allow",
    "Principal": "*", "Action": ["s3:GetObject"],
    "Resource": ["arn:aws:s3:::trailercraft/*"] }] }
```

---

## Deployment

`vercel.json` sets a 300s timeout on the image and QC routes; a single Gemini render
takes ~17s and a full auto-render pass runs them sequentially, so the default timeout
is not enough. Add every variable from `.env.example` to the project's environment.

Image generation is billed per call. A full 15-beat run is 15 contact sheets,
about $0.62, delivered as 60 shots.

---

## Scripts

```bash
bun run dev      # dev server with the API mounted
bun run build    # single-file production bundle
bun run preview  # serve the build
```
