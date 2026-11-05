# Spike S8 — Clips in Flow (5 Nov 2026)

Owner's Flow Pro (unscripted4ce). Throwaway Flow project "Nov 05 - 17:43". One 4 s test clip made (7 credits, approved).

## Settings (popover `[aria-label="Settings trigger"]`, radios read via `.toggle-text`)

After **Video**: groups are Mode **Frames** / Ingredients (default Ingredients) · Aspect 16:9 / 9:16 · Resolution 360p / 720p (default 720p) · Length 4s / 6s / 8s / 10s · Outputs x1–x4 (default x2). Model shown: Omni 1.1 Flash. Trigger text e.g. `Video · 720p · 4s crop_16_9 x1`.

**Cost:** the popover shows `span` inside `.credit-cost-label`: "Generating will use 7 credits" (x2 at 4 s = 14). Readable before every Generate.

## Start frame (Frames mode)

- The prompt bar shows `button.empty-chip` "Start", a swap button (`aria-label="Swap first and last frames"`), and `button.empty-chip` "End".
- Clicking **Start** opens an overlay (`.cdk-overlay-container`) titled "Select a frame image" with filters (Images, Uploads), **Upload media**, a search box, and the project's assets as `[role="option"]` (text `image\n<name>`). In a new project: "No assets found." and no options.
- **Upload** works as in S7: "Upload media" makes Flow click a `<input type=file>`; a capture-phase `preventDefault` stops the Mac file window; set `files` with a `DataTransfer` (`vidflow-s01.png`) + `change`. The asset appears as an option after a few seconds.
- **Picking the option attaches it at once** — there is **no "Add to prompt"** in this picker; the overlay closes.
- Attached: the Start slot becomes `button.chip-container[aria-label="Image ingredient"]` with `img.chip-image.cropped[alt="Ingredient image"]`; End stays `button.empty-chip`.
- **Generate clears** the start frame and the text (like the hero ingredient, S7): attach before every clip.
- The uploaded picture also becomes a grid tile (caption = file name) — exclude it from matching, as for the hero reference.

## Result tile and detail page

- While drawing: `flow-grid-tile-container` with the prompt as caption; when done, the tile is `flow-video-tile` inside `flow-tile-container`, caption renamed to an AI title ("Stickman with red cap waving"). **No `data-media-id` on video tiles** (the poster `img` is a `flow.google.com/asb/<token>` URL).
- Hover preview: a `<video>` with src `flow.google.com/asb/<token>=mm,22,15` (low-res preview).
- Clicking the tile opens `/u/0/project/<project>/edit/<editId>`: a video editor (canvas player, timeline showing 00:04:00), the prompt at `flow-expandable-prompt div.prompt-text span.text-part`, and toolbar buttons incl. `[aria-label="Download media"]`.
- **Download media** opens a menu (`[role="menuitem"]`): "270p Animated GIF", "**720p Original size**", "1080p Upscaled", "4K Upscaled" (Upgrade).

## Getting the clip file

- Fetching the preview `asb` URL — from the page, and from the extension background with its host permissions — fails ("Failed to fetch"; plain requests answer 503).
- Choosing **720p Original size** makes Flow's page fetch the file from a signed URL **`https://flow-content.google/video/<mediaId>?Expires=…&KeyName=…&Signature=…`** (media id of this clip `1fc37838-…`) and save it as `<AI title>_<id8>.mp4` in Downloads.
- That signed URL appears in `performance.getEntriesByType('resource')` and **can be fetched again** (200, `video/mp4`, 1,247 kB). `flow-content.google` is already in VidFlow's host permissions.
- File: H.264 1280×720 + AAC audio, **4.032 s** by its `mvhd` box (timescale 1000; Finder reports 4 s).

**Path for VidFlow:** on the clip's detail page (opened anyway to verify the prompt), press Download media → "720p Original size"; read the newest `flow-content.google/video/<id>` resource entry (the id also identifies the clip); fetch it from the background; cancel and erase the browser download Flow started (`chrome.downloads.onCreated` within a few seconds of the press, `.mp4` from flow.google.com) — and remove its file if it already finished — so nothing piles up in Downloads. Clip length = the file's `mvhd` duration (the service worker has no `<video>`).

## Credits

- `[aria-label="Account details"]` (on the project grid page, not the clip editor) opens a `[role="dialog"]` with `span` "1,043 Google Flow credits" (inside `.credits-link`) and `span` "Resets on 13 Nov at 13:50"; it closes with `[aria-label="Close account panel"]` (Escape doesn't close it).
- The balance still read **1,043 right after the 7-credit clip** — the panel may update late. VidFlow therefore reads the balance once before a Motion run and **tracks its own spending** from each clip's popover cost; it never trusts a re-read mid-run.

## Agent panel (recorded live, 5 Nov 2026, after Task 3)

- Turning on `.agent-mode-chip` and sending opens `flow-agent-panel` > `div.agent-panel-wrapper` > `div.agent-panel-content` > `flow-chat-view` > `flow-chat-scroller` > `div.scroll-viewport` > `div.messages-list`.
- Messages are `div.message-row` rows: the owner's are `.message-row.user-row` (text in `span.structured-prompt-text`), the Agent's are `.message-row.agent-row` > `flow-chat-bubble` > `div.agent-bubble` > `div.agent-message-content` > `flow-a2ui-message-renderer` > … > `flow-markdown-content` > `div.markdown-container` > `p` (the answer text, e.g. "OK"). A "Show thinking" toggle sits above some answers. Each answer has buttons Good response / Bad response / Copy / Flag output.
- Read the reply as the text of the **last `.agent-row`** added after sending (count rows before sending; wait for a new one with non-empty `.markdown-container`). ~15 s for a one-word answer.
- Panel header buttons: `Open session history`, **`Start new session`** (use it before each Auto-pick pass so earlier answers can't sway the next), **`Close`** (closes the panel).
- When the panel is open, the prompt bar moves into it: it keeps the same `[role="textbox"][aria-label="What do you want to create?"]`, `[aria-label="Add ingredients to the prompt box"]` and send button `[aria-label="Start generation"]`; attached pictures show as `button.chip-container[aria-label="Image ingredient"]`. Clear any leftover chip before attaching.
- After Close, turn `.agent-mode-chip` off (`aria-pressed="false"`).

## Flow announcements

- Flow can show a "What's new" announcement over the page (5 Nov: "Introducing Omni 1.2!", buttons "View all changelogs" and **"Get started"**). It isn't a policy or billing notice. VidFlow should close it ("Get started") and carry on, logging "Closed Flow's announcement".
- Omni 1.2 ("rolling out over the next few weeks") promises video lengths up to 15 s with an exact number of seconds. On 5 Nov the settings still showed Omni 1.1 Flash with 4/6/8/10 s. When the length control changes, Plan 3's clip-length rule must be revisited (an exact length would let a clip match its slide without trimming).
