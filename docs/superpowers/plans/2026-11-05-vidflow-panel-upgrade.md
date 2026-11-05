# VidFlow Panel Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the side panel into VidFlow's full control centre — Setup · Queue · Checks · Files tabs with a health line — so the owner can run a whole video from the panel and see at a glance that it is an upgrade of Flow Flash.

**Architecture:** New background pieces (checks, notice auto-accept, skip, downloads) are plain functions in `src/runs/` and `src/files/` reached through the existing sender-checked run messages; the content script gains read-only "checks" and "accept notice" answers. The panel becomes a tab shell (`src/panel/Panel.tsx`) with one component per tab, reusing the studio's hooks (`useScriptDraft`, `HeroReference`, `ActivityList`, `chosenPicture`, swap).

**Tech Stack:** WXT 0.20, React 19, TypeScript strict, Vitest + jsdom + Testing Library; new dependency `pdfjs-dist` (PDF text only).

**Spec:** `docs/superpowers/specs/2026-11-05-vidflow-design.md` §19 (with "§19 details settled after the builder check") and §17/§18; mockup `docs/design/approved/side-panel-v2.html`.

## Global Constraints

- Design is locked: match `side-panel-v2.html` — navy `#14213D`, cream `#F4EDE0`, coral `#FF6B5B` with navy text, navy shades only, **one coral primary per tab**, radii 8/12/16/999px, reuse `src/panel/panel.css` / studio tokens.
- Only VidFlow's own pages may send run/file messages (`isOwnPage`); content-script answers only on VidFlow's own Flow tab.
- No new hosts. No new permissions (`downloads`, `power` already present).
- Auto-accept touches only Flow's usage-policy / rights / upload notices (narrow allowlist); billing, payment, upgrade or paid-tier dialogs **stop** with a plain message; unknown dialogs pause. Never force-enable Generate.
- Pictures cost 0 credits; time estimate = 20 s per scene, rounded ("~9 min").
- Downloads only under the Downloads folder; `conflictAction: 'uniquify'`; never overwrite.
- Global settings (settings.ts): `vidflow.acceptNotices` (default true), `vidflow.keepAwake` (default true), `vidflow.autoSave` (default false), `vidflow.namingFormat` (default `'slide-time'`). Per video (project): `downloadFolder?: string` (default = video name).
- Plan 1 rules stay: "Use these scenes" explicit apply + replace-confirm; Flow matching never guesses.
- Commits: `git -c user.name=unscripted4ce -c user.email=unscripted4ce@gmail.com commit`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Leave the normal build in `.output` and pass `npm run check:prod-clean` (Task 6 builds e2e for the live check, then restores normal).

## Review Focus

1. **Flow not open when the panel opens** — Checks show "Not checked yet" + Open Flow; Start opens VidFlow's Flow window, runs the checks, and only then starts (Task 2 test `start runs the checks first and stops on a failing one`).
2. **A billing/upgrade dialog while "Accept notices" is on** — VidFlow stops with the plain billing message and never clicks it (Task 1 test `never accepts a billing or upgrade dialog`).
3. **Download all pressed twice / auto-save then Download all** — no duplicate files; an existing name gets a number (Task 5 test `skips files already downloaded for this video` and `uniquifies, never overwrites`).
4. **Skip on a scene already sent to Flow** — its late pictures are never saved to another scene (Task 4 test `pictures arriving for a skipped scene are never saved`).
5. **A 200-scene video in the Queue tab** — renders and filters without hanging (Task 4 test `renders 200 rows and filters them`).

---

### Task 1: Settings, notice auto-accept, keep-awake switch

**Files:** Modify `src/settings.ts`, `src/flow/selectors.ts`, `src/flow/driver.ts`, `src/flow/messages.ts`, `src/entrypoints/flow.content.ts`, `src/runs/coordinator.ts`; tests `tests/settings.test.ts`, `tests/flow/driver.test.ts`, `tests/runs/coordinator.test.ts`.

