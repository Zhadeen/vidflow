# VidFlow Plan 1 — Setup, Spikes, and the Batch Picture Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the VidFlow extension, prove the five risky parts with throwaway spikes, then ship Stage 1: a scene file goes in and every scene's picture comes out of Google Flow, saved under the right scene, at the right aspect ratio, shown in the studio.

**Architecture:** A Manifest V3 extension built with WXT. A full-page **studio** (React) is the only real UI; a **background coordinator** owns the job queue and persists it; a **Flow helper** content script, limited to Flow's site, drives Flow and shows a status pill. Project data lives in IndexedDB; media files live in the Origin Private File System (OPFS).

**Tech Stack:** WXT 0.20.x, TypeScript 5 (strict), React 19, Vitest 3 + jsdom + @testing-library/react, `fake-indexeddb` for store tests, `idb` for IndexedDB, `papaparse` for CSV. Node 22. No server, no paid APIs.

**Spec:** `docs/superpowers/specs/2026-11-05-vidflow-design.md` (approved 5 Nov 2026). Read it before any task.

**Deferred from Stage 1 to later plans:** generating a hero model sheet in Flow (Plan 2), text overlays and "export assets" (Plan 5), credit options (Plan 3).

**Later plans (not this one):** Plan 2 = automatic best-picture choice (needs spike 1). Plan 3 = Motion (needs spike 2). Plan 4 = Voice (needs spike 4). Plan 5 = Edit + Export (needs spike 3). Plan 6 = polish pass with impeccable / apple-design.

## Before starting (owner actions)

- Confirm the VidFlow Google account's exact address. He wrote `unscripted4c01e@gmail.com`; his sign-in list shows `unscripted4ce01@gmail.com`.
- That account must have Google AI Pro access to Flow (its own plan or family sharing from his plan). Spikes 2, 4 and 5 run signed in to that account, never `unscripted4ce@gmail.com`.

## Global Constraints

- Extension name: **VidFlow**. Repo: `~/Developer/VidFlow`.
- Manifest V3, Chrome on macOS.
- Host permissions only: `https://flow.google.com/*`, `https://labs.google/*`, `https://aistudio.google.com/*`. Never `<all_urls>`.
- Permissions: `storage`, `unlimitedStorage`, `downloads`, `notifications`, `power`, `tabs`. Add `debugger` only if spike 5 or 2 proves normal input fails, and record why in the spike note.
- No network requests to any host except the Google pages above. No paid APIs (no Vertex AI, Anthropic API, Gemini API keys).
- Automation boundary: wait for Flow's buttons to become enabled; never force-enable a disabled control; never auto-accept Google usage-policy dialogs — pause and ask the owner.
- Never type into a tab VidFlow did not open in its dedicated window.
- Palette tokens: navy `#14213D` (background), cream `#F4EDE0` (text), coral `#FF6B5B` (primary action, "Best match"); coral buttons use navy text. Shades of navy only for surfaces/borders. Text contrast ≥ WCAG AA.
- One coral primary action per screen. Images shown at full brightness, never dimmed by overlays.
- Copy: plain, short sentences; every error says what went wrong and the next step.
- Spike code lives under `spikes/` and is never imported by `src/`.

## Review Focus

1. **Two scenes with identical image prompts** — each still gets its own picture under its own scene number (Task 8 test `matches duplicate prompts by submission order`).
2. **Flow refuses one scene mid-run** — that scene is marked refused with Flow's message and the run continues to the next (Task 6 test `refusal marks scene and advances`).
3. **Chrome closed mid-run** — on reopen, finished scenes stay finished and the run resumes from the first unfinished scene (Task 6 test `restores persisted run and resumes at first unfinished`).
4. **Flow tab signed in to the VidFlint account `unscripted4ce@gmail.com`** — the run refuses to start and says which account to switch to (Task 7 test `blocks start when signed in as protected account`).
5. **Scene file with quotes, commas, emoji, and a non-English sentence** — parsed intact, no row dropped (Task 2 test `keeps quoted commas emoji and non-English text`).

