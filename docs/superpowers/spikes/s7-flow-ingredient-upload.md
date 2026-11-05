# Spike S7 — Attaching the hero reference in Flow (5 Nov 2026)

Owner's Flow Pro (unscripted4ce), Flow project "Nov 05 - 12:14" (the Plan 1b test project). Test picture: a 512×512 PNG stickman with a red cap drawn in the page (`vidflow-hero-reference-test.png`).

## Markup (live)

| What | Selector / behaviour |
|---|---|
| Open the picker | `button[aria-label="Add ingredients to the prompt box"]` (`aria-haspopup="true"`, class `add-menu-trigger`). A plain `.click()` opens it. |
| Picker | In `.cdk-overlay-container`. Asset list: `[role="listbox"][aria-label="Asset list"]`; each asset is `button[role="option"]` whose text is `<name>\nImage` (newest first; in-progress uploads read `Uploading\n<name>`, in-progress generations `Generating preview\nUntitled`). Left filters: All, Images, Videos, Voices, Characters, Avatars, Uploads. |
| Upload | Button whose text contains `Upload media` (inside the overlay). Clicking it makes Flow create `input[type=file]` appended to `<body>` (`accept=".png,.jpg,.jpeg,.webp,.gif,.heif,.heic,.mp4,.m4v,.mov,.3gp,.avi"`, `multiple`) and call `.click()` on it. VidFlow must not let the Mac file window open: set `input.files` with a `DataTransfer` holding a `File` named `vidflow-hero-<projectId8>.png`, then dispatch `change` (bubbles). The input stays in `<body>` afterwards, so later uploads can reuse `body > input[type=file]`. |
| After upload | The asset appears first in the list as `Uploading\n<name>` (~5–10 s), then `<name>\nImage`. It **also appears as a tile in the project grid** (`flow-grid-tile-container` with the file name as caption and its own `img[data-media-id]`). |
| Attach | `.click()` the asset's `role="option"` button (shows it in the preview; `aria-selected` stays `"false"`), then `.click()` the overlay button with text `Add to prompt`. The picker closes. Synthetic clicks work for both. |
| Attached | The prompt bar shows `button.chip-container[aria-label="Ingredient"]` containing `img.chip-image[alt="Ingredient image"]`. |
| Clear | `button[aria-label="Clear prompt"]` clears the text and the chip. |

## Behaviour

- **The chip is cleared by Generate.** The reference must be re-attached before every scene's prompt.
- **Re-attaching needs no second upload:** pick the existing asset by its name in the picker → Add to prompt. Upload once per Flow project (VidFlow makes a fresh Flow project per run, so once per run).
- **It works:** the test prompt "The hero from the reference picture, with the red cap, waves hello…" gave 2 pictures of the same red-capped stickman (`e2e/s7-reference-result.png`). 0 credits.
- **Agent mode is sticky:** the Agent chip (`.agent-mode-chip`, `aria-pressed="true"`) stayed on from the S6 test after a reload. If it's on, prompts go to the Agent instead of making pictures. VidFlow must turn it off (click it until `aria-pressed="false"`) before typing, and never turn it on.

## What the build must handle

1. Upload once per run into the fresh Flow project, wait until the option no longer reads `Uploading` (timeout → pause with the plain message).
2. Before each scene: attach by name; check the chip is present before pressing Generate; otherwise pause — never send a "match the reference" prompt without it.
3. **The uploaded reference is a tile in the grid.** Record its media id as already seen (`cardKeys`/seen set) so result matching can never save it as a scene picture. (Detail-page verification would also reject it — it has no prompt — but don't rely on that alone.)
4. Agent mode off before typing.
