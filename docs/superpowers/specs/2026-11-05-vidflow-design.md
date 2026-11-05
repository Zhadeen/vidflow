# VidFlow — design

**Date:** 5 November 2026
**Owner:** Hayatudeen (Google account `unscripted4ce@gmail.com`)
**Status:** draft for approval

VidFlow is a Chrome extension that turns a script into a finished stickman video using the creator's own Google subscriptions (Google AI Pro: Flow and AI Studio) instead of pay-per-use cloud AI. It is a standalone product first; it may join VidFlint later.

Throughout, **(Hayatudeen)** marks a decision the owner made in conversation, and **(my call)** marks one I made that he can overturn.

---

## 1. Why this exists

- VidFlint's stickman videos call Gemini on Google Cloud (Vertex AI) and are billed per image. Four days of testing (25–28 Oct 2026) cost about US$67, most of it Gemini 3 Pro Image for 14 stickman videos. The owner can't afford that while testing, and the AI APIs on the VidFlint project are now switched off.
- He already pays for **Google AI Pro**, which includes **Google Flow** (images and Veo video) and **Google AI Studio** (including Gemini text-to-speech). Used through their websites, these cost nothing extra.
- A friend's extension, **Flow Flash — Google Flow Batch Creator** (local copy: `~/Downloads/flow_flash_batch mobile/`), proves batch automation of Flow works: paste a prompt list, it submits them one after another and downloads the images. But it stops at loose images, and a live test on 5 Nov 2026 showed it saves the wrong pictures.
- **The goal:** one tool that goes **script → voice → pictures → moving clips → finished video**, hands-off, on the subscriptions he already pays for. Someone who has used Flow Flash should open VidFlow and see how far it has moved on. (Hayatudeen)

## 2. Who it's for

- **v1:** the owner alone, on his Mac, in Chrome, signed in to Google as `unscripted4ce@gmail.com` (Google AI Pro). Not published to the Chrome Web Store yet.
- **Later:** other stickman creators who have their own Google AI plan, and possibly VidFlint members. Nothing in v1 should assume a single user (no hard-coded email), but there is no account system, server, or payments.

## 3. Goals

1. **Hands-off batch generation.** Load 200 scenes, press one button, walk away; it works through all of them without the owner at the laptop, until finished or stopped. (Hayatudeen)
2. **Every saved file belongs to the right scene.** Each picture and clip is matched to the prompt that made it before it is saved. (Fixes Flow Flash bug; see §4.)
3. **Automatic best-picture choice.** Flow makes two pictures per prompt; VidFlow judges which one better matches the prompt (e.g. "standing *by* the window" vs. far from it), keeps it, and discards the other. The owner can override. (Hayatudeen)
4. **Moving scenes.** Each chosen picture plus that scene's motion prompt goes to Flow's video model (Veo, image-to-video) to make a short clip of the stickman actually moving. If that isn't possible for a scene, the still picture gets a gentle zoom/pan instead. Using a clip or a still is also a per-scene and per-project choice. (Hayatudeen)
5. **Voiceover in the same tool.** Generate it in Google AI Studio, one scene at a time, or upload an existing file. (Hayatudeen)
6. **A finished video out.** Clips/pictures in scene order, each lasting as long as its voice line, voiceover underneath, exported as one MP4 — made in the browser, at no cost.
7. **Stickman first.** All stickman looks (whiteboard, doodle comic, coloured stickman, etc.). Other art styles later. (Hayatudeen)
8. **Professional, clear, easy to navigate.** Every button obvious, every instruction plain and well written, no heavy greys or foggy images. (Hayatudeen)

## 4. What we learned from Flow Flash (the reference)

Read in full (code) and run live on 5 Nov 2026 with two stickman prompts. Keep the good parts, fix the broken ones.

