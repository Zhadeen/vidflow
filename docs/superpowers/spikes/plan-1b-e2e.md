# Plan 1b live check (5 Nov 2026)

Run on the owner's Flow Pro (unscripted4ce), e2e build, Chrome with the Plan 1b branch at 6d094e8 plus the e2e status readout.

## Results

| Check | Result |
|---|---|
| Run 1: 3 scenes × 2 pictures, live overlays on | ✅ 3/3 done, 6 pictures, 0 refused/failed. The ring never blocked a press. |
| Pill on the Flow page | ✅ "Scene 3 of 3 · **Pressing Generate**", progress bar, "0 saved · 3 being drawn · 0 to go", coral Pause (`e2e/plan-1b-pill-ring-generate.jpg`). Later "Scene 2 of 3 · **Checking picture 2 of 2 matches its prompt**" (`e2e/plan-1b-pill-checking.jpg`). |
| Coral ring + tag | ✅ Ring round Generate with the "Pressing Generate" tag above it, as the mockup. |
| Side panel opens from the logo on a Flow tab | ✅ Owner click opened it beside Flow (`e2e/plan-1b-panel-setup-done.jpg`): video picker, paste box, "✓ 3 scenes in this video", chips, style, hero, one coral "Review in the full studio" (every scene has pictures). |
| Panel follows a newly started run | ✅ Switched to "Plan 1b panel check": scene strip 1–3, counts, coral Pause + Stop (`e2e/plan-1b-panel-running.jpg`). |
| Panel activity live | ✅ "Paused: …" and "Resumed" rows appeared with times. |
| Run 2: 3 scenes × 2 pictures | ✅ 3/3 done, 6 correct pictures (`e2e/plan-1b-run2-pictures.jpg`). |

## Finding: New project press failed while VidFlow's tab wasn't the shown tab

Run 2 first paused twice with "VidFlow pressed New project but Flow didn't open one". Cause: the tester's own automation tab had been moved into VidFlow's dedicated Flow window, so VidFlow's tab was a background tab there. Flow ignores presses in a tab that isn't shown (no pointer events reached the page; checked with capture listeners). VidFlow then lost track of the window (the saved tab was no longer where it was saved). On Resume, VidFlow opened a fresh window of its own and the run completed normally.

It only happens when someone moves tabs into VidFlow's window. **Now fixed** (Plan 1b final review): right before every press (New project, Generate, opening a tile), the coordinator makes VidFlow's tab the shown tab in its own window (`chrome.tabs.update(tabId, { active: true })`, only when it isn't already, never focusing the window). The studio link in the side panel also never opens or shows the studio inside VidFlow's Flow window.

## Not seen

- "✓ Saved · scene N" badges: the run finished between screenshots; they are removed when the run ends. Covered by unit tests only.
- The panel in its paste-and-start state with a new video (setup with no pictures): covered by unit tests and `docs/design/build-check/side-panel-setup.png`.

## Dev-only change

`src/e2e/background.ts` status now also returns `flowWindow` and `flowTab` (VidFlow's saved Flow window and its tab), which found the cause above. e2e build only; `check:prod-clean` still passes.
