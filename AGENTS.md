# AGENTS.md

Guidance for AI agents working in this repository. Read this before touching code.

---

## 1. The intake rule (most important section)

**If you do not have enough information to act, do not act. Ask first.**

This governs two different things, and they must not be confused.

### 1a. Intake *inside the app* — guided multiple choice, no agent

The app is **not** an agent and needs no engine. It is a **programmatic harness
around LLM calls**. The user answers a short guided questionnaire, the answers
steer generation, and there is no free-form brief and no back-and-forth.

- The first question is the shape of every other one: *"What kind of story do you
  want to make?"* answered as **categories** — thriller, coming-of-age, sci-fi, and
  so on. Pick a category, not a paragraph.
- Every question works the same way: a list of concrete options.
- **There is always an escape hatch.** When no option fits, the user picks
  *Other* and types it, or asks for more options. Never trap the user inside a
  fixed list — if the choices are wrong, the fix is more choices or free text, not
  a worse default.
- Answers are recorded, not inferred. A genre the user did not pick is not a genre.

The harness owns **structure**; the model owns **prose**. Structure means: which
beats exist, 4 shot prompts per sequence, the fixed prompt prefix and suffix, the
slicing geometry. The model supplies only the sentences. That split is what makes
it safe to swap models — see §2.

### 1b. Intake *between the developer and the user* — talk first

The failure mode this repo already hit once: an agent given a vague brief picked a
plausible architecture, built a large amount of it, and the user then had to unpick
all of it. That is expensive and it is the thing this file exists to prevent.

So, when changing the code:

1. **Ask a small number of questions, in one message, not one at a time.** Group
   them. If three answers would unblock you, ask three.
2. **Converge fast.** The user will answer tersely. Do not ask follow-ups that only
   refine wording.
3. **Never invent a product decision silently.** Column semantics, colour meaning,
   file layout, naming, which provider runs first — all of these were decided in
   conversation. If a decision is not written down here or in the code, it is
   undecided, not yours to make.
4. **When you are blocked on a decision, state the options and a recommendation.**
   Do not pick silently and move on.

### The shape of a good session here

The user has said the fast path looks like this:

> a bit of talk at the beginning, give me some images, and then the rest is done
> really quickly.

Concretely, that means:

- **Phase 1 — a short conversation.** A few exchanges to establish what is being
  made and what the constraints are. Cheap, and it prevents expensive rework.
- **Phase 2 — the user supplies a small number of images.** One to six, typically.
  These become the canonical references and they are the single most important
  input to the whole pipeline. Everything downstream derives from them.
- **Phase 3 — fast iteration.** With the references fixed, the rest of the build
  moves quickly and iteration gets cheap. Do not slow this phase down by
  re-litigating decisions already settled in Phase 1.

Do not skip Phase 1 just because the request sounds clear. Most "clear" requests in
this repo turned out to have one or two hidden forks.

### How this project actually started

Recorded here because the reasoning is not recoverable from the code:

- **The J programming language was considered as the underlying engine.** It was an
  early idea and it was not the thing that mattered. There is no engine. The app is
  ordinary TypeScript plus a provider chain, and it will stay that way — a
  programmatic LLM harness, not an agent. Treat "J" as explored-and-set-aside, not
  as a pending option to re-raise.
- The thing that *did* matter, and which the early design got wrong, was the
  reference-image pipeline. The user uploads a small set of images; the app derives
  canonical character and location establishing sheets from them; every downstream
  shot prompt refers back to those sheets. That is the spine of the project.
- Episodes were part of the original four-step flow. They were removed. The flow is
  now **Story → Generation → Timeline**. Do not reintroduce them.

---

## 2. Model selection and why the harness absorbs it

Text and JSON calls go through one route, `POST /api/llm`, which takes an optional
`prefer: "kimi" | "hyper"`. The chain reorders itself around that choice
(`api/_lib/llm.ts`, `CHAIN` plus a `req.prefer` head):

```ts
const order = req.prefer
  ? [req.prefer, ...CHAIN.filter((p) => p !== req.prefer)]
  : CHAIN;
```

First success wins, so the preferred model is attempted first and the other remains
as failover. **Kimi is free and is the one to prefer by default.**

The point of the split in §1a is that this is *safe*. The harness pins everything
structural — beat list, 4 shots per sequence, prompt prefix and suffix, grid
geometry, what a valid response is. A model supplies only prose. So swapping Kimi
for Hyper changes the writing and nothing else: no model can return something the
pipeline cannot slice or cannot attribute to a beat.

**There is no model picker in the UI yet.** `prefer` is threaded through
`src/utils/api.ts` but nothing sets it. Adding one is a small, self-contained piece
of work. OpenRouter is the third link in the chain and is retained for vision/QC
only; it is overdrawn and must not be on a primary button.

---

## 3. What this project is

| | |
|---|---|
| Repository | `gordo-v1su4/trailercraft` (public) |
| Package name | `trailercraft` |
| Local path | `~/Documents/Github/trailercraft` |

