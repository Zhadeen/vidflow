# VidFlow Plan 3 — Motion (clips) and Auto-pick Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional clips in Flow made from each slide's chosen picture, timed exactly to the slide's timecode and kept within a credit limit, plus Auto-pick of the better picture by Flow's Agent.

**Architecture:** Two new coordinator run kinds — `clips` and `auto-pick` — share the existing one-at-a-time run machinery (Flow window, fresh project, pause/resume/stop/skip, notices, live activity, matching + detail verification). Pure timing/cost/stale logic lives in `src/motion/`. The Flow driver gains video settings, start-frame upload/attach, cost and balance reads, and Agent Q&A. UI: Motion section in the panel's Setup + clip ticks in Queue rows + Auto-pick switch in Checks; the studio's Motion step.

**Tech Stack:** WXT 0.20, React 19, TypeScript strict, Vitest + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-05-vidflow-design.md` §20 (with "§20 details settled after the builder check"), §16.4, §17–§19; spikes `s2-flow-video.md`, `s6-flow-agent-judge.md`, `s7-flow-ingredient-upload.md`.

## Global Constraints

- Nothing spends credits unless the owner picks clips and presses **Make clips (N credits)**. Default motion choice: **Stills only**.
- Clip lengths 4/6/8/10 s cost 7/10/12/15 credits; length = shortest ≥ slide length; slide length = end − start, missing → 3 s; > 10 s → 10 s clip.
- Use range `[0, slide length]` (seconds, 3 decimals) stored per clip; timecodes never change.
- Flow video settings: Video · Frames · project aspect · 720p · per-slide length · **x1**. 1:1 videos: no clips (greyed, reason shown).
- Start frame = chosen picture uploaded as `vidflow-s<NN>.png`; Auto-pick pictures as `vidflow-s<NN>-a.png`…`-d`; all uploads excluded from matching.
- Motion prompt = Motion Prompt (or `defaultMotionPrompt`) + "Keep the exact same drawing style and characters as the start frame; simple, gentle motion; no new objects, no text, no camera cuts."
- Credit limit default = estimate; stop before a Generate that would pass the limit or the balance; limit stop **finishes** the run; every pressed Generate counts.
- Auto-pick: switch `vidflow.autoPick` default ON; never overrides `choiceSource: 'owner'`; accept only an answer starting with a valid picture number; 90 s per slide; 3 unanswered in a row → stop; Agent mode off + Agent panel closed afterwards.
- Never guess a match; never force-enable Generate; billing never clicked; one coral primary per screen; design locked (`docs/design/approved/`).
- Commits: `git -c user.name=unscripted4ce -c user.email=unscripted4ce@gmail.com commit`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Leave the normal build in `.output` and pass `npm run check:prod-clean` (Task 7 builds e2e, then restores normal).

## Review Focus

1. **Owner swaps a picture after its clip was made** — the clip shows "picture changed — make again", isn't used, and Make clips offers that slide again (Task 2 test `a clip goes stale when the chosen picture changes`).
2. **Credit limit reached mid-run** — the run finishes, remaining picked slides say "Not made — credit limit", no Generate pressed past the limit (Task 4 test `stops before a clip that would pass the limit`).
3. **Auto-pick meets an owner choice** — never changes it (Task 5 test `never overrides the owner's choice`).
4. **Agent answers something unclear ("Both are good")** — slide stays "not auto-checked", Flow's first kept (Task 5 test `an unclear answer keeps Flow's first`).
5. **A 2.4 s rapid-beat slide** — 4 s clip, use range [0, 2.400], cost 7 (Task 2 test `rapid-beat slide gets a 4 s clip used for its own length`).

---

### Task 1: Spike S8 — clips in Flow (controller, live)

No shipped code. Record `docs/superpowers/spikes/s8-flow-clips.md` + fixtures in `tests/fixtures/flow/`.

- [ ] **Step 1:** In a throwaway Flow project (owner's account, e2e build), switch to Video · Frames; record the Start-slot markup and its "Select a frame image" picker incl. Upload media (reuse S7 approach), the attached-start-frame markup, the settings popover's cost text ("Generating will use N credits"), and the Account details panel's credits text and how to open/close it.
- [ ] **Step 2:** Make one 4 s clip (7 credits — owner approved clips in Plan 3; one test clip). Record the video tile (`flow-video-tile`) and detail-page markup (prompt, media id, video URL).
- [ ] **Step 3:** From the extension, fetch the clip's bytes (as pictures are fetched) and read its duration via a `<video>` element's metadata; record type, size, duration. If fetching fails, find and record the working path.
- [ ] **Step 4:** Save HTML fixtures (start slot, picker, cost popover, account panel, video tile, video detail). Commit `docs: spike S8 — clips in Flow`.

### Task 2: Timing, cost, choice source and stale clips (pure + store)

**Files:** Create `src/motion/timing.ts`, `src/motion/clips.ts`; modify `src/store/projects.ts`, `src/runs/run.ts` (swap sets `choiceSource: 'owner'`), `src/studio/chosen.ts`; tests `tests/motion/*.test.ts`, `tests/studio/choice.test.ts`.

**Interfaces — Produces:**
```ts
export type ClipLength = 4 | 6 | 8 | 10;
export function slideSeconds(scene: Scene): number;            // end-start, missing → 3
export function clipLengthFor(seconds: number): ClipLength;
export const CLIP_COST: Record<ClipLength, number>;            // {4:7,6:10,8:12,10:15}
export interface ClipRecord { mediaId: string; sourcePictureId: string; length: number /* measured s */; use: [number, number] }
export type MotionMode = 'stills' | 'picked' | 'all';
// Project gains: motionMode?: MotionMode (default 'stills'); clipPicks?: string[] (scene ids)
// SceneState gains: choiceSource?: 'owner' | 'auto'; autoReason?: string; autoChecked?: boolean; clip?: ClipRecord; clipNote?: string
export function clipIsCurrent(state: SceneState | undefined): boolean; // clip.sourcePictureId === chosenPicture(state)
export function scenesToClip(project: Project, states: Record<string, SceneState>): string[]; // by mode, has a chosen picture, no current clip, aspect ≠ 1:1
export function estimate(project: Project, states: Record<string, SceneState>): { clips: number; credits: number };
```
- [ ] **Step 1: Failing tests:** `rapid-beat slide gets a 4 s clip used for its own length` (2.4 s → 4, [0, 2.4], 7); `5 s → 6, 9 s → 10, 14 s → 10 with use [0, 10]`; `missing timecode counts 3 s`; `a clip goes stale when the chosen picture changes`; `scenesToClip by mode stills/picked/all, skipping 1:1 and slides without pictures`; `estimate sums each clip's cost`; `swap marks choiceSource owner`; `choices saved before Plan 3 count as owner`.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5:** full suite, tsc, build, check:prod-clean. Commit `feat: clip timing, cost and choice source`.

