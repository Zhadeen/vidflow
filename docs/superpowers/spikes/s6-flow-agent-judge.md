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