**Interfaces — Produces:**
```ts
// settings.ts
export type NamingFormat = 'slide-time' | 'slide-timecode' | 'slide-seconds' | 'time-slide' | 'slide';
export async function getAcceptNotices(): Promise<boolean>; export async function setAcceptNotices(on: boolean): Promise<void>;
export async function getKeepAwake(): Promise<boolean>;     export async function setKeepAwake(on: boolean): Promise<void>;
export async function getAutoSave(): Promise<boolean>;      export async function setAutoSave(on: boolean): Promise<void>;
export async function getNamingFormat(): Promise<NamingFormat>; export async function setNamingFormat(f: NamingFormat): Promise<void>;
// selectors.ts: split POLICY_DIALOG_PATTERN into
export const USAGE_NOTICE_PATTERN: RegExp; // usage policy / use policy / necessary rights / prohibited use
export const BILLING_PATTERN: RegExp;      // paid tier / billing / payment / upgrade / subscribe
// driver: FlowReading gains noticeDialog: boolean, billingDialog: boolean (policyDialog removed)
acceptNotice(): Promise<boolean>; // ticks unchecked checkboxes in the notice dialog, clicks its accept button (text /i understand|agree|accept|continue|confirm/); false if not found
```
- Content-script message `FLOW_ACCEPT_NOTICE` → `{ accepted: boolean }`.

- [ ] **Step 1: Failing tests:** settings defaults and round-trips (`acceptNotices` true, `keepAwake` true, `autoSave` false, `namingFormat` 'slide-time'); driver `reads a usage notice and a billing dialog apart`; `acceptNotice ticks the box and clicks I agree`; coordinator `accepts a usage notice and carries on when the switch is on` (activity "Accepted Flow's notice"); `pauses on a usage notice when the switch is off` (existing message); `never accepts a billing or upgrade dialog` (stops with the existing billing message, `acceptNotice` not called); `keep-awake follows the switch`.
- [ ] **Step 2–4:** RED → implement → GREEN. Fixtures: build the notice and billing dialogs from Flow's real wording where known ("necessary rights", "Prohibited Use Policy", "I understand"/"I agree"); unknown dialog text → pause as today.
- [ ] **Step 5:** Full suite, tsc, build, check:prod-clean. Commit `feat: accept Flow's notices automatically (switch)`.

### Task 2: Checks

**Files:** Create `src/runs/checks.ts`; modify `src/flow/messages.ts`, `src/flow/driver.ts`, `src/entrypoints/flow.content.ts`, `src/entrypoints/background.ts` (messages), `src/runs/coordinator.ts` (Start runs checks first), `src/studio/runClient.ts`; tests `tests/runs/checks.test.ts`, `tests/flow/driver.test.ts`, `tests/background/studioMessages.test.ts`.

**Interfaces — Produces:**
```ts
export type CheckId = 'account' | 'page' | 'promptBox' | 'generate' | 'agentOff' | 'settings' | 'hero' | 'credits';
export interface CheckRow { id: CheckId; label: string; ok: boolean | null /* null = not checked */; detail: string; fix?: string }
export async function runChecks(projectId: string): Promise<{ flowOpen: boolean; rows: CheckRow[] }>;
export async function openFlow(): Promise<void>;                      // VidFlow's Flow window, no project made
export async function showMeInFlow(): Promise<{ missing: string[] }>; // rings prompt box, Generate, ingredient slot ~4 s (§17 ring)
export async function testOnePrompt(projectId: string): Promise<{ ok: boolean; message: string }>; // settings + type + Generate ready + clear; refused while a run is live
export function healthLine(rows: CheckRow[], flowOpen: boolean): string[]; // e.g. ['✓ Signed in','✓ Flow ready','✓ Hero attached'] or plain warnings / 'Flow not open'
```
- Content-script message `FLOW_CHECKS` → `{ account: string|null; page: boolean; promptBox: boolean; generate: boolean; agentOff: boolean; model: string|null; aspect: string|null; outputs: number|null; credits: number|null }` (read-only; credits only if visible without opening menus).
- RunClient gains `checks(projectId)`, `openFlow()`, `showMe()`, `testPrompt(projectId)`; messages added to STUDIO_TYPES.

