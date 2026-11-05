# VidFlow Plan 2 — Picture choice and hero reference

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scene uses one chosen picture that the owner can swap with one click, and the hero looks the same in every scene because VidFlow attaches a reference picture (uploaded, or picked from a model sheet Flow makes) to every Flow prompt.

**Architecture:** The choice is a field already on `SceneState` (`chosenPictureId`); one helper decides which picture a scene uses, and every view reads it. The hero reference is a picture in the media store, named on the project; Flow's driver attaches it through Flow's own "Add ingredients" picker before each Generate. A model sheet is a one-prompt run through the existing coordinator.

**Tech Stack:** WXT 0.20, React 19, TypeScript strict, Vitest + jsdom + Testing Library, IndexedDB (idb), OPFS media store.

**Spec:** `docs/superpowers/specs/2026-11-05-vidflow-design.md` — §4 (model sheet + hero in the Ingredient slot), §7.2 Step 1/3/5, §8 (picture choice and fallbacks), §9 (design), §16. Spikes: `docs/superpowers/spikes/s1-nano-judge.md` (Nano not usable), `s6-flow-agent-judge.md` (Flow's Agent can't say which picture).

## Owner decisions this plan carries

- Picture choice = **Flow's first picture by default + one-click swap** (owner, 5 Nov 2026, "Swap + test Agent"). The Agent test is Task 6; it only adds "Auto-pick" in a later plan if it passes.
- The chosen card keeps the approved "★" coral pill and coral border, but the pill reads **"★ Using this"**, not "★ Best match": nothing judged it, and the spec's fallback says the owner should know a scene is "not auto-checked". **Needs the owner's OK at plan review** (design is locked).

## Global Constraints

- Design is locked (`docs/design/approved/README.md`): navy `#14213D`, cream `#F4EDE0`, coral `#FF6B5B` with navy text; navy shades only; exactly one coral primary per screen; chosen card = coral pill + coral border (§9).
- Never delete a picture that isn't used: "discard" means "not used" until export (§8). Swapping never deletes.
- No new hosts, no new permissions. Hosts stay `flow.google.com`, `labs.google`, `aistudio.google.com`, `flow-content.google`.
- Flow matching never guesses: a result is saved only when its detail page's media id and prompt match (Plan 1 rule) — the hero-sheet run uses the same rule.
- Pictures cost 0 credits (Nano Banana 2.1 on Pro). Flow's Agent may cost credits: measure before and after in Task 6, and never call the Agent from shipped code in this plan.
- VidFlow never force-enables Flow buttons and never accepts Flow policy/billing dialogs.
- Reference picture: PNG, JPEG or WebP, at most 10 MB; stored in the media store as `hero-reference` under the project.
- Commits: `git -c user.name=unscripted4ce -c user.email=unscripted4ce@gmail.com commit`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Finish every task with `npm run build:e2e` only when a live check follows; otherwise leave the normal build and pass `npm run check:prod-clean`.

## Review Focus

1. **Swapping a scene while a run is live** — the choice must survive the run's next `sceneStates` broadcast and the studio/panel merge (Task 1 test `a choice made during a run survives the next run broadcast`).
2. **Re-making a scene ("Try again")** — its old choice is cleared because its pictures are new (Task 1 test `try again clears the choice`).
3. **A reference picture that is too big, the wrong type, or unreadable** — a plain message, nothing saved (Task 3 test `rejects a 12 MB file and a .gif with a plain message`).
4. **Flow's ingredient upload fails or the picker changed** — the run pauses with a plain message; it never sends a prompt that says "match the reference" without the reference attached (Task 4 test `pauses instead of sending without the reference`).
5. **Making a model sheet while another run is live** — refused with the existing busy message (Task 5 test `model sheet refuses while a run is live`).

---

### Task 1: The chosen picture

**Files:** Create `src/studio/choice.ts`; modify `src/runs/run.ts`, `src/runs/coordinator.ts` (keep `chosenPictureId` across broadcasts), `src/studio/SceneGrid.tsx`, `src/panel/PanelRun.tsx` (strip thumbnails if any), `src/studio/PicturesStep.tsx` (grid urls); tests `tests/studio/choice.test.ts`, `tests/runs/coordinator.test.ts`.

