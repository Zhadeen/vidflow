# Spike S2 — Flow image-to-video

**Date:** 5 Nov 2026. **Account:** unscripted4ce@gmail.com (Google AI Pro). One 4 s test clip made (7 credits).

## Controls

Same settings popover as pictures (`[aria-label="Settings trigger"]`), after choosing **Video** in the Image/Video radiogroup. Radiogroups then are:

| Group | Options | Default |
|---|---|---|
| Mode | **Frames** (start/end picture → clip) · Ingredients | Ingredients |
| Aspect | 16:9 · 9:16 | 16:9 |
| Resolution | 360p · 720p | 720p |
| Length | 4s · 6s · 8s · 10s | 8s |
| Outputs | x1 · x2 · x3 · x4 | x2 |

Model shown: **Omni 1.1 Flash**. All radios accept plain DOM `.click()` (as in S5). The trigger text summarises the settings, e.g. `Video · 720p · 4s crop_16_9 x1`.

In **Frames** mode the prompt bar gains **Start** and **End** frame slots. Clicking Start opens "Select a frame image": project pictures listed by their AI titles, a search box, and **Upload media**. "Add to prompt" puts the picture in the Start slot. Then type the motion prompt into the same `[role="textbox"]` and press Generate (trusted click, as in S5).

**For VidFlow:** pick the start frame by **uploading the chosen picture file** (VidFlow already has it) rather than choosing by AI title, which isn't unique. Task in Plan 3 must explore the upload path (file input behind "Upload media").

## Cost (credits per clip, x1)

| Length | Credits |
|---|---|
| 4 s | 7 |
| 6 s | 10 |
| 8 s | 12 |
| 10 s | 15 |

Resolution (360p vs 720p) doesn't change the price. Cost scales with outputs (x2 at 8 s = 24). The popover shows the exact cost ("Generating will use N credits") — VidFlow can read it before each submit.

**Credit balance:** `[aria-label="Account details"]` opens a panel showing e.g. **"1,043 Google Flow credits · Resets on 13 Nov at 13:50"**. VidFlow can read the number and reset date there. The panel does not split free daily / plan / purchased pools — so the design's "free + plan only" option can only be enforced as a spending cap that VidFlow tracks itself.

## Result

- Finished in under ~40 s. Tile becomes a `flow-video-tile` with a play icon; caption renamed to an AI title ("Man waving and smiling"), as with pictures.
- Clip: **4.017 s, 1280×720** (720p), MP4 stream from Flow's content host.
- The motion matched the prompt's intent (stickman keeps waving and smiles).

## Matching clips to scenes

Same as pictures (S5): order of submission + media id, verified in the detail view. Each clip is a single output when x1 is used, which keeps matching simple — **VidFlow should generate clips at x1**.

## Recommendation

Usable. Default clip length = the scene length rounded up to the next available length (4/6/8/10 s), trimmed in the editor; 4 s at 7 credits is the cheapest. With ~1,043 credits/month, a 60-scene video at 4–6 s clips costs ~420–600 credits, so the Motion step must show the estimate and allow stills for some scenes.
