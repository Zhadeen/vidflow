# Spike S4 — AI Studio voice

**Date:** 5 Nov 2026. **Account:** unscripted4ce@gmail.com (PRO badge in AI Studio). **Page:** `https://aistudio.google.com/u/0/generate-speech`.

## What's free and what isn't

- **Built-in speakers work free.** "Create new dialog" opens a speech block with a built-in speaker ("Speaker 1 – Fola", "Clear and friendly, Medium pitch"), a Style menu and "+ Expression" tags. Typing a line and pressing **Run** produced audio with no billing prompt. Model: **Gemini 3.8 Flash TTS**.
- **The voice library personas and "Create new voice" (Voice Design) are NOT free.** Clicking "The Grizzled Detective" opened *"Create voice · Voice Design — Voice Design runs on the paid tier. Link a paid API key to continue"* with a **Set up billing** step. I closed it without setting anything up.
- **Design impact:** VidFlow's voice step must use the **built-in speakers only** (pick from the speaker dropdown, optional Style/expression tags). It must never open Voice Design or any billing setup, and should treat a "paid tier / billing" dialog as a stop with a plain message. Spec §7.2 "pick a voice from AI Studio's library or describe one" needs updating to "pick one of AI Studio's built-in voices".

## Controls

| Thing | How |
|---|---|
| New speech | button "Create new dialog" |
| Speaker | dropdown "Speaker 1 – <name>" in the block; details in the right "Speaker settings" panel |
| Text | the block's editable text area (typed with real keystrokes in this spike; plain DOM insertion not yet tested) |
| Generate | button "Run" (⌘↵) |
| Result | an `<audio>` element whose `src` is a **`data:audio/wav;base64,…` URL** |
| Download | button "Download" next to the player |

## Result

- Line "Every month, my phone bill shocked me." → **2.96 s WAV**, generated in under 10 s.
- Because the audio is a `data:` URL on the page, VidFlow's helper can read the WAV bytes directly — no file download needed — and get the exact duration for the scene's timing.

## Open for Plan 4

- Whether DOM `.click()` on Run and DOM text insertion work, or need debugger input as Flow's Generate does.
- Voice consistency across separately generated lines with the same built-in speaker (only one line generated here).
- Daily limits for TTS on the Pro plan (none hit).

## Recommendation

Usable with the built-in voices. Generate one line per scene, read the WAV from the page, use its duration as the scene length.
