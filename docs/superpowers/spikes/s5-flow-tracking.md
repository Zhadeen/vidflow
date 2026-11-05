# Spike S5 — Flow controls and result tracking

**Date:** 5 Nov 2026. **Account:** unscripted4ce@gmail.com (Google AI Pro, "PRO" badge). **Page:** `https://flow.google.com/u/0/project/<projectId>`. Flow is an Angular app (`_ngcontent-*`, Angular Material, `cdk-virtual-scroll`).

## Selectors (stable: roles and aria-labels)

| Thing | Selector | Notes |
|---|---|---|
| New project (home) | `button` with text "New project" | lands on `/project/<uuid>` |
| Prompt input | `[role="textbox"][aria-label="What do you want to create?"]` (contenteditable div inside `flow-rich-text-editor`) | empty state is `<p><br></p>` |
| Generate | `[aria-label="Start generation"]` | `disabled` true while the box is empty |
| Settings popover trigger | `[aria-label="Settings trigger"]` | its text shows current model / aspect icon / count, e.g. `🍌 Nano Banana 2.1 crop_16_9 x2` |
| Image/Video switch | first `[role="radiogroup"]` in the popover; radios "Image", "Video" | `aria-checked` |
| Aspect ratio | second radiogroup; radios `16:9`, `4:3`, `1:1`, `3:4`, `9:16` | **default is 9:16** — that is why Flow Flash's pictures were portrait |
| Outputs per prompt | third radiogroup; `x1` `x2` `x3` `x4` | default x2 |
| Model picker | dropdown in the popover ("Nano Banana 2.1") | |
| Credit cost | popover text "Generating will use N credits" | **images with Nano Banana 2.1 cost 0 credits on Pro** |
| Reference / Ingredient | `[aria-label="Add ingredients to the prompt box"]` (`aria-haspopup`) | upload path not explored yet — Task 7 must explore |
| Signed-in account | element whose `aria-label` starts `Google Account: <Name> (<email>)` | parse email from parentheses |
| Plan badge | `[aria-label="Account details"]` with text `PRO` | |
| Result tiles | inside `.cdk-virtual-scroll-content-wrapper`; each image has `data-media-id="<uuid>"`; `img.src` = `https://flow-content.google/image/<same uuid>…` | **virtual scroll** — only visible tiles are in the DOM |
| In-progress tile | shows a percentage ("10%") and, while generating, the prompt as caption | |
| Picture detail | clicking a tile opens `/project/<p>/edit/<generationId>`; shows the **full original prompt** and a download button | the edit id differs from `data-media-id` |

## Input method

- Setting controls (aspect radios, image/video switch) **works with plain DOM `.click()`** from page/content script.
- Typing: `box.focus(); document.execCommand('selectAll'); document.execCommand('insertText', false, text)` fills the box and enables Generate.
- **Generate ignores synthetic events.** `.click()` and a full synthetic pointer/mouse sequence did nothing. A real (trusted) click worked immediately.
- **Conclusion:** VidFlow needs trusted input for the Generate press → add the `debugger` permission and press Generate with `Input.dispatchMouseEvent` (mousePressed/mouseReleased at the button centre) on VidFlow's own Flow tab only. Typing and settings can stay plain DOM. This is allowed by the design §10 boundary ("including via Chrome's debugger input if normal clicks are unreliable"); VidFlow still waits for Generate to be enabled and never force-enables it. Chrome shows a "VidFlow started debugging this browser" bar while attached — detach when a run pauses/finishes.

## Matching results to prompts

- **Captions can't be used.** While generating, a tile's caption is the prompt; when finished, Flow replaces it with a short AI title ("Stickman riding bicycle up hill", "Stickman waves by window"). Two outputs of the same prompt get different titles.
- **Order:** tiles are listed newest-submission first; the N outputs of one submission sit together. Three back-to-back submissions (P1, P2, P1-again; x2 each) ended up as [P1-again ×2, P2 ×2, P1 ×2] from the top.
- **Ids:** every finished tile has `data-media-id`, and the picture URL contains the same id.
- **Rule for Task 8:**
  1. VidFlow runs in **its own fresh Flow project per run** (New project), so no foreign tiles exist.
  2. Before each submit, record the set of known media ids. After submit, new ids that appear are assigned to the **oldest submission still missing outputs**, in submission order; tiles are read by scrolling the virtual list (or, preferably, by the network data below).
  3. **Verification:** before saving, open the tile's detail (`/edit/…`) and compare the full prompt with the submitted prompt. If it doesn't match, re-assign. This is slow (~2 s per picture) but makes a wrong-scene save impossible; it can be limited to scenes with duplicate prompts or any ordering doubt.
  - Open question for Task 7: whether Flow's own generate request/response (page network) carries prompt → media ids; if so, a main-world fetch hook gives exact matching without opening details. Not captured in this spike (network tracking started late).

## Messages

- Quota/limit and refusal wording were **not triggered** in this spike (pictures cost 0 credits; no refusal). Task 7 keeps Flow Flash's patterns (rate limit / quota / credits / "try again later" / "content policy" / "safety") and must log unknown messages for later.
- Policy dialog: not seen on this account in this spike.

## Manifest changes this implies

- Add `debugger` (Generate needs trusted input — reason above).
- Add host `https://flow-content.google/*` so pictures can be fetched/downloaded.

## Fixtures

`tests/fixtures/flow/prompt-bar.html` and `tests/fixtures/flow/tiles.html` are hand-built from the observed DOM (live outerHTML is Angular-heavy and was truncated by the inspection tool); they keep the real roles, aria-labels, `data-media-id` attributes and image URL shape.