**Interfaces — Produces:**
```ts
/** The picture a scene uses: the owner's choice if it is still one of the scene's pictures, else Flow's first. */
export function chosenPicture(state: SceneState | undefined): string | undefined;
/** Saves the owner's choice (must be one of the scene's pictureIds); works while a run is live. */
export async function choosePicture(projectId: string, sceneId: string, pictureId: string): Promise<void>;
```
- Background message `run/choose` `{ projectId, sceneId, pictureId }` (allowed only from `isOwnPage` senders) so a live run's state and the stored project both take the choice; `RunClient.choose(projectId, sceneId, pictureId)`.

- [ ] **Step 1: Failing tests:** `uses the chosen picture, else the first`; `ignores a choice that is no longer one of the pictures`; `choosePicture rejects an id that isn't the scene's`; `a choice made during a run survives the next run broadcast`; `try again clears the choice` (existing `run.ts` line ~149 behaviour pinned); `the scene grid shows the chosen picture`.
- [ ] **Step 2–4:** RED → implement → GREEN. Every place that shows "the scene's picture" (`SceneGrid`, grid `wanted` ids in `PicturesStep`, panel) calls `chosenPicture`.
- [ ] **Step 5:** Full suite, `tsc`, build, `check:prod-clean`. Commit `feat: each scene's chosen picture`.

### Task 2: One-click swap in the studio

**Files:** Modify `src/studio/PicturesStep.tsx` (`Options`), `src/studio/theme/studio.css`; test `tests/studio/swap.test.tsx`.

**Interfaces — Consumes:** `chosenPicture`, `RunClient.choose` (Task 1).

- [ ] **Step 1: Failing tests:**
  - `the chosen option has the "★ Using this" pill and coral border`;
  - `clicking another option's "Use this picture" swaps in one click and moves the pill`;
  - `the swap shows in the scene grid at once`;
  - `swapping logs "Scene N · Swapped to picture K" in the activity list` (via `logActivity`);
  - `the status line reads "VidFlow uses Flow's first picture. Click another to swap."` when no scene has a choice yet;
  - `still exactly one coral primary on the screen` (the pill is not a button).
- [ ] **Step 2–4:** RED → implement per the approved card look (`visual-style-v2.html` lines 27/66: coral pill top-left, navy text, 11px/700, `3px 9px`, radius 999px; coral border on the chosen card). "Use this picture" is a cream outlined secondary button; the whole other card is also clickable (keyboard: Enter/Space). → GREEN.
- [ ] **Step 5:** Refresh `docs/design/build-check/pictures-step-swap.png` with the visual harness. Commit `feat: swap a scene's picture in one click`.

### Task 3: Hero reference picture (upload)

**Files:** Create `src/studio/HeroReference.tsx`; modify `src/prompts/build.ts` (`CharacterSpec` gains `referenceMediaId?: string`; `hasReferenceImage` derived from it), `src/store/projects.ts`, `src/studio/ScriptStep.tsx` (hero section), `src/panel/PanelSetup.tsx` (shows "Reference picture ✓" or "Add one in the full studio", no upload in the panel); tests `tests/studio/hero.test.tsx`, `tests/prompts/build.test.ts`.

**Interfaces — Produces:**
```ts
export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export async function setHeroReference(projectId: string, file: Blob): Promise<{ ok: true } | { ok: false; message: string }>;
export async function clearHeroReference(projectId: string): Promise<void>;
export function HeroReference(props: { project: Project; onChange(p: Project): void }): JSX.Element;
```

- [ ] **Step 1: Failing tests:** `uploads a PNG and shows it as the hero reference`; `rejects a 12 MB file and a .gif with a plain message` (copy: `Use a PNG, JPEG or WebP picture under 10 MB.`); `removing the reference keeps the description`; `the prompt asks Flow to match the reference only when one is set` (build.ts); `clearing the reference deletes only hero-reference`.
- [ ] **Step 2–4:** RED → implement (file input with `accept="image/png,image/jpeg,image/webp"`, thumbnail, "Remove") → GREEN.
- [ ] **Step 5:** Commit `feat: hero reference picture`.

### Task 4: Attach the reference in Flow (live exploration first)

**Files:** Modify `src/flow/driver.ts` (`attachReference`), `src/flow/selectors.ts`, `src/flow/messages.ts`, `src/entrypoints/flow.content.ts`, `src/runs/coordinator.ts` (prepare passes the reference); create `docs/superpowers/spikes/s7-flow-ingredient-upload.md`; tests `tests/flow/driver.test.ts` (live markup), `tests/runs/coordinator.test.ts`.

**Interfaces — Produces:** `attachReference(image: Blob): Promise<void>` (exists as a stub) — afterwards the prompt bar shows exactly one ingredient, the reference; `prepare` gains `reference?: { mediaId: string }` and the background sends the blob's bytes to the content script.

