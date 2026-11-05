# Spike S6 — Flow's Agent as the picture judge

**Date:** 5 Nov 2026. **Account:** unscripted4ce (Flow Pro). **Project:** "Plan 1b panel check" Flow project (6 pictures, 3 scenes × 2).

Flow's prompt bar has an **Agent** mode. It opens a chat panel beside the grid that can see the project's pictures. Text questions created nothing. Credits after the test: 1,043 (not measured before, so whether questions cost credits is unknown).

## Tests

| Question | Answer | Correct? | Time |
|---|---|---|---|
| Of the two "counts coins" pictures, which better matches "…at a shop counter in the evening"? | "The one with the shoulder bag … 9 o'clock clock and crescent-moon window" | ✅ Details are real (bag, clock, moon window) | ~25 s |
| Of the two "unlocks shop door" pictures, which is the close-up with shelves of bottles? Give its media ID. | "NO IDS: Shelved bottles in storefront window" | ✅ described the right one, but **can't see media IDs** | ~25 s |
| Yes/no by grid position: 1st has a shoulder bag / 3rd has a shoulder bag / 2nd has a potted plant / 6th has shelves of bottles | YES NO NO NO | ❌ 1 of 4 right as the page orders them (expected NO YES NO YES) | ~28 s |

## Verdict

The Agent **sees picture content well** (unlike Gemini Nano, no invented details here). But VidFlow can't tell **which** picture it means: it has no access to Flow's media IDs, and its idea of grid position doesn't match the page's order. Matching its free-text descriptions back to a picture would be guessing, and VidFlow never guesses.

**Not usable as-is.** Plan 2 ships the one-click swap (Flow's first picture kept, the other one beside it).

## Worth one more try later

Attach exactly the two pictures to the Agent message as ingredients (the "+" button), so they are "image 1" and "image 2" in a known order, and ask "1 or 2". If that answers reliably (including with the order swapped), it can become an optional "Auto-pick" on top of the swap. Also measure whether Agent questions use credits.

## Attached pictures (Task 6 of Plan 2, 5 Nov 2026)

Method: Agent mode on; the two pictures attached to the Agent prompt through "Add ingredients" (same picker as spike S7: option click → "Add to prompt"; an attached asset disappears from the list, so the second pick's index shifts). Asked "Image 1 is the first attachment, image 2 the second… Answer with just 1 or 2, then a short reason." Then the same with the order swapped.

| Pair | Question | Order | Expected | Answer | Reason given |
|---|---|---|---|---|---|
| "counts coins" (bag / no bag) | Which shows the stickwoman wearing a shoulder bag? | bag, no-bag | 1 | **1** ✅ | "strap across her body carrying a shoulder bag" |
| same | same | no-bag, bag | 2 | **2** ✅ | "wearing a shoulder bag across her body" |
| "unlocks shop door" (far view / close-up) | Which better matches "A close-up of a stickwoman at the shop door, with shelves of bottles visible in the shop window"? | far, close-up | 2 | **2** ✅ | "shelves containing bottles visible inside the shop window" |
| same | same | close-up, far | 1 | **1** ✅ | same, reversed |

- **4 of 4 right, in both orders** — no position bias (unlike Gemini Nano), and every reason named something really in the picture.
- **About 25–30 s per answer.** For a 30-scene video that is ~15 min of judging, one scene at a time (the Agent chat is one conversation).
- **Credits: 1,043 before and after** (7 Agent questions and 2 test pictures in this session) — Agent questions didn't cost credits on Pro.
- After the questions the Agent chat panel must be closed and **Agent mode switched off** (it stays on otherwise; see S7).

Not tested: the plan's 3-scene bar with subjective "better matches the prompt" pairs (where both pictures fit). Only 2 pairs with a clear right answer were tried.

## Verdict (updated)

**Usable as an opt-in "Auto-pick"** in a later plan: attach the scene's pictures in a known order, ask "1 or 2", and only accept an answer whose number is 1..N; on anything else keep Flow's first and leave the scene for the owner. Slow (≈30 s/scene) and it shares the Flow window with the run, so it should run after pictures are made, not during. Plan 2 ships the swap only; the owner decides whether Auto-pick goes into a later plan.
