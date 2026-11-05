# VidFlow Plan 1b — Live Activity and the Side Panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner see what VidFlow is doing while it works — a live step on the pill, a coral ring on what VidFlow touches, "✓ Saved" badges, an Activity list — and drive VidFlow from a side panel beside Flow.

**Architecture:** The background coordinator writes two things to `chrome.storage.local`: the current step (`vidflow.step`) and a capped activity log (`vidflow.activity`). The Flow content script draws the pill, ring and badges from the step and saved scene states (look-only, `pointer-events: none`). A new WXT `sidepanel` entrypoint renders a compact React panel that reuses the studio's project/run logic; the toolbar icon opens the side panel on a Flow tab and the studio tab elsewhere.

**Tech Stack:** As Plan 1 (WXT 0.20, React 19, TS strict, Vitest + jsdom + Testing Library). Chrome `sidePanel` API.

**Spec:** `docs/superpowers/specs/2026-11-05-vidflow-design.md` — §17 (live activity) and §18 (side panel). Approved mockups: `docs/design/approved/live-activity.html`, `docs/design/approved/side-panel.html`. Plan 1's code and rulings: `docs/superpowers/plans/2026-11-05-vidflow-plan-1-spikes-and-pictures.md`, `docs/superpowers/plans/2026-11-05-plan-1-rulings.md`.

## Global Constraints