- [ ] **Step 1: Live exploration (e2e build, owner's Flow, a throwaway project):** open "Add ingredients" (`[aria-label="Add ingredients to the prompt box"]`), record the picker markup (asset list `listbox "Asset list"`, "Upload media", "Add to prompt"), upload a test PNG through the picker's file input (`DataTransfer` on `input[type=file]`), and answer in the spike note: does the ingredient stay attached after Generate, or must it be re-attached per prompt? Does a re-upload create a duplicate asset each time (prefer picking the already-uploaded asset by name after the first upload)? Save the markup as a test fixture.
- [ ] **Step 2: Failing tests from the recorded markup:** `attaches the reference through the picker`; `doesn't upload twice when it's already in the project's assets`; `throws a FlowBlockedError when the picker isn't found`; coordinator `pauses instead of sending without the reference` (message: `VidFlow couldn't attach the hero reference in Flow. Check the Flow window, then press Resume.`); `scenes without a reference send as before`.
- [ ] **Step 3–4:** RED → implement → GREEN.
- [ ] **Step 5:** Commit `feat: attach the hero reference in Flow`.

### Task 5: Model sheet made in Flow

**Files:** Modify `src/prompts/build.ts` (`buildModelSheetPrompt`), `src/runs/coordinator.ts` + `src/runs/run.ts` (a hero-sheet run), `src/store/projects.ts` (`heroSheet?: { status: SceneStatus; pictureIds: string[]; message?: string }`), `src/studio/HeroReference.tsx`; tests `tests/prompts/build.test.ts`, `tests/runs/hero-sheet.test.ts`, `tests/studio/hero.test.tsx`.

**Interfaces — Produces:**
```ts
export function buildModelSheetPrompt(character: CharacterSpec, style: StylePreset): string; // front, side, back + 3 expressions, plain background, same style rules
export async function startHeroSheetRun(projectId: string): Promise<void>; // one prompt, project.outputsPerPrompt pictures, saved as hero-sheet-option-K
```
- The run reuses the coordinator's Flow window, fresh-project rule, matching and pause rules; it is one pseudo-scene with id `hero-sheet` that never appears in the scene grid.

- [ ] **Step 1: Failing tests:** `the model sheet prompt keeps the style's forbidden words out`; `makes the sheet in a fresh Flow project and saves its pictures`; `model sheet refuses while a run is live` (`BUSY_MESSAGE`); `"Use as hero reference" on a sheet picture sets the reference`; `a refused sheet shows Flow's reason and "Try again"`.
- [ ] **Step 2–4:** RED → implement ("Make a model sheet in Flow" secondary button in the hero section, enabled when the description isn't empty; the sheet's pictures show beside it with "Use as hero reference") → GREEN.
- [ ] **Step 5:** Commit `feat: make a hero model sheet in Flow`.

### Task 6: Spike — Flow's Agent with attached pictures

No shipped code. Record in `docs/superpowers/spikes/s6-flow-agent-judge.md` (append "Attached pictures").

- [ ] **Step 1:** Note Flow's credit total. In a test project with 3 scenes × 2 pictures, for each scene attach the two pictures through the Agent's "Add ingredients" picker (Task 4's markup) and ask: `Text answer only, don't create anything. Image 1 and image 2 are attached in that order. Which better matches: "<image prompt>"? Answer 1 or 2, then one short reason.` Repeat with the order swapped.
- [ ] **Step 2:** Pass = the same picture wins in both orders for at least 5 of 6 scenes, every reason names something really in the picture, and credits didn't drop. Record time per answer and credits before/after.
- [ ] **Step 3:** Commit the note. If it passes, it becomes an "Auto-pick" item for a later plan (owner decides); if not, the swap stays as is.

### Task 7: Live check

- [ ] **Step 1:** e2e build. Upload a hero reference, make a 3-scene run; confirm in Flow each prompt went with the reference attached and the hero looks consistent; screenshots.
- [ ] **Step 2:** Make a model sheet, pick one as the reference, run 2 scenes.
- [ ] **Step 3:** Swap two scenes' pictures in the studio during a run and after; confirm grid, panel and activity agree.
- [ ] **Step 4:** Record in `docs/superpowers/spikes/plan-2-e2e.md`; fix anything found (failing test first). Put the normal build back (`npm run build`, `check:prod-clean`), owner reloads VidFlow. Commit.