- [ ] **Step 1: Failing tests:** `no Flow tab: every row is "Not checked yet" and flowOpen is false`; `all good gives eight ticks`; `wrong account / Agent on / settings differ each give a plain fix`; `hero row only when the video has a reference`; `start runs the checks first and stops on a failing one` (Start with Agent mode on → run not started, message names the problem); `test one prompt is refused while a run is live`; `show me in Flow names what it couldn't find`; sender check for the new messages.
- [ ] **Step 2–4:** RED → implement → GREEN.
- [ ] **Step 5:** Commit `feat: checks before starting`.

### Task 3: Panel shell and Setup tab

**Files:** Modify `src/panel/Panel.tsx`, `src/panel/PanelSetup.tsx`, `src/panel/panel.css`; create `src/panel/Tabs.tsx`, `src/panel/HealthLine.tsx`, `src/scenes/fileText.ts`; add `pdfjs-dist`; tests `tests/panel/shell.test.tsx`, `tests/panel/setup.test.tsx`, `tests/scenes/fileText.test.ts`.

**Interfaces — Consumes:** `runChecks`/`healthLine` (Task 2), `buildClaudePrompt`, `buildRapidBeatPrompt` (src/prompts/claude.ts), `useScriptDraft`, `HeroReference`, `startHeroSheetRun` via RunClient.
**Produces:** `export async function fileToText(file: File): Promise<{ ok: true; text: string } | { ok: false; message: string }>` (CSV/TSV/TXT read as text; PDF via pdfjs-dist, worker bundled, ≤ 20 MB; no text → `This PDF has no text VidFlow can read. Paste the scenes instead.`; other types → `Use a CSV, TSV, TXT or PDF file.`).

- [ ] **Step 1: Failing tests:** shell `opens on Setup when no run is live and on Queue when one is`; `the health line shows on every tab`; `Queue tab label shows the scene count`; `exactly one coral primary on each tab`; setup `copies the Claude prompt and the rapid-beat prompt with the video's script` / `asks to add the script in the full studio when there is none`; `an uploaded CSV fills the paste box and still needs Use these scenes`; `a scanned PDF shows the plain message`; `hero shows "Reference picture ✓ · attached to every scene" or "No reference picture" with Upload` (fixes the orphan "Add one in the full studio" line); `Make model sheet starts the model-sheet run`; `summary reads "48 pictures · 0 Flow credits · ~8 min"` for 24 scenes × 2 (20 s per scene).
- [ ] **Step 2–4:** RED → implement per the mockup's Setup column → GREEN.
- [ ] **Step 5:** Refresh `docs/design/build-check/side-panel-setup.png` (visual harness). Commit `feat: panel tabs and Setup`.

### Task 4: Queue tab, ▶ Run, Retry failed, Skip

**Files:** Create `src/panel/PanelQueue.tsx`; modify `src/runs/run.ts` (event `skip`), `src/runs/coordinator.ts` (`skipCurrent`), `src/studio/runClient.ts`, `src/entrypoints/background.ts`, `src/panel/PanelRun.tsx` (folded into the Queue tab or removed); tests `tests/panel/queue.test.tsx`, `tests/runs/coordinator.test.ts`, `tests/runs/run.test.ts`.

**Interfaces — Produces:**
```ts
// run.ts: RunEvent gains { type: 'skip'; sceneId: string } → scene status 'failed', message SKIPPED_MESSAGE, prompt kept in RunState.skippedPrompts (never matched)
export const SKIPPED_MESSAGE = 'Skipped by you';
export async function skipCurrent(): Promise<void>; // coordinator: the scene currently being worked on
export function sceneMarks(state: SceneState | undefined, project: Project): { checked: boolean; hero: boolean; options: number };
```
- RunClient gains `skip()`; ▶ Run uses `retry(projectId, sceneId)`; Retry failed retries every failed/refused scene through the same path.

