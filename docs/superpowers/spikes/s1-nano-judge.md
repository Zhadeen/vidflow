# Spike S1 — Picture judging with Chrome's built-in AI (Gemini Nano)

**Date:** 5 Nov 2026. **Mac:** owner's MacBook, Chrome 156. **Model:** Chrome's on-device `LanguageModel` with image input (owner approved the one-time download).

## Availability

- Before: `availability({expectedInputs:[image,text]})` → `downloadable`. `create()` needs a user click (transient activation) to start the download.
- Download: progress events stopped at ~64 % for several minutes, then finished; total roughly 20–25 min. Afterwards → `available`.
- First `create()` in a fresh page took **135 s** (model load); later prompts in the same page were faster.
- Images from Flow's content host can't be read by Flow's page (cross-origin taint); the extension can fetch them with its host permission. The spike used local copies served from localhost.

## Test

Two real stickman pictures from the 5 Nov Flow Flash test, both "stickman switches off a computer":
- **tower** — presses the power button on the computer tower (no "OFF" sign, no plant);
- **monitor** — monitor shows "OFF", potted plant in the corner, presses the monitor button.

### 1. Pairwise ("which matches better, A or B?"), full-size pictures

| Description | Order | Expected | Picked | Time |
|---|---|---|---|---|
| presses the power button on the tower under the desk | tower, monitor | A | A ✅ | 34.7 s |
| same | monitor, tower | B | A ❌ | 28.1 s |
| monitor shows OFF, potted plant | tower, monitor | B | B ✅ | 22.2 s |
| same | monitor, tower | A | B ❌ | 18.5 s |

The model's answer depended on the **position** of the picture, not its content: swapping A and B didn't change its letter. 2 of 4 correct, i.e. chance.

### 2. Scoring each picture separately (0–10), resized to 384 px

| Description | Picture | Score | Notes |
|---|---|---|---|
| tower button | tower | 9 | |
| tower button | monitor | 9 | listed "computer tower, under the desk" |
| OFF + plant | tower | 8 | **claimed "word OFF, potted plant"** — not in the picture |
| OFF + plant | monitor | 9 | |

Scores don't separate the right picture from the wrong one, and the model **reports details that aren't there**. 11–22 s per picture.

## Verdict

**Not usable** for automatic best-picture choice. It is slow (≈ 20–35 s per pair, plus a 2-minute first load), position-biased, and hallucinates details.

## Fallback for Plan 2 (needs the owner's choice)

1. **Keep Flow's first picture by default and let the owner swap** with one click in the studio (both options are always saved). Free; fast; not automatic.
2. **Use Flow's own assistant ("Agent" button in Flow)** to judge — unexplored; might work through the same account at no extra cost.
3. **Use Claude** to judge: accurate, but not free to automate (the Anthropic API is pay-per-use; the owner chose no paid APIs).

Re-test later if Chrome ships a newer on-device model.