---

### Task 1: Project setup

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/entrypoints/background.ts`, `src/entrypoints/studio/index.html`, `src/entrypoints/studio/main.tsx`, `src/entrypoints/flow.content.ts`, `tests/manifest.test.ts`

**Interfaces:**
- Produces: `npm run build` → `.output/chrome-mv3/`; `npm test` runs Vitest. Studio page reachable at `chrome-extension://<id>/studio.html`; toolbar icon click opens/focuses it.

- [ ] **Step 1: Write the failing test** — `tests/manifest.test.ts` builds nothing; it imports the manifest object exported from `wxt.config.ts` and asserts:

```ts
expect(manifest.name).toBe('VidFlow');
expect(manifest.host_permissions).toEqual([
  'https://flow.google.com/*', 'https://labs.google/*', 'https://aistudio.google.com/*',
]);
expect(manifest.permissions).toEqual(
  expect.arrayContaining(['storage','unlimitedStorage','downloads','notifications','power','tabs']));
expect(manifest.permissions).not.toContain('debugger');
expect(manifest.permissions).not.toContain('cookies');
```

- [ ] **Step 2: Run** `npm test -- manifest` → FAIL (no config).
- [ ] **Step 3: Implement** WXT config exporting `manifest`; Flow content script `matches: ['https://flow.google.com/*','https://labs.google/fx/*']`; background opens/focuses the studio tab on `action.onClicked`. `.gitignore` includes `.output`, `node_modules`, `.wxt`.
- [ ] **Step 4: Run** `npm test -- manifest` → PASS; `npm run build` → exits 0.
- [ ] **Step 5: Manual check** — load `.output/chrome-mv3` unpacked in Chrome; clicking the icon opens the studio tab; clicking again focuses the same tab.
- [ ] **Step 6: Commit** `chore: set up VidFlow extension`.

---

### Task S5: Spike — Flow controls and result tracking (throwaway)

**Files:** Create: `spikes/flow-tracking/` (anything), `docs/superpowers/spikes/s5-flow-tracking.md`, `tests/fixtures/flow/` (saved DOM snapshots)

Runs signed in to the VidFlow Google account, on a new Flow project.

- [ ] **Step 1:** Find and record stable selectors (prefer roles/aria-labels over class names) for: prompt input, Generate button (and its disabled state), aspect-ratio control and its options, outputs-count control, model picker, the Ingredient (reference image) slot and how to upload into it, result cards, each card's prompt caption, each card's image URL, generation progress (the "26%" overlay), refusal/limit messages, signed-in account email, usage-policy dialog.
- [ ] **Step 2:** Prove VidFlow can set aspect ratio to 16:9 and outputs to 2 through Flow's real controls, and that the resulting images are landscape.
- [ ] **Step 3:** Submit 3 prompts back to back, two of them identical. Record how a result card can be tied to its submission (caption text, DOM order, a request id in network traffic, timing). Pick the rule and record it.
- [ ] **Step 4:** Record whether normal content-script events are accepted for typing and Generate, or whether debugger input is required.
- [ ] **Step 5:** Record Flow's exact wording for a quota limit and a refusal, and where remaining credits are shown.
- [ ] **Step 6:** Save DOM snapshots (idle, generating, two finished cards, refused, limit, policy dialog) to `tests/fixtures/flow/*.html` for Task 7/8 tests. Strip personal data.
- [ ] **Step 7:** Write findings to `docs/superpowers/spikes/s5-flow-tracking.md`: selectors, matching rule, input method, messages. Commit `spike: Flow controls and result tracking`.

### Task S1: Spike — picture judging with Chrome's built-in AI (throwaway)

**Files:** Create: `spikes/nano-judge/`, `docs/superpowers/spikes/s1-nano-judge.md`