- Design is locked (`docs/design/approved/README.md`); the panel and overlays follow the approved mockups exactly. Navy `#14213D`, cream `#F4EDE0`, coral `#FF6B5B` (navy text on coral), navy shades only; one coral primary at a time.
- Overlays on the Flow page are look-only: `pointer-events: none`, never intercept clicks (VidFlow's debugger presses hit-test through them), drawn in a shadow root like the existing pill.
- "Show live activity in Flow" switch, on by default, hides the ring, tags and badges; the pill always shows while a run is live.
- Activity copy is plain words, as in the mockup: e.g. `Opened a new Flow project`, `Set Flow to Image · 16:9 · 2 pictures`, `Typing the prompt`, `Pressing Generate`, `Sent to Flow`, `Checking picture 1 of 2 matches its prompt`, `✓ Saved 2 pictures`, plus scene prefix `Scene N · `.
- Only new manifest change: permission `sidePanel` and `side_panel.default_path`. No new hosts.
- New-scene application keeps Plan 1's explicit "Use these scenes" rule in the panel too.
- Plan 1's e2e bridge stays dev-only; `npm run check:prod-clean` must pass.

## Review Focus

1. **The ring sits over Flow's Generate button while VidFlow presses it** — the press still lands (Task 2 test `ring never intercepts pointer events`).
2. **A 200-scene run** — the activity log stays capped and the panel stays fast (Task 1 test `keeps only the newest 300 entries`).
3. **Panel and studio open at the same time** — both show the same state after Start/Pause in either (Task 4 test `panel and studio show the same run after a pause from the studio`).
4. **Toolbar icon clicked on a non-Flow tab** — opens the studio tab as today, not an empty panel (Task 4 test `opens the studio tab when the active tab isn't Flow`).
5. **Live activity switched off mid-run** — ring, tags and badges disappear at once; the pill stays (Task 2 test `switching live activity off removes ring and badges but keeps the pill`).

---

### Task 1: Step and activity log (background)

**Files:** Create `src/runs/activity.ts`; modify `src/runs/coordinator.ts` (emit at existing points); test `tests/runs/activity.test.ts`, extend `tests/runs/coordinator.test.ts`.

**Interfaces — Produces:**
```ts
export type StepTarget = 'project' | 'setting' | 'prompt' | 'generate' | 'tile' | null;
export interface Step { projectId: string; sceneId: string | null; text: string; target: StepTarget; key?: string; at: number }
export interface ActivityEntry { at: number; projectId: string; sceneId: string | null; text: string }
export const STEP_KEY = 'vidflow.step';
export const ACTIVITY_KEY = 'vidflow.activity';
export const ACTIVITY_MAX = 300;
export function stepLine(sceneNumber: number | null, text: string): string;   // "Scene 3 · Pressing Generate" | text
export async function setStep(step: Step | null): Promise<void>;              // writes STEP_KEY
export async function logActivity(entry: ActivityEntry): Promise<void>;      // appends, keeps newest ACTIVITY_MAX, serialized
export async function readActivity(projectId: string, limit?: number): Promise<ActivityEntry[]>; // newest first
```
- [ ] **Step 1: Failing tests** (`activity.test.ts`, fake `chrome.storage.local`): `stepLine formats with and without a scene`; `keeps only the newest 300 entries`; `readActivity returns newest first for one project only`; `concurrent logActivity calls lose nothing` (20 parallel calls → 20 entries).
- [ ] **Step 2–4:** RED → implement (a promise chain serializes writes) → GREEN.
- [ ] **Step 5: Coordinator emits** step + activity at: new project opened (`project`), settings set (`setting`, "Set Flow to Image · 16:9 · 2 pictures"), typing (`prompt`), pressing (`generate`), sent ("Sent to Flow"), checking (`tile`, key = card key, "Checking picture k of n matches its prompt"), saved ("✓ Saved N pictures"), failed/refused (scene message), paused/resumed/finished (run copy). `setStep(null)` when the run isn't running. Coordinator tests: `logs the run's activity in order` (a scripted 1-scene run with mocked port → the 7 expected texts in order); `clears the step when paused`.
- [ ] **Step 6:** Full suite, typecheck; commit `feat: live step and activity log`.

### Task 2: Flow-page live activity (content script)

**Files:** Modify `src/flow/pill.ts` (step line, progress, counts); create `src/flow/highlight.ts`, `src/flow/badges.ts`; modify `src/settings.ts`, `src/entrypoints/flow.content.ts`; tests `tests/flow/pill.test.ts`, `tests/flow/highlight.test.ts`, `tests/flow/badges.test.ts`.

**Interfaces:**
- Consumes `Step`, `STEP_KEY` (Task 1); `RunState`, `SceneState`.
- Produces:
```ts
// settings.ts
export const LIVE_ACTIVITY_KEY = 'vidflow.liveActivity';
export async function getLiveActivity(): Promise<boolean>;       // default true
export async function setLiveActivity(on: boolean): Promise<void>;
// pill.ts — PillView gains:
export interface PillView { n: number; total: number; paused: boolean; step: string | null; saved: number; drawing: number; toGo: number }
// highlight.ts
export const TAG: Record<Exclude<StepTarget, null>, string>; // project 'Opening a new project', setting 'Setting this', prompt 'Typing here', generate 'Pressing Generate', tile 'Checking it matches scene N…' (N filled in)
export function renderHighlight(doc: Document, target: Element | null, tag: string | null): void; // ring + tag, fades on change, null removes
// badges.ts
export function renderSavedBadges(doc: Document, saved: Map<string, number>): void; // card key → scene number; "✓ Saved · scene N"
```
- [ ] **Step 1: Failing tests:** `pill shows the step, progress and saved/drawing/to-go counts` (mockup copy); `ring never intercepts pointer events` (computed host + ring `pointer-events: none`; `document.elementFromPoint` at the Generate centre returns the Generate button); `ring follows the target and fades` (target change → previous ring removed); `badges label saved tiles with their scene`; `switching live activity off removes ring and badges but keeps the pill`.
- [ ] **Step 2–4:** RED → implement in shadow roots, colours from Global Constraints; target lookup by `Step.target` using existing `SEL` (promptBox, settingsTrigger, generate; tile via `img[data-media-id="<key>"]` → its `flow-grid-tile-container`) → GREEN.
- [ ] **Step 5:** Content script listens to `chrome.storage.onChanged` for `STEP_KEY`, `LIVE_ACTIVITY_KEY` and the run, only on VidFlow's own Flow tab (existing `active` flag). Commit `feat: live activity on the Flow page`.

### Task 3: Studio Activity list and switch

**Files:** Create `src/studio/ActivityList.tsx`; modify `src/studio/PicturesStep.tsx` (under the scene grid, per mockup); test `tests/studio/activity.test.tsx`.

**Interfaces — Produces:** `export function ActivityList(props: { projectId: string; limit?: number }): JSX.Element;` (reads `readActivity`, live-updates on `ACTIVITY_KEY` change; includes the "Show live activity in Flow" switch bound to `get/setLiveActivity`).
- [ ] **Step 1: Failing tests:** `shows entries newest first with time and scene`; `updates when a new entry arrives`; `the switch turns live activity off and on`; `empty state reads "Nothing yet — press Start to begin."`.
- [ ] **Step 2–4:** RED → implement (switch: coral track when on, navy knob, accessible `role="switch"` with `aria-checked`) → GREEN.
- [ ] **Step 5:** Refresh `docs/design/build-check/` screenshots for the Pictures step (running). Commit `feat: studio activity list`.

### Task 4: Side panel beside Flow

**Files:** Create `src/entrypoints/sidepanel/index.html`, `src/entrypoints/sidepanel/main.tsx`, `src/panel/Panel.tsx`, `src/panel/PanelSetup.tsx`, `src/panel/PanelRun.tsx`, `src/studio/useScriptDraft.ts` (shared paste/parse/"Use these scenes" logic extracted from `ScriptStep.tsx`); modify `wxt.config.ts` (permission `sidePanel`), `src/entrypoints/background.ts` (toolbar behaviour), `tests/manifest.test.ts`; tests `tests/panel/*.test.tsx`, `tests/background/action.test.ts`.

**Interfaces:**
- Consumes: `RunClient` (`src/studio/runClient.ts`), `progress.ts` helpers, project store, `ActivityList` (Task 3), `buildClaudePrompt` not needed here.
- Produces:
```ts
export function useScriptDraft(project: Project, onApply: (scenes: Scene[]) => void): {
  text: string; setText(t: string): void; preview: ParseResult | null; needsConfirm: boolean; apply(): void; confirm(): void; cancel(): void;
}
export async function openForTab(tab: { id?: number; windowId?: number; url?: string }): Promise<'panel' | 'studio'>; // background
```
- [ ] **Step 1: Failing tests:**
  - `opens the side panel on a Flow tab` (mock `chrome.sidePanel.open({ windowId })`) and `opens the studio tab when the active tab isn't Flow`.
  - Panel setup: `pick or create a video`; `paste shows "✓ 6 scenes found" and applies only on Use these scenes`; `aspect, per-scene, style and hero choices save to the project`; `summary reads "12 pictures · 0 Flow credits"`; `exactly one coral primary` in each state.
  - Panel running: `shows step, progress, counts and the scene strip (saved ✓ cream, current coral outline, upcoming navy)`; `Pause/Resume and Stop call the run client`; `panel and studio show the same run after a pause from the studio` (shared `run/state` broadcast).
  - ScriptStep still passes its existing tests after the `useScriptDraft` extraction.
- [ ] **Step 2–4:** RED → implement per `docs/design/approved/side-panel.html` (320px-wide layout, navy with coral glow) → GREEN.
- [ ] **Step 5:** Manifest: add `sidePanel`, `side_panel: { default_path: 'sidepanel.html' }`; update manifest test. Run full suite, typecheck, `npm run build` + `check:prod-clean`, `npm run build:e2e`. Commit `feat: VidFlow side panel beside Flow`.

### Task 5: Live check on Flow

- [ ] **Step 1:** Load the e2e build (owner reload or e2e `reload`), start a 3-scene run from a Flow tab.
- [ ] **Step 2:** Screenshot VidFlow's Flow window during the run: pill step text, coral ring on Generate / a checked tile, "✓ Saved" badges. Confirm pictures still save correctly (ring didn't block presses).
- [ ] **Step 3:** Owner clicks the VidFlow logo on the Flow tab → side panel opens; screenshot it in setup and running states; compare with the approved mockups.
- [ ] **Step 4:** Record in `docs/superpowers/spikes/plan-1b-e2e.md` with screenshots; fix anything found (failing test first). Commit.
- [ ] **Step 5:** Put the normal build back: `npm run build`; owner reloads VidFlow.