This repo was created fresh in September 2026. The predecessor,
`gordo-v1su4/batmanbuild-styled-pitch-deck-maker`, is a separate public repository
kept as an archive — it shares no history with this one, and nothing from it should
be pulled in. Its slug is a leftover from an unrelated product.

TRAILERCRAFT turns story beats into a trailer. The user writes a Save the Cat
structure, the app derives shot prompts from those beats, the user generates images
externally, the app organises the results and cuts them to music on a timeline.

**The app is not the image generator.** The image generation is manual and happens
in Higgsfield. The app is the organiser, the prompt builder, and the timeline. Do
not wire an image-generation call into a primary button.

### The unit of work: the sequence

This is the core mental model. Get this right and the rest follows.

| Term | Meaning |
|------|---------|
| **shot prompt** | one individual text item describing a single frame |
| **sequence** | exactly 4 shot prompts spanning one moment in the story — the thing you submit |
| **sequence grid** | the single 2x2 image that comes back from generation |
| **shot** | one tile, after the sequence grid is sliced apart |

A prompt for a sequence is short and natural. It is *not* a rules document. The real
example the user wrote, which works:

> 2x2 cinematic sequence shot grid, anamorphic lens optics. Nico Marzano (image 1)
> and Mira Vale (image 2) arrive at the motel (image 3) and check in to their room.
> Photorealistic, consistent wardrobe and lighting across all four frames, no text.

**Over-specified prompts make results worse.** This was learned the hard way: a
long prompt with an exhaustive list of layout rules produced a grid with gutters and
margins. A short prompt produced a clean flush grid. Keep prompts short. The only
rule worth always carrying is `no text`, because the panel names are composited
locally afterwards and a model that draws its own text corrupts them.

### Banned vocabulary

Never write these, anywhere — code, UI copy, comments, identifiers, commit messages:

- **"contact sheet"**
- **"storyboard"**
- **"generate assets"**

These words steer image models toward a different artifact than the one we want.
Use **sequence**, **sequence grid**, **shot**, **shot prompt** instead.

Verify with:

```bash
grep -rniE "contact sheet|storyboard|generate assets" src/ api/
```

The expected result is zero matches.

Also check hyphenated and joined forms, which the pattern above will not catch:

```bash
grep -rniE "contact-sheet|contact_sheet|generateassets" src/ api/
```

That second grep is the one that matters. It previously found `contact-sheet grid`
**inside the prompt string** in `api/_lib/sheet.ts` — the text actually sent to the
image model. A stale word in a comment is harmless; a stale word in a prompt steers
the model toward the wrong artifact, which is the entire reason the rule exists.
Check prompt strings by hand, not just prose.

Known identifiers that still use `Sheet` naming and are **not** violations, because
they are not the banned phrases: `generateSheet`, `SheetTile`, `SheetResult`,
`onGenerateAssets`, `generateStyledAssets`, `character-sheet`. They are prop and
function names. Renaming them touches the working Timeline path for no model-facing
benefit. Leave them unless there is a reason to move.

---

## 4. Hard constraints

These are not preferences. Violating any of them breaks the product.

- **No NextCloud. Ever.** The user was emphatic: *"DO NOT USE ANYTHING TITLED
  NEXTCLOUD!!!!!"* Do not use legacy NextCloud branches, do not restore them, do not
  reference them as a pattern. RustFS only.
- **Prompts stay short.** See §3. A prompt that reads like a specification is wrong.
- **No placeholder or mock data.** A previous `fallbackGeneration()` swallowed every
  error and filled the grid with fake cards, so a completely dead backend looked
  like a working app. That function is deleted and must stay deleted. Real errors
  render in `ErrorBanner` with a retry.
- **Never commit unless asked.** All work in this repo is currently uncommitted.
- **Never print a secret.** No token values, no passwords, in any output.

### A known security issue — do not reintroduce

A legacy NextCloud credential was exposed in tool output earlier in this project's
history. It must be revoked and rotated. It is not fixed. The user is removing the
references that led to it. If you encounter credentials in this repo or a sibling,
do not use them and do not echo them — surface it and stop.

---

## 5. Storage layout

Authoritative source of truth:

```
/Users/robertspaniolo/Documents/Github/proxmox-home/
  AGENTS.md
  docs/operator-source-of-truth.md
  docs/endpoint-index.md
  hostinger-ops/docs/rustfs-object-layout.md
```

The house layout:

| | |
|---|---|
| Bucket | `trailercraft` |
| Key | `media-uploads/YYYY/MM_DD/<run-id>/...` |
| Public URL | `https://s3.v1su4.dev/trailercraft/<key>` |
| Media API | `https://media.v1su4.dev` |

**The bucket name is never duplicated inside the key.** Getting this wrong was an
early bug and produced 404s that cost real time.

The CDN in front of RustFS caches responses fetched without an `Origin` header and
replays them without CORS headers, so `fetch()` fails intermittently while `<img>`
still works. All byte reads therefore go through the same-origin `/api/asset` route.