- [ ] **Step 1:** On the owner's Mac and Chrome, check `LanguageModel.availability()` with image input from an extension page; record result, Chrome version, download size/time if a download is needed.
- [ ] **Step 2:** For 6 real stickman pairs (from Flow, two per prompt, including one "by the window" vs "far from window" style pair), ask the model which image better matches the prompt and why. Record the pick, whether a human agrees, and seconds per pair.
- [ ] **Step 3:** Write a verdict in `docs/superpowers/spikes/s1-nano-judge.md`: usable / usable with caveats / not usable, and the fallback to use if not. Commit.

### Task S2: Spike — Flow image-to-video (throwaway)

**Files:** Create: `spikes/flow-video/`, `docs/superpowers/spikes/s2-flow-video.md`

- [ ] **Step 1:** Using one Flow picture and a one-sentence motion prompt, drive Flow's image-to-video (Veo) from the extension. Record controls/selectors, clip length, file format, credits charged (fast vs quality option), and how a clip ties to its source picture.
- [ ] **Step 2:** Record whether credits shown separate free daily / plan / purchased pools, and how to read the remaining amount.
- [ ] **Step 3:** Write findings and commit.

### Task S3: Spike — in-browser export (throwaway)

**Files:** Create: `spikes/export/`, `docs/superpowers/spikes/s3-export.md`

- [ ] **Step 1:** In an extension page, build a 1920×1080 MP4 from 20 inputs (10 stills with zoom/pan, 10 short clips trimmed to 3–6 s) plus one audio track, using WebCodecs with an MP4 muxer, in a worker. Record total time, peak memory, output plays in QuickTime.
- [ ] **Step 2:** If WebCodecs fails, try ffmpeg.wasm and record the same numbers. Write the recommendation and commit.

### Task S4: Spike — AI Studio voice (throwaway)

**Files:** Create: `spikes/aistudio-voice/`, `docs/superpowers/spikes/s4-aistudio-voice.md`

- [ ] **Step 1:** On `https://aistudio.google.com/generate-speech`, signed in to the VidFlow account, generate and download speech for 3 separate sentences with the same voice. Record selectors, voice selection, file format, duration readout, and whether the voice stays consistent across separate generations.
- [ ] **Step 2:** Write findings and commit.

### Gate: report spike results to the owner

- [ ] Summarise each spike's verdict in plain words. If any spike changes the design, update the spec and get his OK before Task 2. Plans 2–5 are written from these notes.

---

### Task 2: Scene file parser

**Files:**
- Create: `src/scenes/types.ts`, `src/scenes/parse.ts`
- Test: `tests/scenes/parse.test.ts`

**Interfaces:**
- Produces:

```ts
// src/scenes/types.ts
export interface Scene {
  id: string;               // 'scene-01'
  slide: number;            // 1-based
  start: number | null;     // seconds
  end: number | null;
  sentence: string;
  concept: string;
  textOverlay: string;
  imagePrompt: string;
  motionPrompt: string;     // filled by defaultMotionPrompt when missing
  motionPromptIsDefault: boolean;
}
export interface ParseIssue { line: number; message: string }
export interface ParseResult { scenes: Scene[]; issues: ParseIssue[] }
// src/scenes/parse.ts
export function parseSceneFile(text: string): ParseResult;
export function parseTimecode(s: string): { start: number; end: number } | null;
// src/scenes/motion.ts
export function defaultMotionPrompt(text: string): string;
```