### Task 3: Flow driver for clips and Agent Q&A

**Files:** Modify `src/flow/driver.ts`, `src/flow/selectors.ts`, `src/flow/messages.ts`, `src/flow/port.ts`, `src/entrypoints/flow.content.ts`; tests `tests/flow/driver.test.ts`, `tests/flow/port.test.ts` (fixtures from Task 1).

**Interfaces — Produces (driver):**
```ts
setVideoMode(): Promise<void>; setFramesMode(): Promise<void>; setClipLength(s: ClipLength): Promise<void>; setResolution720(): Promise<void>;
uploadStartFrame(file: File): Promise<void>; attachStartFrame(name: string): Promise<void>; // Start slot; End stays empty
readGenerateCost(): Promise<number | null>; readCreditBalance(): Promise<{ credits: number; resets: string | null } | null>; // opens + closes Account details
askAgent(names: string[], question: string, timeoutMs: number): Promise<string | null>; // Agent mode on, attach in order, send, read reply, close panel, Agent off
videoResultCards(): FlowResultCard[]; readVideoDetail(): { prompt: string | null; mediaId: string | null; videoUrl: string | null };
```
- [ ] **Step 1: Failing tests** from the S8 fixtures: each setter clicks the right radio; start frame upload never opens the file window and attaches by name; cost and balance parsing ("1,043 Google Flow credits · Resets on 13 Nov at 13:50"); askAgent attaches in order, returns the reply text, and always turns Agent mode off (also on timeout); billing dialog → blocked, never clicked; video tiles/detail read.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5:** Commit `feat: Flow driver for clips and Agent questions`.

### Task 4: Motion run (`kind: 'clips'`)

**Files:** Modify `src/runs/run.ts`, `src/runs/coordinator.ts`, `src/entrypoints/background.ts`, `src/studio/runClient.ts`; tests `tests/runs/clips.test.ts`.

**Interfaces — Produces:** `startClipRun(projectId: string, limit: number): Promise<void>` (RunClient `makeClips(projectId, limit)`, sender-checked); run state gains `kind: 'clips'`, `spent: number`, `limit: number`.