### Assets that must not be lost

These are published and load-bearing. Do not delete, overwrite, or regenerate them.

**Nico Marzano** (character sheet)
`https://s3.v1su4.dev/trailercraft/media-uploads/2026/09_26/2026-09-26T16-55-00Z/character-sheets/nico-marzano/1790456760406-sheet-nico-16x9.png`

**Mira Vale** (character sheet)
`https://s3.v1su4.dev/trailercraft/media-uploads/2026/09_26/2026-09-26T16-55-00Z/character-sheets/mira-vale/1790456760700-sheet-mira-16x9.png`

**Motel** (location sheet)
`https://s3.v1su4.dev/trailercraft/media-uploads/2026/09_26/2026-09-26T16-55-00Z/locations/motel/1790457714747-sheet-loc-motel-16x9.png`

**Run manifest**
`https://s3.v1su4.dev/trailercraft/media-uploads/2026/09_26/2026-09-26T16-55-00Z/1790461902687-run-manifest.json`

No images or video are committed to this repository — every extension in that list
is gitignored. The plates above are the canonical record; fetch them from RustFS if
you need the pixels. Locally they were at `proof/refs/01-nico.jpg`, `02-mira.jpg`
and `03-motel.jpg` (all 1536x864) before the ignore rule was added.

The manifest also references 8 earlier grids under `shotSheets`. These were made
from ad-hoc prompts *before* the story beats existed. They are **not** accepted
story output and should not be presented as such. Leave them in storage; do not
delete them.

---

## 6. Current state of the code

### Working

- Three-step flow: **Story → Generation → Timeline**. Episodes are removed.
- The 15-beat story exists and is persisted. The user wrote it; Kimi polished the
  prose. It is not randomly generated — do not describe it that way.
- Character and location establishing sheets, built from user-supplied images.
- `api/sheet.ts` slices a 2x2 grid into four 16:9 tiles using sharp. This works and
  has been used to slice real grids.
- `api/run.ts` + `RunLoader` load a published manifest from RustFS.
- `usePersistedState` persists story beats, style, characters, title, scenes and
  timeline to localStorage.
- Kimi → Hyper → OpenRouter text chain works. Kimi is free and is the one to prefer.

### Not working

- **OpenRouter image generation is dead.** The account is overdrawn and returns
  HTTP 402. No image-generation button may be wired to it.
- **Higgsfield has no API credentials.** Only the manual browser lane works.
- **There is no way to upload an image and have the app build the establishing
  sheets automatically.** That is done by hand.
- **The sequence board does not exist.** `GenerationStep.tsx` still renders the old
  `SceneCard` grid with a "Generate Contact Sheets" button that calls the dead
  OpenRouter path. This is the current piece of work. See §7.

### Known problems

- A stray object sits in a sibling project's bucket. Deletion reports success from
  two different code paths and does not delete; it needs a delete-scoped
  credential or a console action. The user is handling it.
- LocalStorage is per-browser, so a fresh context sees an empty story. Story beats
  are not yet in the run manifest, so they cannot be shared or restored from
  storage yet.
- Loose files in the repo root (`attach2.js`, `attach3.js`, `setp.js`, `ids.json`,
  `.ignore`, `.tmp/`) are scratch. Do not rely on them; do not delete them without
  asking.

---

## 7. What is being built next

The Generation screen becomes an interactive **sequence board**: a dense,
drag-and-drop table where each row is one sequence.

- Rows are seeded one per story beat, each with 4 shot prompts.
- Drag a shot prompt between rows to regroup which moment it belongs to.
- A row's 4 shots assemble into one prompt, which is copied for manual generation.
- The user returns a 2x2 grid; dropping it on the row slices it into 4 shots.
- Per shot: keep, reject, lock. Rejecting returns the shot to the pool so it can be
  regrouped. Locked shots are skipped when assembling the next prompt.
- Group size is **fixed at 4**. Do not build variable-size groups.

The point of the mechanic is the loop: organise, generate, break apart, keep or
reject, regroup, generate again.

---

## 8. Verifying

```bash
npx tsc --noEmit     # must be clean
bun run build       # must succeed
grep -rniE "contact sheet|storyboard|generate assets" src/ api/   # must be empty
```

Report the actual output of all three. Do not describe a build as passing without
having run it.

---

## 9. Working with this user

- **Be concise.** Long explanations are unwelcome. Short answers, no preamble, no
  restating the question back.
- **Do not start with acknowledgement.** No "Great question", no "I'll get started".
- **Flag disagreement once, briefly, then respect the decision.** If an approach
  looks wrong, say so in a sentence or two and offer an alternative. If the user
  proceeds anyway, proceed.
- **Match their language.** They write informally; reply plainly.
- **Deliver what was asked, not the adjacent thing.** If asked for one prompt, give
  one prompt.
- They iterate fast and watch closely. Assume any change will be reviewed.