- [ ] **Step 1: Write the failing tests:**
  - `parses the VidFlow CSV header` — header `Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt` (any case, any column order) → fields mapped; `"Slide 02"` → `slide: 2`, `id: 'scene-02'`.
  - `parseTimecode handles MM:SS - MM:SS and seconds` — `"00:04 - 00:09"` → `{start:4,end:9}`; `"1:02–1:07"` → `{start:62,end:67}`; `"6s-7s"` → `{start:6,end:7}`; `"soon"` → `null`.
  - `accepts Flow Flash's six-column file` — header ending in `Prompt` → that column becomes `imagePrompt`; `motionPromptIsDefault: true`.
  - `accepts plain and numbered lines` — `"1. A stickman waves"` → slide 1, imagePrompt `"A stickman waves"`.
  - `fills a missing motion prompt` — empty Motion Prompt → `motionPrompt === defaultMotionPrompt(sentence || imagePrompt)` and `motionPromptIsDefault: true`.
  - `keeps quoted commas emoji and non-English text` — a row with `"Hello, world 👋"` and `"Ẹ kú àárọ̀"` survives intact; scene count equals data rows.
  - `reports problems without dropping rows` — a row with no image prompt → kept with an issue `{line, message: 'Scene 3 has no image prompt.'}`.
  - `strips a fenced code block` — text wrapped in ```` ```csv … ``` ```` (how Claude replies) parses the same.
  - `defaultMotionPrompt is short and about movement` — for `"So I switched everything off."` returns ≤ 200 chars, contains `"So I switched everything off"`, and starts with `"Gentle, natural movement:"`.
- [ ] **Step 2: Run** `npm test -- parse` → FAIL.
- [ ] **Step 3: Implement** with `papaparse` for CSV; detect CSV by a header containing `prompt`; otherwise plain lines.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: parse scene files`.

---

### Task 3: Prompt builder and stickman styles

**Files:**
- Create: `src/prompts/styles.ts`, `src/prompts/build.ts`
- Test: `tests/prompts/build.test.ts`

**Interfaces:**
- Consumes: `Scene` (Task 2).
- Produces:

```ts
export type StyleId = 'stickman-whiteboard' | 'stickman-doodle-comic' | 'stickman-colour' | 'custom';
export interface StylePreset { id: StyleId; name: string; prefix: string; enforcement: string; forbiddenWords: string[] }
export const STYLE_PRESETS: Record<Exclude<StyleId,'custom'>, StylePreset>;
export interface CharacterSpec { description: string; hasReferenceImage: boolean }
export function buildImagePrompt(scene: Scene, style: StylePreset, character: CharacterSpec | null): string;
```

- [ ] **Step 1: Write the failing tests:**
  - `orders style, character, scene, enforcement` — output contains, in order, `style.prefix`, the character block, `Scene: <imagePrompt>`, `style.enforcement`.
  - `omits the character block when none` — no `HERO` text when `character` is `null`.
  - `removes words that fight the style` — character description `"natural photorealistic facial features"` with any stickman preset → output does not match `/photorealistic|realistic skin|3D/i`.
  - `never writes aspect ratio into the prompt` — output does not match `/aspect ratio|16:9|9:16/i`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** three presets with stickman wording (whiteboard: black ink stick figures, round heads, white background; doodle comic: hand-drawn comic panels, light paper; colour: simple stick figures with flat colour fills); `forbiddenWords` include `photorealistic`, `realistic`, `3D`, `CGI`, `render`. **Step 4: Run** → PASS. **Step 5: Commit** `feat: build image prompts with stickman styles`.

---

### Task 4: Claude prompt ("Mother Prompt")

**Files:**
- Create: `src/prompts/claude.ts`
- Test: `tests/prompts/claude.test.ts`

**Interfaces:**
- Produces: `export function buildClaudePrompt(script: string): string;`

- [ ] **Step 1: Write the failing tests:**
  - `asks for the exact CSV header` — contains `Slide,Timecode,Sentence,Concept,Text Overlay,Image Prompt,Motion Prompt`.
  - `states the scene rules` — contains `never skip`, `split`, `3 to 6 seconds`, `the hero`, and a line forbidding art style words.
  - `appends the script last` — ends with `SCRIPT:\n<script>`.
  - `round-trips with the parser` — a sample reply written in the requested format (fixture `tests/fixtures/claude-reply.csv`, 4 rows) parses with `parseSceneFile` to 4 scenes and zero issues.
- [ ] **Step 2–4:** run (FAIL) → implement (write the full prompt text; rules from spec §7.2) → run (PASS).
- [ ] **Step 5: Commit** `feat: Claude prompt for scene files`.

---

### Task 5: Project store

**Files:**
- Create: `src/store/projects.ts`, `src/store/media.ts`
- Test: `tests/store/projects.test.ts`, `tests/store/media.test.ts`

**Interfaces:**
- Consumes: `Scene`, `StyleId`, `CharacterSpec`.
- Produces:

```ts
export type AspectRatio = '16:9' | '9:16' | '1:1';
export type SceneStatus = 'pending' | 'submitted' | 'done' | 'refused' | 'failed';
export interface SceneState { sceneId: string; status: SceneStatus; message?: string; pictureIds: string[]; chosenPictureId?: string }
export interface Project {
  id: string; name: string; createdAt: number; updatedAt: number;
  scenes: Scene[]; style: StyleId; customStyle?: string; character: CharacterSpec | null;
  aspect: AspectRatio; outputsPerPrompt: 1 | 2 | 4; sceneStates: Record<string, SceneState>;
}
export function createProject(name: string): Promise<Project>;
export function getProject(id: string): Promise<Project | undefined>;
export function saveProject(p: Project): Promise<void>;
export function listProjects(): Promise<Pick<Project,'id'|'name'|'updatedAt'>[]>;
export function deleteProject(id: string): Promise<void>;
// media.ts — OPFS-backed, with an in-memory implementation for tests
export interface MediaStore {
  put(projectId: string, name: string, data: Blob): Promise<string>;   // returns mediaId
  get(mediaId: string): Promise<Blob | undefined>;
  removeProject(projectId: string): Promise<void>;
}
export function opfsMediaStore(): MediaStore;
export function memoryMediaStore(): MediaStore;
```

- [ ] **Step 1: Write the failing tests** (with `fake-indexeddb/auto`): `create then get returns same project`; `listProjects sorted by updatedAt desc`; `deleteProject removes media too` (uses `memoryMediaStore`); `media put/get round-trips a 5 MB blob`.
- [ ] **Step 2–4:** FAIL → implement with `idb` (db `vidflow`, store `projects`) → PASS.
- [ ] **Step 5: Commit** `feat: store projects and media locally`.

---

### Task 6: Run coordinator (picture runs)

**Files:**
- Create: `src/runs/run.ts` (pure state machine), `src/runs/coordinator.ts` (background wiring)
- Test: `tests/runs/run.test.ts`

**Interfaces:**
- Consumes: `Project`, `SceneState`.
- Produces:

```ts
export type RunEvent =
  | { type: 'start' } | { type: 'pause' } | { type: 'resume' }
  | { type: 'submitted'; sceneId: string }
  | { type: 'pictures'; sceneId: string; mediaIds: string[] }
  | { type: 'refused'; sceneId: string; message: string }
  | { type: 'failed'; sceneId: string; message: string }
  | { type: 'limit'; message: string; resumeAt: number | null }
  | { type: 'needsOwner'; reason: 'policy-dialog' | 'signed-out' | 'wrong-account' | 'page-not-recognised'; message: string };