**Keep (same behaviour, our own code):**
- Paste/upload a scene list (lines, numbered lines, or CSV); slide numbers and timecodes parsed.
- Prompt wrapping: style block + character lock + `Scene: <prompt>` + style-enforcement line + specs.
- Style presets including a 2D stickman preset; custom style text.
- Character model-sheet template and "hero" reference image in Flow's Ingredient slot.
- Non-blocking loop: submit the next prompt every few seconds without waiting; a watcher collects finished results.
- Pause on quota/limit/error text; skip a refused prompt and continue; downloads into a named folder with slide-numbered, timecoded filenames.
- A "Mother Prompt" for an outside AI to turn a script into the scene file.

**Fix (observed in the live test):**
- **Wrong files saved.** Both saved files (`Slide_01…`, `Slide_02…`) were the computer scene; neither phone-bill picture was saved. VidFlow must tie each Flow result to the prompt that produced it (not "newest image on the page").
- **Aspect ratio ignored.** Flow Flash only writes "Aspect Ratio: 16:9" into the prompt text; Flow produced portrait images. VidFlow sets Flow's real aspect-ratio and outputs-count controls.
- **Character text fights the style.** Its saved hero description said "natural photorealistic facial features" while the stickman preset was on. VidFlow's character text is style-aware.
- **Only one of two outputs kept, sometimes the wrong one.** Replaced by goal 3.
- **Heavy panel over Flow.** Its whole UI sits on top of Flow. VidFlow's UI lives in its own tab (§7).
- **Runs on every website** and asks for cookies/debugger access it mostly doesn't need. VidFlow only runs on the Google sites it works with.

**Deliberately not copied (§10):** force-enabling greyed-out buttons, and auto-clicking "I agree" on Flow's policy notices.

## 5. Non-goals (v1)

- No pay-per-use APIs: no Google Cloud/Vertex AI, no Anthropic API, no Gemini API key. (Hayatudeen: option 1 for Claude; cost reason for the rest.)
- No integration with VidFlint's website, database or render service yet. (Hayatudeen)
- No non-stickman art styles beyond what falls out of the preset system for free.
- No accounts, sync between computers, sharing, or payments.
- No Chrome Web Store publishing (the build should not block it later).
- No music generation (Flow Music is in his plan — possible later).
- No mobile.

## 6. Anti-goals — failure even if it "works"

- Saving a picture or clip under the wrong scene number.
- A run that silently stops or silently skips scenes. Every skipped/failed scene is listed with the reason.
- Burning through Flow credits without warning (especially video). The owner sees the estimated cost before a run and VidFlow stops cleanly when credits run out.
- Anything that sends his content or account data anywhere other than the Google pages he's using and his own disk.
- A UI that looks like Flow Flash's: busy, foggy, unclear which button to press.
- Breaking or slowing the Flow tab.

## 7. How it works for the owner

### 7.1 The pieces (my call)

- **Studio tab** — VidFlow's own full-page app, opened from the toolbar icon. All screens live here.
- **Flow helper** — runs only on `flow.google.com` (and `labs.google/fx/...` which redirects there). Types prompts, sets Flow's controls, presses Generate, collects results. Its only visible UI is a small status pill (e.g. "VidFlow · Picture 38 of 60 · Pause").
- **AI Studio helper** — runs only on `aistudio.google.com` speech page. Same idea for voice. Same small pill.
- **Background coordinator** — keeps the queue, hands jobs to the helpers, keeps going when the studio tab is in the background, survives a Chrome restart.
- **Local storage** — the project, pictures, clips and audio are stored on the Mac inside Chrome's storage for the extension, not in memory. Closing Chrome mid-run and reopening resumes where it stopped.

### 7.2 The flow of a video

**Step 1 — Script.** New project → name it → paste the script. The **Copy Claude Prompt** button copies VidFlow's Mother Prompt with the script appended; the owner pastes it into claude.ai (covered by his Claude subscription), copies Claude's CSV reply back, and drops/pastes it into VidFlow. (Hayatudeen: Claude, option 1 — manual copy/paste.) VidFlow validates it and shows the scene list.

Scene file columns (one row per scene):

