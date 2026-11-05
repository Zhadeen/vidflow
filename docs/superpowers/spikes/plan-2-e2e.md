# Plan 2 live check (5 Nov 2026)

Owner's Flow Pro (unscripted4ce), e2e build of feat/plan-2. Driven through the e2e hook (which now also takes a hero description + reference picture, a model-sheet start, and a swap).

| Check | Result |
|---|---|
| 3-scene run with a hero reference (red-capped stickman PNG) | First attempt **paused safely** ("VidFlow couldn't attach the hero reference…"): a brand-new Flow project's picker says "No assets found." and has no asset list, which the driver waited for. Fixed in `fa69d46` (picker counts as open when its Upload button shows; Escape sent from inside the overlay). After Resume: **3/3 scenes, 6 pictures, all with the red-capped hero** (`e2e/plan-2-hero-run-pictures.jpg`). The uploaded reference was not saved as a scene picture. |
| No prompt sent without the reference | ✅ The failed attach paused before any prompt went to Flow. |
| Swap | ✅ Choosing scene 2's second picture saved; choosing a picture from another scene was refused with "That picture isn't one of this scene's pictures any more…". |
| Model sheet ("A short stickman with a red cap and a blue scarf") | ✅ Own run (`kind: hero-sheet`), fresh Flow project, no reference attached, 2 pictures saved as `hero-sheet-option-1/2`, no scene touched. Both show front, side, back + happy, worried, surprised with the cap and scarf; one labels the views (`e2e/plan-2-model-sheet.jpg`). |
| Agent mode | Stayed off throughout. |
| Side panel during the run | Showed "Adding the hero reference picture to Flow" and the activity lines (Paused / Resumed). |

Not checked live: the studio's swap UI and "Use as hero reference" button by hand (covered by unit tests and build-check screenshots); one sheet picture has a pale blue background rather than plain white.
