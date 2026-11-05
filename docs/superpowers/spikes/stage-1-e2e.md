# Stage 1 — end-to-end on the real Flow (5 Nov 2026)

Account: unscripted4ce@gmail.com (Google AI Pro). VidFlow loaded unpacked (owner), e2e build (`npm run build:e2e`) driven from a Flow tab via the dev-only postMessage bridge (`docs/testing-e2e.md`). Pictures cost 0 credits.

## Runs

| Run | Result | What it found / fix |
|---|---|---|
| Test run 1 | FAIL | Paused: "can't find Flow's New project button". Live button text is `addNew project` (icon ligature glued on) and it sits below the fold → match `new\s*project`, scroll into view (`6c5de6c`). |
| Diag 1–2 | FAIL | "couldn't send": underlying error "Flow's settings didn't open to set Image." Live radios read `imageImage`, `crop_16_916:9` → read `.toggle-text` / skip `mat-icon` (`26e9e7a`). Added persisted last-send-error for diagnosis. |
| Test run 2 | FAIL | "couldn't type the prompt": Flow turns each line into a `<p>`, textContent glues paragraphs → compare without whitespace, also in `verifyMatch` (`1db9e83`). |
| Test run 3 | FAIL | Scenes 1–3 sent and generated (6 landscape pictures) but never saved: all tiles sit in ONE row div → tiles = `flow-grid-tile-container`, captions skip icon text (`ca3cd8d`). |
| Test run 4 | **PASS** | 6/6 scenes, 12 unique pictures, 1376×768 (16:9), each matches its scene; identical prompts (02/04) got distinct pictures. `e2e/test-run-4-pictures.jpg` |
| Resume test | PASS (+1 bug) | VidFlow restarted mid-run (extension reload clears session = restart path) with scene 2 in flight → run restored and continued; 2–4 correct, no mix-ups (`e2e/resume-test-pictures.jpg`). Scene 1 had failed: "message channel closed" (Flow reloads right after New project) → port retries on channel closed (`2cd4d89`). |
| Test run 5 | **PASS** | 6/6 scenes incl. scene 1 right after New project; identical prompts (03/04) distinct; all correct. `e2e/test-run-5-pictures.jpg` |

Timing: ~2 min for 6 scenes × 2 pictures, including opening each picture's detail page to verify its prompt and media id.

## Verified live
- Fresh Flow project per run; Image mode, 16:9 and outputs set through Flow's real controls (Flow remembered Video mode from an earlier test and VidFlow switched it back).
- Generate pressed via debugger input; Chrome shows "'VidFlow' started debugging this browser"; the VidFlow pill "VidFlow · Picture n of 6" with coral Pause appears bottom-left.
- Detail-page verification (single `data-media-id` == card key, prompt match) and saving to OPFS; pictures read back from the MediaStore.
- Restart mid-run resumes without mis-saving.

## Not covered here
- The studio screens were not clicked through by the tester (Chrome blocks automation of extension pages); the owner sees them. Their logic is unit-tested (Task 9).
- A real Chrome quit (tested via extension restart, which takes the same restore path).
- Flow's quota-limit, refusal and policy-dialog wording (never triggered).
- e2e `status` without a projectId returns no scenes once a run is cleared (test-tool only; pass the projectId).