| Column | Meaning |
|---|---|
| Slide | `Slide 01`, `Slide 02`, … |
| Timecode | `MM:SS - MM:SS` estimate (replaced by real voice timing when voice is generated) |
| Sentence | the exact voiceover line for this scene |
| Concept | 3–6 word summary |
| Text Overlay | 1–3 punchy words (optional on-screen caption) |
| Image Prompt | what is in the picture; style-neutral; main character called "the hero" |
| Motion Prompt | 1–2 sentences: what moves in the clip |

Rules carried into the Mother Prompt: never skip a sentence; split long sentences into 2–3 scenes (3–6 s each); no art style or character appearance in prompts (VidFlow adds those); motion prompts describe movement only. If a row has no Motion Prompt, VidFlow writes a simple one from the Sentence (my call).

Also on this step: **style** (stickman preset or custom), **hero character** (describe and/or upload a reference picture; option to generate a model sheet in Flow first), **aspect ratio** (16:9 / 9:16 / 1:1), **pictures per prompt** (Flow's setting; default 2 so auto-pick has a choice).

**Step 2 — Voice.** Two choices; **Generate is the default** (my call — he didn't answer which should open first):
- **Generate:** pick one of AI Studio's built-in speakers (see §16). VidFlow has AI Studio speak each scene's Sentence separately (Gemini TTS, his Pro plan), saves one audio file per scene, and sets each scene's real length from its audio. "Regenerate" per scene.
- **Upload:** one audio file. Scenes are laid across it using the file's timecodes, scaled to the audio's length; the owner drags scene edges on the timeline to line up the rest.

**Step 3 — Pictures.** Shows how many pictures the run needs. Start → Flow helper works through all scenes. For each scene: wrap the Image Prompt (style + character + scene + enforcement), set Flow's aspect ratio/outputs, submit, collect both results, judge which better matches, keep the winner (★ Best match) and the runner-up as a one-click alternative. Scenes fill in on the grid live. Refused or failed scenes are marked with Flow's reason and a "Try again" / "Edit prompt" action; the run continues.

**Step 4 — Motion.** Shows the estimated Flow credits for clips vs. what's available, and lets the owner choose "clips for all", "clips for selected scenes", or "still with zoom/pan for all". For each scene getting a clip: give Flow the chosen picture + Motion Prompt, collect the clip. If a clip fails or credits run out, that scene falls back to zoom/pan and the run continues; a summary lists which scenes got which.

**Step 5 — Edit.** The editor: big preview, scene grid, timeline with voiceover waveform. Per scene: swap picture (runner-up or regenerate), regenerate clip, switch clip/still, trim, adjust length, edit text overlay. Play the whole video with voice.

**Step 6 — Export.** One MP4 at the project's aspect ratio (1080p default), made in the browser. Clips trimmed to their scene length; a scene longer than its clip holds the last frame or slows the clip slightly (builder chooses; must look natural). Optional burned-in text overlays. Saved to Downloads under the project name. Also "export assets" (all pictures/clips/audio, correctly named) for use in other editors.

**Projects home.** List of projects with thumbnail, scene count, status, last edited; open, duplicate, delete.

### 7.3 Moving between steps

Layout **C — steps across the top, editor below** (my call: he said the mockups "look great" without picking; C was my recommendation). Steps are always visible and clickable; finished steps show ✓; the active step shows live progress ("Pictures 38/60"). The preview and scene grid are visible on every step after Script, so he can check work while a run is going. Each screen has exactly one primary (coral) action — usually "Continue to …".

### 7.4 Status everywhere

- The Flow and AI Studio tabs show only the small VidFlow pill: what it's doing, progress, Pause/Resume.
- The toolbar icon shows a badge with progress.
- A Chrome notification when a run finishes, pauses for a limit, or needs him (my call).

## 8. Automatic best-picture choice

- **First choice: Chrome's built-in AI (Gemini Nano) with image input**, running on the Mac — free, private, no API key. For each scene it compares the two pictures against the Image Prompt and returns the winner plus a one-line reason ("Presses the power button, as written."). (my call)
- **Must be proven on his Mac first** (§12 spike 1): availability on this machine/Chrome version, quality on stickman pictures, speed.
- **Fallbacks, in order:** ask Flow's own assistant (if Flow exposes one that can judge), or keep Flow's first result and mark the scene "not auto-checked" so he can glance at it. The build plan picks after the spike.
- Never delete the runner-up from VidFlow's storage until export; "discard" means "not used". (my call — cheap insurance against bad picks.)

## 9. Visual design

Chosen: **B · Navy with cream** (Hayatudeen), from his reference palette:

| Role | Colour |
|---|---|
| Background | Navy `#14213D`, with a soft coral radial glow in one corner |
| Text | Cream `#F4EDE0` (secondary text a slightly muted cream) |
| Primary action + "Best match" | Coral `#FF6B5B` with **navy** text (white on coral fails contrast at button size) |
| Surfaces, borders | lighter/darker shades of navy only |

Rules (Hayatudeen's requirements, made concrete):
- One coral primary action per screen; secondary buttons clearly outlined in cream, never faint grey.
- Body text meets WCAG AA contrast on its background; no thin grey-on-grey.
- Pictures and clips shown at full brightness — no overlays dimming them; selection shown with a coral border and badge, not a tint.
- Gradients only as the subtle background glow.
- Instructions written in plain, short sentences that say what happens and what to do; error messages say what went wrong and the next step.
- Every interactive element has visible hover, focus, pressed, disabled and loading states.
- Motion is purposeful and respects "reduce motion".

The build produces a `DESIGN.md` (tokens + rules) for VidFlow and uses the **impeccable** and **apple-design** skills for the visual pass and review. Approved mockups: `~/Developer/VidFlint/.superpowers/brainstorm/48768-1793842330/content/visual-style-v2.html` (option B) and `studio-layout.html` (option C).

Name: **VidFlow** (Hayatudeen). Note: "Flow" overlaps Google's product name; check Chrome Web Store for conflicts before any publishing.

## 10. Constraints and boundaries

- Chrome on macOS; Manifest V3.
- Works only through the owner's signed-in Google pages; never handles his password.
- **Automation boundary (agreed 5 Nov 2026):** VidFlow may click and type in Flow/AI Studio on his behalf, including via Chrome's debugger input if normal clicks are unreliable. It must **wait for Flow's buttons to be ready** rather than force-enabling disabled ones, and it must **pause and ask him to click** Google's usage-policy notices himself (once), never auto-accept them.
- Flow credits: Google AI Pro includes 50 extra Flow credits daily plus plan credits; video costs far more than images. VidFlow reads remaining credits from Flow's UI when it can and estimates otherwise.
- **Credit options (Hayatudeen: "we should have options"):** Settings and the Motion step offer a **credit source** choice — "free daily + plan credits only" or "also use credits I've bought" — and an optional **daily credit limit**. Default is free daily + plan only, no extra limit (my call). If Flow can't tell VidFlow which pool a generation draws from, VidFlow stops at the estimated free/plan amount when that option is selected.
- **When credits run out (Hayatudeen):** VidFlow does not keep going with clips — every remaining scene uses its still picture (with zoom/pan). Before the Motion run the owner sees which scenes will get clips with the current credits and can change the selection, or choose "stills for all".
- **Google account (Hayatudeen, 5 Nov 2026):** VidFlow runs on **`unscripted4ce@gmail.com`** (the account with Google AI Pro). He first chose a separate account (`unscripted4ce01@gmail.com`), but it has no AI Pro plan, and he decided to use `unscripted4ce` and accept the risk that it also owns VidFlint's Google Cloud/Firebase. VidFlow shows which account the Flow/AI Studio tabs are signed in to and warns if it differs from the account set in VidFlow's settings.
- Permissions limited to what's needed: the Google Flow and AI Studio sites, downloads, storage, notifications, and debugger only if spike 2 shows it's needed.
- Must stay responsive with 200+ scenes: media stored on disk, thumbnails in the UI, heavy export work off the main thread.
- Separate repository: `~/Developer/VidFlow` (my call). No code shared with VidFlint in v1.
- Flow Flash's code is someone else's work: study its behaviour, write VidFlow's own code.

### 10.1 Running unattended (my calls)

- **Quota hits:** when Flow or AI Studio shows a daily limit, VidFlow pauses, records when the limit is expected to reset (from Google's message if it says, otherwise next local midnight), and **resumes on its own** at that time if Chrome is open and he is still signed in. If not signed in, it stays paused and notifies him. Goal 1 (hands-off) wins over the simpler "wait for him".
- **Using the Mac during a run:** supported. VidFlow opens Flow and AI Studio in **their own dedicated, pinned window** so it never types into a tab he's using, keeps the Mac awake while a run is active (Chrome's power API), and never steals focus. If spike 2 shows Flow only accepts input while its tab is visible, the dedicated window stays visible and the owner is told so.
- **Pacing:** submissions are paced (a few seconds apart, with small random variation) and runs respect any per-day limit set in Settings. This is to avoid tripping Google's rate limits, not to disguise automation.
- **Models:** defaults are Flow's current default image model (Nano Banana 2.1 at time of writing) and the **cheaper/faster Veo option** for clips; both are per-project settings. **Clip sound is always muted** in the export (the voiceover is the only voice); a per-scene toggle can bring clip sound back.

## 11. Failure handling

- Flow/AI Studio page layout not recognised → pause with a clear message ("Can't find Flow's prompt box — is the Flow tab open on a project?") and a "Try again" button.
- Quota/limit message → pause the run, show the message and when to resume; resume continues from the next unfinished scene.
- Prompt refused (policy/safety) → mark that scene "Refused by Flow" with Flow's text and "Edit prompt"; continue.
- Flow/AI Studio tab closed or signed out → pause and say so.
- Chrome closed mid-run → on reopen, the project shows where it stopped with "Resume".
- End of every run → summary: done / refused / failed / fell back to still, each listed.

## 12. Prove first (throwaway spikes before the real build)

1. **Picture judging:** Gemini Nano with image input on his Mac — available? picks correctly on real stickman pairs? how long per scene?
2. **Flow image-to-video:** drive Flow to make a clip from a chosen picture + motion prompt; learn clip length, credit cost, how to tie each clip to its scene, whether normal clicks work or debugger input is needed.
3. **In-browser export:** stitch ~20 clips/stills + audio into a 1080p MP4 in Chrome; time and memory.
4. **AI Studio voice:** drive the speech page to generate and download one line; how to tie audio to scene; voice consistency across lines.
5. **Flow result tracking:** reliably map each Flow result to its prompt (the bug Flow Flash has), and set Flow's real aspect-ratio/outputs controls.

Any spike that fails changes the design before building; I'll bring that back to Hayatudeen.

## 13. Build order

1. Batch pictures engine: scene file in → pictures out, correctly matched, real aspect ratio, studio Script + Pictures steps.
2. Automatic best-picture choice.
3. Motion: Flow clips + zoom/pan fallback + credit estimate.
4. Voice: AI Studio generate + upload; real scene timing.
5. Edit + Export.
6. Polish pass with impeccable / apple-design; DESIGN.md.

Each stage is usable and tested before the next.

## 14. Left to the builder

- Exact list and wording of stickman style presets (at least: classic whiteboard stickman, doodle comic stickman, coloured stickman, plus custom).
- Exact Mother Prompt text (must produce the §7.2 columns and rules).
- Video encoding approach in the browser, file formats of stored media, clip-vs-scene length handling, export settings beyond 1080p MP4.
- Internal architecture, storage layout, message passing, test approach.
- Exact credit estimates (from spike 2).

## 15. Calls I made (for review)

- Studio in its own tab; Flow/AI Studio get only a status pill.
- Layout C (steps on top, editor below).
- Generate voice is the default; Upload one click away.
- Gemini Nano for picking, pending spike 1; runner-up kept until export.
- VidFlow writes a default motion prompt when a row has none.
- Chrome notifications for finished/paused runs.
- Separate repo at `~/Developer/VidFlow`.
- 1080p MP4 default export.

## 16. Changes from the spikes (approved by Hayatudeen, 5 Nov 2026)

Spike notes: `docs/superpowers/spikes/s2-…`, `s3-…`, `s4-…`, `s5-…`.

1. **Debugger input for Generate.** Flow's Generate button ignores synthetic clicks; VidFlow presses it with Chrome debugger input on its own Flow tab only (typing and settings stay plain DOM). Adds the `debugger` permission; Chrome shows its "started debugging" bar during runs; detach when a run pauses or finishes. Still waits for the button to be enabled.
2. **Voices: AI Studio built-in speakers only.** Voice library personas and Voice Design need a paid API key with billing; VidFlow never opens them and stops with a plain message if any billing/paid-tier dialog appears. §7.2 "pick one of AI Studio's built-in speakers (see §16)" becomes "pick one of AI Studio's built-in speakers".
3. **Credit limit, not credit pools.** Flow shows one credit total (e.g. "1,043 Google Flow credits · Resets on 13 Nov") with no split between free/plan/bought. The §10 credit-source option becomes a **per-run credit limit VidFlow tracks itself** (default: the estimate shown before the run).
4. **Clips at x1 with an uploaded start frame** (Frames mode). Costs: 4 s = 7, 6 s = 10, 8 s = 12, 10 s = 15 credits; resolution doesn't change cost.
5. **A fresh Flow project per run**, so result matching never sees foreign tiles.
6. **Pictures cost 0 credits** (Nano Banana 2.1 on Pro); Flow's default aspect is 9:16, so VidFlow always sets it.
7. **Export:** WebCodecs + mediabunny in a worker, H.264 8 Mbps / AAC 128k; requires real Chrome's H.264 encoder (check `canEncodeVideo` first); stream output for long videos.
8. **Picture judging (Gemini Nano):** model download approved and started; result pending (Plan 2).

## 17. Live activity (approved by Hayatudeen, 5 Nov 2026)

On the Flow page, look-only (pointer-events none), switchable ("Show live activity in Flow", on by default):
- the VidFlow pill shows the current step in plain words ("Scene 3 of 6 · Pressing Generate"), a progress bar and "N saved · N being drawn · N to go";
- a coral ring + short tag on whatever VidFlow is touching (prompt box, a setting, Generate, a picture being checked); fades as it moves on;
- a "✓ Saved · scene N" badge on pictures VidFlow has collected.
In the studio: an Activity list (timestamped, plain words, newest first). Mockup: VidFlint `.superpowers/brainstorm/82712-1793872276/content/live-activity.html` (copy into docs/design/approved/ when built).

## 18. Side panel beside Flow (approved by Hayatudeen, 5 Nov 2026)

VidFlow also opens in Chrome's own side panel (`chrome.sidePanel`) on the right of the Flow window — never on top of Flow. Mockup: `docs/design/approved/side-panel.html`.
- **Before starting:** pick/create the video; paste Claude's reply (live "✓ N scenes found" / plain issues; applied only on an explicit action, as in the studio); choose aspect (16:9 / 9:16 / 1:1), pictures per scene, style, hero description; summary line (pictures · 0 Flow credits · Chrome debugging bar note); coral "Start making pictures".
- **While running:** project name, current step in plain words, progress bar, "N saved · N being drawn · N to go", a strip of scene boxes (saved = cream ✓, current = coral outline, upcoming = navy), the Activity list (§17), coral Pause + outlined Stop (Resume when paused).
- "Open full studio ↗" in both states. Panel and studio show the same project and stay in sync (same run state and project store).
- Same look as the studio (navy + coral glow, cream text, one coral primary at a time).
- §7.1 changes: the Flow window may show VidFlow's side panel; the full studio tab remains for editing/reviewing.

## 19. Side panel as the full control centre (approved by Hayatudeen, 5 Nov 2026)

**Why:** he felt the panel was "empty" next to Flow Flash's. The panel must let him do everything while watching Flow, without needing the full studio, and anyone looking only at the panel must see it is an upgrade of Flow Flash. Mockup: `docs/design/approved/side-panel-v2.html` (approved). This replaces §18's two-state panel; §18's rules (Chrome side panel, same project and run state as the studio, one coral primary at a time, navy/cream/coral look) still hold.

**Layout:** header ("〰 VidFlow", "Open full studio ↗"), a **health line** under it on every tab ("✓ Signed in · ✓ Flow ready · ✓ Hero attached", each turning into a plain warning when it fails), then four tabs: **Setup · Queue N · Checks · Files**. One coral primary per tab. The panel opens on Setup when no run is live, on Queue when one is.

**Setup tab**
- Video picker with "+ New".
- "1 · Get your scenes": **Copy Claude prompt** and **Copy rapid-beat prompt** (the same prompts as the studio's Script step; the panel has no script box, so these copy the prompt with the video's saved script, or ask him to add the script in the full studio when there is none — my call); paste box for Claude's reply **or upload a file** (CSV, TSV, TXT, PDF — PDF text read in the browser); live "✓ N scenes found · no problems" and **Use these scenes** (Plan 1's explicit-apply rule and replace-confirm stay).
- "2 · Look": 16:9 / 9:16 / 1:1, pictures per scene (1 / 2 / 4), style.
- "3 · Hero": description, reference thumbnail with "Reference picture ✓ · attached to every scene" (or "No reference picture" + Upload), **Upload picture** and **Make model sheet** (same behaviour as the studio's hero section, §Plan 2).
- Summary line: pictures · Flow credits · rough time. Coral **Start making pictures** (or "Review in the full studio" when every scene has pictures, as today).

**Queue tab**
- Video name, step in plain words, progress bar, "N saved · N being drawn · N to go · N failed".
- Filters: All · Drawing · To go · Failed · Done, with counts.
- One row per scene: thumbnail of the chosen picture (or empty), number, sentence, timecode, and the upgrade marks **"✓ checked · hero ✓ · 2 options"** (only what's true for that scene), a status tag (✓ Saved / Checking / Drawing / Failed with reason / Refused with Flow's reason), and **▶ Run** on a scene that isn't done (makes just that scene). Clicking a row with pictures shows its options with the one-click swap (Plan 2).
- **Retry failed** when any failed. Activity lines (§17). Coral **Pause** (Resume when paused) + **Stop** + **Skip** (skips the current scene: it ends as failed with "Skipped by you", the run moves on).

**Checks tab**
- Checked when the tab opens, before every Start, and on **Check again** (coral): Google account (expected account), Flow page & project, prompt box, Generate button, Agent mode off, Flow settings (model · aspect · outputs) match the video's, hero reference ready (when set), credits (shown when Flow shows them without opening menus; otherwise "0 needed" for pictures). Each row: ✓ badge or a plain problem with what to do.
- Switches: **Accept Flow's notices automatically** (ON by default) and **Keep Mac awake while running** (ON by default).
- **Show me in Flow** (rings the prompt box, Generate and the ingredient slot for a few seconds, using the §17 ring) and **Test one prompt** (sets Flow's settings and types a test prompt, checks Generate is ready, then clears it — no picture made, my call).

**Files tab**
- Count of saved scenes/pictures and a small grid of chosen pictures.
- Download folder (default `Downloads/<video name>`), naming format (default `Slide_01_00m00s-00m03s.png`; also `Slide_01_00-00_to_00-03`, `Slide_01_00s-03s`, `00m00s-00m03s_Slide_01`, `Slide_01`), **Chosen picture only** / **Both options**.
- Switch "Save automatically as each scene finishes" (off by default — my call; Checks shows it too). Exports: **Slide list (CSV)** (slide, timecode, sentence, status, file name) and **Timing file** (JSON of slide, start, end, sentence, file name — for voice alignment later).
- "Coming next: Clips · Voice · Finished video". Coral **Download all N pictures**.

**§10 change (Hayatudeen, 5 Nov 2026):** VidFlow is agreed automation on his account. With "Accept Flow's notices automatically" on, VidFlow ticks and accepts Flow's usage-policy / rights notices itself (logging "Accepted Flow's notice" in the activity) instead of pausing; with it off, it pauses and asks as before. It still waits for Generate to be ready rather than force-enabling it (reliability: a forced press is ignored or fails).

**Not in this round:** the "‹" collapse-to-rail from the mockup — Chrome sets the side panel's width, so an extension can't shrink it (my call; the tabs keep it compact). Morph/dark-mode toggles (VidFlow has one look). Upload of DOC/DOCX.

**§19 details settled after the builder check (my calls unless marked):**
1. *Which notices are auto-accepted:* only Flow's usage-policy / rights / upload notices, matched by a narrow allowlist. Anything about billing, payment, upgrades or paid tiers still **stops with a plain message** (§16.2, his "no paid services" rule), and any unknown dialog pauses as today.
2. *▶ Run, Retry failed, Skip:* ▶ Run and Retry failed use the existing retry path (a run of just those scenes in a fresh Flow project, §16.5). Both are disabled while a run is running or paused (the button says why). Skip works on the current scene even if it was already sent: it ends as failed "Skipped by you", its prompt is recorded so any pictures Flow still makes for it are never saved to another scene, and the run moves on. Try again in the studio now makes just that scene too (with no run of the video going, a run of that one scene, as ▶ Run does).
3. *Where Checks get their facts:* only from VidFlow's own Flow tab when it is open. With none open, rows show "Not checked yet" and an **Open Flow** button opens VidFlow's Flow window (no project made). Start always runs the checks first and stops on a failing one with its plain reason. The health line shows "VidFlow's Flow window not open" in that case.
4. *Test one prompt / Show me in Flow:* refused while a run is live (Test one prompt also while a run is paused or a Start is under way, saying which). Test one prompt uses VidFlow's Flow window and opens a fresh Flow project if it isn't on one (no picture made). Show me in Flow rings whatever of the three it finds and says which it couldn't.
5. *Cost and time:* pictures are always 0 credits on Pro (§16.6); time ≈ 20 s per scene (measured: ~2 min per 6 scenes), shown rounded ("~9 min").
6. *Downloads:* always under the Downloads folder (`chrome.downloads` can't write elsewhere); the folder field is a sub-folder name. Existing names get a number added (uniquify), never overwritten. Names use the scene's own timecode (no timecode → `Slide_01`). "Both options": the chosen one has the plain name, the other gets `_option2`. Download all and auto-save skip files VidFlow already downloaded for that video unless he presses Download all again with "Download again" confirmed.
7. *Settings scope:* accept-notices, keep-awake, auto-save and naming format are global (settings.ts). Folder name is per video (defaults to the video's name). Make model sheet is the existing model-sheet run with its busy/paused messages.
8. *PDF:* pdf.js (`pdfjs-dist`) is added, worker bundled with the extension. Up to 20 MB; a PDF with no readable text (scanned) shows "This PDF has no text VidFlow can read. Paste the scenes instead."

**§19 known limits (Queue, Skip):**
- *Phantom tiles from an unconfirmed-then-skipped scene:* if a scene is skipped after Generate was pressed but before VidFlow saw Flow start it, VidFlow doesn't know whether Flow took it, so it keeps no place for it in the order. If Flow did start it, its pictures arrive with no scene owning them. Each picture's detail prompt is still checked before saving, so they are never saved to another scene, but a later scene may wait (or need Try again) while its own pictures are matched around them.
- A skipped submission keeps its place for one scene deadline (10 minutes); after that, Flow is assumed not to draw it.