export interface RunState {
  projectId: string; status: 'idle' | 'running' | 'paused' | 'finished';
  pauseReason?: string; resumeAt?: number | null; inFlight: string[];
  sceneStates: Record<string, SceneState>;
}
export function initRun(project: Project): RunState;
export function reduceRun(state: RunState, event: RunEvent): RunState;
export function nextSceneToSubmit(state: RunState, order: string[], maxInFlight: number): string | null;
export function runSummary(state: RunState): { done: number; refused: string[]; failed: string[]; pending: number };
```

- [ ] **Step 1: Write the failing tests:**
  - `submits scenes in order up to maxInFlight` — maxInFlight 3 → scene-01..03 then `null` until one finishes.
  - `refusal marks scene and advances` — `refused` on scene-02 → status `refused`, message kept, next submit is scene-04 (after 01/03 in flight).
  - `limit pauses with resumeAt` — `limit` with `resumeAt: T` → status `paused`, `resumeAt === T`, `nextSceneToSubmit` → `null`.
  - `needsOwner pauses with plain reason` — `policy-dialog` → `paused`, `pauseReason` equals the event message.
  - `restores persisted run and resumes at first unfinished` — state with 01–05 done and 06 `submitted` (stale) serialised to JSON and back, then `resume` → 06 is resubmitted first.
  - `finishes when nothing pending or in flight` — status `finished`; `runSummary` lists refused and failed ids.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Implement `coordinator.ts`** (not unit-tested; verified in Task 10): persists `RunState` to `chrome.storage.local` on every change; schedules `chrome.alarms` for `resumeAt`; calls `chrome.power.requestKeepAwake('system')` while running and releases when paused/finished; opens Flow in a dedicated window it remembers by id; sends a Chrome notification on finish/pause; pacing between submits = 4–7 s random. Add `alarms` to permissions and update the Task 1 manifest test.
- [ ] **Step 6: Commit** `feat: picture run coordinator`.

---

### Task 7: Flow helper

**Files:**
- Create: `src/flow/selectors.ts` (from spike S5 note), `src/flow/driver.ts`, `src/flow/pill.ts`; modify `src/entrypoints/flow.content.ts`
- Test: `tests/flow/driver.test.ts` (jsdom over `tests/fixtures/flow/*.html`)

**Interfaces:**
- Produces:

```ts
export interface FlowPageState {
  ready: boolean; signedInEmail: string | null; generating: boolean;
  limitMessage: string | null; policyDialog: boolean;
}
export interface FlowDriver {
  read(): FlowPageState;
  setAspect(a: AspectRatio): Promise<void>;
  setOutputs(n: 1 | 2 | 4): Promise<void>;
  attachReference(image: Blob): Promise<void>;     // hero reference picture into Flow's Ingredient slot
  submit(prompt: string): Promise<void>;          // waits until Generate is enabled; never force-enables
  resultCards(): FlowResultCard[];
}
export interface FlowResultCard { key: string; caption: string; imageUrl: string | null; progress: number | null; refusal: string | null; domIndex: number }
export const PROTECTED_ACCOUNTS = ['unscripted4ce@gmail.com'];
export function checkCanStart(s: FlowPageState): { ok: true } | { ok: false; reason: 'wrong-account' | 'signed-out' | 'policy-dialog' | 'page-not-recognised'; message: string };
```

- [ ] **Step 1: Write the failing tests** (fixtures from S5):
  - `reads idle page as ready` / `reads generating`/`limit`/`policy dialog` from each fixture.
  - `blocks start when signed in as protected account` — signedInEmail `unscripted4ce@gmail.com` → `{ok:false, reason:'wrong-account', message: 'Flow is signed in to unscripted4ce@gmail.com, the VidFlint account. Switch Flow to your VidFlow account, then press Start again.'}`.
  - `submit waits for an enabled Generate button` — fixture with disabled Generate: `submit` doesn't click until the button's disabled attribute is removed; asserts it never sets `disabled=false` itself.
  - `resultCards lists each card with caption and image` — two-cards fixture → 2 cards with non-empty `caption` and `imageUrl`.
- [ ] **Step 2–4:** FAIL → implement using the spike's selectors and input method → PASS.
- [ ] **Step 5: Implement the pill** — small fixed pill, bottom-left, navy with cream text: `VidFlow · Picture {n} of {total}` + Pause/Resume; never covers Flow's prompt bar. Shown only when VidFlow is running in this tab.
- [ ] **Step 6: Commit** `feat: Flow helper`.

---

### Task 8: Match results to scenes

**Files:**
- Create: `src/flow/match.ts`
- Test: `tests/flow/match.test.ts`

**Interfaces:**
- Consumes: `FlowResultCard`.
- Produces:

```ts
export interface Submission { sceneId: string; prompt: string; submittedAt: number; seq: number }
export interface Match { sceneId: string; cardKeys: string[] }
export function matchResults(submissions: Submission[], cards: FlowResultCard[], seenCardKeys: Set<string>, outputsPerPrompt: number): Match[];
```

Rule: use the S5 matching rule. Default if the spike confirms captions reflect the prompt: a new (unseen) card belongs to the earliest unmatched submission whose prompt caption matches; among equal captions, assign by submission `seq` order. A scene is complete when it has `outputsPerPrompt` finished cards or a refusal.

- [ ] **Step 1: Write the failing tests:**
  - `matches each card to its own prompt` — the 5 Nov failure case: two different prompts, cards arriving out of order → each scene gets only its own cards.
  - `matches duplicate prompts by submission order` — scene-03 and scene-07 with identical prompts → first two new cards to scene-03, next two to scene-07.
  - `ignores cards seen before the run` — cards in `seenCardKeys` are never assigned.
  - `waits for all outputs` — one of two cards finished → scene not in result yet.
  - `refusal completes a scene with no pictures`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat: match Flow results to scenes`.

---

### Task 9: Studio — projects, Script step, Pictures step

**Files:**
- Create: `src/studio/theme/tokens.css`, `src/studio/App.tsx`, `src/studio/ProjectsHome.tsx`, `src/studio/StepBar.tsx`, `src/studio/ScriptStep.tsx`, `src/studio/PicturesStep.tsx`, `src/studio/SceneGrid.tsx`, `DESIGN.md`
- Test: `tests/studio/*.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–8. Studio ↔ background messages: `{type:'run/start', projectId}`, `{type:'run/pause'}`, `{type:'run/resume'}`, and background → studio `{type:'run/state', state: RunState}`.

Layout C from the approved mockup (`~/Developer/VidFlint/.superpowers/brainstorm/48768-1793842330/content/studio-layout.html`, option C) in the Navy-with-cream look (`visual-style-v2.html`, option B). Steps bar shows Script, Voice, Pictures, Motion, Edit, Export; in this plan Voice/Motion/Edit/Export show "Coming next" and are not clickable.

- [ ] **Step 1: Write the failing tests:**
  - `each screen has exactly one primary button` — render Projects home, Script step (valid file), Pictures step (idle and running); count elements with `data-variant="primary"` → 1 each.
  - `Copy Claude Prompt copies prompt with script` — mocks clipboard; copied text equals `buildClaudePrompt(script)`.
  - `shows parse issues in plain words` — a file with a missing image prompt shows `Scene 3 has no image prompt.` and Continue stays enabled.
  - `Pictures step shows live progress` — given `RunState` with 38 of 60 done → step bar reads `Pictures 38/60`.
  - `refused scenes list Flow's reason with Try again` — a refused scene shows its message and a `Try again` button.
  - `wrong account message is shown before starting` — when background replies `wrong-account`, the exact Task 7 message appears.
- [ ] **Step 2–4:** FAIL → implement (React; tokens from Global Constraints in `tokens.css`; Script step has paste box, file drop, Copy Claude Prompt, style picker with the three presets + custom, hero description + reference image upload, aspect ratio, pictures per prompt) → PASS.
- [ ] **Step 5:** Write `DESIGN.md` for VidFlow: tokens (colours, type scale, radii, spacing), button variants and their five states, copy rules. Use the impeccable skill to review the three screens and fix what it finds.
- [ ] **Step 6: Commit** `feat: studio projects, script and pictures steps`.

---

### Task 10: End-to-end check on the real Flow

- [ ] **Step 1:** `npm run build`; load unpacked; Flow signed in to the VidFlow account.
- [ ] **Step 2:** New project, paste a 6-scene file including two identical prompts and one deliberately long prompt; style `stickman-whiteboard`, 16:9, 2 per prompt; Start.
- [ ] **Step 3:** Verify: every scene shows its own two pictures (open each, compare to its prompt); all are landscape; the dedicated Flow window was used; the pill showed progress; a notification appeared at the end.
- [ ] **Step 4:** Close Chrome mid-run on a second project; reopen; press Resume; verify it continues from the first unfinished scene with no duplicates.
- [ ] **Step 5:** Record results in `docs/superpowers/spikes/stage-1-e2e.md`, including every failure and its fix. Commit `test: stage 1 end-to-end on Flow`.