- [ ] **Step 1: Failing tests:** `makes a clip per picked slide in a fresh Flow project with Video · Frames · aspect · 720p · length · x1`; `uploads the chosen picture as vidflow-sNN.png and attaches it to Start`; `motion prompt = slide motion prompt + the fixed line`; `stops before a clip that would pass the limit` (run finishes, rows "Not made — credit limit"); `stops before passing the balance`; `every pressed Generate counts, even refused`; `saves scene-NN-clip.mp4 with measured length and use range`; `matching uses order + media id + detail prompt, uploads excluded`; `pause/resume/stop/skip work`; `refuses while another run is live`; `1:1 video refused with the plain reason`.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5:** Commit `feat: Motion run makes clips`.

### Task 5: Auto-pick run (`kind: 'auto-pick'`)

**Files:** Create `src/runs/autopick.ts`; modify `src/runs/run.ts`, `src/runs/coordinator.ts`, `src/settings.ts` (`getAutoPick`/`setAutoPick`, default true), `src/entrypoints/background.ts`, `src/studio/runClient.ts`; tests `tests/runs/autopick.test.ts`.

**Interfaces — Produces:**
```ts
export function parseAgentAnswer(text: string, count: number): { pick: number; reason: string } | null; // leading digit 1..count
export async function startAutoPick(projectId: string): Promise<void>; // RunClient.autoPick(projectId)
export const AUTO_PICK_QUESTION: (prompt: string, count: number) => string; // S6 wording, "1 or 2" / "1 to N"
```
- [ ] **Step 1: Failing tests:** `parseAgentAnswer accepts "2 — shows the shoulder bag" and rejects "Both are good" / "3" when count is 2`; `runs after a whole-video picture run when the switch is on, not after ▶ Run / Retry / model sheet`; `never overrides the owner's choice`; `an unclear answer keeps Flow's first`; `sets choiceSource auto and the reason`; `90 s without an answer → not auto-checked, next slide`; `three unanswered in a row stops the pass`; `Agent mode is off afterwards, even when stopped`; `comparison uploads never matched as pictures or clips`; `0 credits: never presses Generate`.
- [ ] **Step 2–4:** RED → implement → GREEN. **Step 5:** Commit `feat: Auto-pick with Flow's Agent`.

### Task 6: Motion and Auto-pick in the panel and studio

**Files:** Modify `src/panel/PanelSetup.tsx`, `src/panel/PanelQueue.tsx`, `src/panel/PanelChecks.tsx`, `src/studio/ProjectScreen.tsx`, `src/studio/PicturesStep.tsx`; create `src/studio/MotionStep.tsx`, `src/panel/MotionSection.tsx`; tests `tests/panel/motion.test.tsx`, `tests/studio/motion.test.tsx`.

- [ ] **Step 1: Failing tests:** Setup Motion section: `Stills only / Clips for the slides I pick / Clips for every slide`, `shows clips · credits needed · credits left · limit (defaults to estimate)`, `coral "Make clips (N credits)" only when clips are chosen and something is left to make`, `1:1 greys the clip choices with the reason`; Queue rows: `Clip tick per slide in "picked" mode, pick all / pick none`, `🎬 clip ✓ / picture changed — make again / Not made — credit limit`, `Auto-picked: <reason> / not auto-checked marks`; Checks: `Auto-pick the better picture switch (on)`, `Auto-pick now`; studio Motion step (enabled, replaces "coming next"): same choice, grid with ticks and marks, estimate, Make clips; Pictures step shows the auto-pick reason under the chosen card; exactly one coral primary per screen.
- [ ] **Step 2–4:** RED → implement per the locked look → GREEN. Reshoot build-check shots (panel Setup motion, Queue with clips, studio Motion). **Step 5:** Commit `feat: Motion and Auto-pick in the panel and studio`.

### Task 7: Live check

- [ ] **Step 1:** e2e build; reload via the bridge.
- [ ] **Step 2:** A 3-slide rapid-beat video (16:9) with a hero: pictures → Auto-pick runs → each slide shows "Auto-picked: …" or "not auto-checked"; Agent mode off after.
- [ ] **Step 3:** Clips for 2 picked slides with limit = estimate (14 credits): 2 clips made, balance down by 14, each clip's measured length ≈ 4 s, use range = slide length; swap a picture → clip shows "picture changed".
- [ ] **Step 4:** Record `docs/superpowers/spikes/plan-3-e2e.md` with screenshots; fix anything found (failing test first). Normal build back; commit.
