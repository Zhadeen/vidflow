# VidFlow

**Turn a script into a finished stickman video — using the Google AI subscription you already pay for.**

VidFlow is a Chrome extension that automates [Google Flow](https://labs.google/fx/tools/flow) and Google AI Studio for you. Paste your scenes, press one button, and walk away while it makes the pictures, matches each one to the right scene, and keeps the best. No per-image cloud bills: it works through the Google AI Pro plan you already have.

> **Status:** early development, built for one creator first. Stage 1 (script → matched pictures) works end to end. Voice, motion and video export are next. Not on the Chrome Web Store yet.

## What it does

| Step | What happens | State |
|---|---|---|
| **Script** | Paste or upload a scene list (plain lines, numbered lines, or CSV). Slide numbers and timecodes are read automatically. | ✅ Built |
| **Pictures** | VidFlow drives Flow for you: one prompt after another, hands-off, until the whole list is done or you press Stop. | ✅ Built |
| **Voice** | Generate the voiceover in Google AI Studio scene by scene, or upload your own file. | 🔜 Planned |
| **Motion** | Turn each chosen picture into a short moving clip with Flow's video model, or a gentle zoom/pan. | 🔜 Planned |
| **Edit & Export** | Scenes in order, each as long as its voice line, voiceover underneath, exported as one MP4 in the browser. | 🔜 Planned |

## Why it's different

- **Every file goes to the right scene.** Each Flow result is tied to the exact prompt that produced it before it's saved — not "whatever picture is newest on the page".
- **Real settings, not wishful text.** Aspect ratio and number of outputs are set on Flow's own controls.
- **Automatic best picture.** Flow makes two options per prompt; VidFlow judges which one matches the prompt better, keeps it, and lets you override.
- **Hands-off.** Load 200 scenes, start, leave the tab. It pauses on quota or errors and keeps going on refused prompts.
- **Stays in its own tab.** The studio lives in a dedicated tab (plus a side panel beside Flow) instead of a heavy overlay on top of Flow.
- **Narrow permissions.** It only runs on the Google sites it works with, not on every website.
- **Honest by design.** It doesn't force-enable disabled buttons or click through Flow's policy notices for you.

## Install (developer build)

Requires Node.js and Chrome.

```bash
git clone https://github.com/Zhadeen/vidflow.git
cd vidflow
npm install
npm run build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `.output/chrome-mv3`. Sign in to Google with an account that has Google AI Pro.

For live development use `npm run dev`.

## Tech

TypeScript · React 19 · [WXT](https://wxt.dev) (Manifest V3) · IndexedDB · Vitest. Video export uses in-browser WebCodecs, so there are no servers and no per-use costs.

## Project docs

- [Design spec](docs/superpowers/specs/2026-11-05-vidflow-design.md): goals, non-goals and how it works
- [DESIGN.md](DESIGN.md): the approved visual style (navy and cream, coral actions)
- [Plans](docs/superpowers/plans): the build plans, stage by stage
- [End-to-end testing](docs/testing-e2e.md)

## Disclaimer

VidFlow is an independent project and is not affiliated with or endorsed by Google. It automates pages you are already signed in to, on your own account; use it within Google's terms and your plan's limits.