- [ ] **Step 1: Failing tests:** `shows step, progress and "8 saved · 2 being drawn · 14 to go · 0 failed"`; `filters All / Drawing / To go / Failed / Done with counts`; `each row shows thumbnail, number, sentence, timecode and only the true marks "✓ checked · hero ✓ · 2 options"`; `status tags: ✓ Saved, Checking, Drawing, Failed with reason, Refused with Flow's reason`; `▶ Run makes just that scene and is disabled while a run is live (says why)`; `Retry failed appears only when something failed`; `clicking a done row shows its options with the one-click swap`; `Pause/Resume, Stop, Skip call the client`; `pictures arriving for a skipped scene are never saved`; `renders 200 rows and filters them`.
- [ ] **Step 2–4:** RED → implement per the mockup's Queue column → GREEN.
- [ ] **Step 5:** Refresh `docs/design/build-check/side-panel-running.png`. Commit `feat: panel Queue with Run, Retry and Skip`.

### Task 5: Files tab and downloads

**Files:** Create `src/files/names.ts`, `src/files/downloads.ts`, `src/files/exports.ts`, `src/panel/PanelFiles.tsx`; modify `src/store/projects.ts` (`downloadFolder?`, `downloaded?: Record<string, string>` media id → file name), `src/runs/coordinator.ts` (auto-save after a scene is saved), `src/entrypoints/background.ts`, `src/studio/runClient.ts`; tests `tests/files/*.test.ts`, `tests/panel/files.test.tsx`.

**Interfaces — Produces:**
```ts
export function fileName(scene: Scene, format: NamingFormat, option: 'chosen' | 'other', ext: 'png' | 'jpg'): string;
// slide-time 'Slide_01_00m00s-00m03s', slide-timecode 'Slide_01_00-00_to_00-03', slide-seconds 'Slide_01_00s-03s',
// time-slide '00m00s-00m03s_Slide_01', slide 'Slide_01'; no timecode → 'Slide_01'; other option → '<name>_option2'
export async function downloadAll(projectId: string, opts: { both: boolean; again?: boolean }): Promise<{ saved: number; skipped: number }>;
export async function autoSaveScene(projectId: string, sceneId: string): Promise<void>; // only when getAutoSave()
export function slideListCsv(project: Project): string;   // Slide,Timecode,Sentence,Status,File
export function timingJson(project: Project): string;     // [{ slide, start, end, sentence, file }]
```
- Downloads via `chrome.downloads.download({ url: objectURL, filename: '<folder>/<name>', conflictAction: 'uniquify', saveAs: false })`; folder default = project name made filename-safe.

- [ ] **Step 1: Failing tests:** every naming format with the spec's examples; `no timecode → Slide_01`; `other option gets _option2`; `uniquifies, never overwrites` (conflictAction asserted); `skips files already downloaded for this video` (and `again` downloads them again); `chosen only vs both options`; `auto-save runs after a scene is saved only when the switch is on`; CSV and timing JSON contents; panel `shows count, grid, folder, naming, the switch, exports, "Coming next: Clips · Voice · Finished video" and coral "Download all 24 pictures"`.
- [ ] **Step 2–4:** RED → implement per the mockup's Files column → GREEN.
- [ ] **Step 5:** Commit `feat: panel Files and downloads`.

### Task 6: Live check

- [ ] **Step 1:** e2e build; owner reloads VidFlow once if the bridge doesn't answer.
- [ ] **Step 2:** With Flow closed, open the panel: Checks show "Not checked yet"; Open Flow; Check again → ticks. Show me in Flow; Test one prompt (no picture made).
- [ ] **Step 3:** Start a 3-scene video from the panel (paste or upload CSV): Queue rows fill with marks; Skip one scene mid-run; ▶ Run it afterwards; swap a picture from its row.
- [ ] **Step 4:** Files: Download all (chosen only), then again (skipped), then both options; check names in Downloads/<video>; export CSV and timing file.
- [ ] **Step 5:** Record `docs/superpowers/spikes/panel-upgrade-e2e.md` with screenshots of all four tabs; fix anything found (failing test first). Normal build back (`npm run build`, `check:prod-clean`); commit.
