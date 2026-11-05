# VidFlow design

The owner approved this look on 5 Nov 2026: **B · Navy with cream** (`docs/design/approved/visual-style-v2.html`,
screenshot `docs/design/approved/approved-look-navy-cream.png`) and layout **C · Steps on top, editor below**
(`docs/design/approved/studio-layout.html`). **Any visual change needs the owner's approval first.** Polish (spacing,
contrast, states, copy) may happen inside these rules; restyling may not.

Tokens live in `src/studio/theme/tokens.css`; components in `src/studio/theme/studio.css`. Use the tokens by name;
never write a colour literal in a component.

## Colour

Three colours, plus shades of navy for surfaces and borders. No greys, no other hues, no tints over pictures.

| Token | Value | Use |
|---|---|---|
| `--vf-navy` | `#14213D` | Page background |
| `--vf-navy-sunken` | `#101B33` | Inputs, wells, empty picture frames, timeline track |
| `--vf-navy-raised` | `#1B2A4C` | Cards and panels (picture cards, project rows) |
| `--vf-navy-pill` | `#22325A` | Done step pill, selected choice, disabled primary |
| `--vf-navy-line` | `#24345A` | Hairlines between areas |
| `--vf-navy-line-strong` | `#2C3D66` | Card and input borders |
| `--vf-navy-hover` | `#2A3B63` | Hover fill on navy controls |
| `--vf-cream` | `#F4EDE0` | Main text, active step pill, secondary-button outline, focus ring, selection outline |
| `--vf-cream-soft` | `#E2DCCF` | Status sentence, done-pill text |
| `--vf-cream-muted` | `#C9C3B6` | Secondary text |
| `--vf-muted` | `#A9B0C2` | Upcoming steps, hints, placeholders, disabled text |
| `--vf-coral` | `#FF6B5B` | The one primary action per screen; "★ Best match" |
| `--vf-coral-hover` / `--vf-coral-pressed` | `#FF7D6F` / `#F25A4A` | Primary hover / pressed |
| `--vf-on-coral` | `#14213D` | Text on coral: always navy, never white |
| `--vf-glow` | coral radial, 20% → 0 at 55%, centred 85% 0% | The soft glow in the top-right corner of the page; the only gradient |

Contrast (WCAG AA, computed): cream on navy 13.7:1; cream-muted on raised navy 8.1:1; muted on navy 7.4:1 and on
navy-pill 5.8:1; navy on coral 5.7:1 (hover 6.4:1, pressed 4.8:1).

## Type

System sans (`-apple-system, 'Inter', system-ui`). Monospace (`--vf-font-mono`) only for pasted scene-file data.

| Token | Size | Use |
|---|---|---|
| `--vf-text-xs` | 12px | "Coming next" note |
| `--vf-text-sm` | 14px | Hints, secondary lines, small buttons |
| `--vf-text-md` | 16px | Body, buttons, step pills, status sentence |
| `--vf-text-lg` | 18px | Card titles ("Option 1 of 2"), project name |
| `--vf-text-xl` | 22px | Wordmark "〰 VidFlow", key numbers |
| `--vf-text-2xl` | 28px | Projects home heading |

Weights: 400 body, 600 labels/buttons/active pill, 700 wordmark, titles and primary button. Line height 1.5.

## Radii and spacing

Radii: 8px inputs and scene tiles; 12px buttons and picture cards; 16px panels; pill (999px) for step pills and
"★ Best match". Spacing on a 4px grid: 4, 8, 12, 16, 20, 24, 32, 40 (`--vf-space-*`). Page gutter 32px (16px under
900px wide); content max width 1280px.

## Layout (C)

1. Header: "〰 VidFlow" wordmark top-left (goes back to the projects list), project name top-right.
2. Step pills across the top: Script, Voice, Pictures, Motion, Edit, Export.
   - done: navy pill with "✓ Label"; active: cream pill, navy text, live count ("Pictures 38/60");
     upcoming: plain muted text.
   - Steps not built yet are plain text, not clickable, and a small line under the bar says they are coming next.
3. Editor: preview (the selected scene's picture cards) on the left two-thirds; scene grid on the right, as tall as
   the preview and scrolling inside; the timeline (one segment per scene, width from its length) underneath.
4. One status sentence under the cards ("Scene 02 · "…" — Flow is making the rest. You can leave this tab.").
5. Notices, then the action row: one full-width coral primary; outlined cream secondary beside it ("Pause").

Under 900px wide everything stacks in one column.

## Pictures

Picture cards sit on `--vf-navy-raised` with a strong-line border; the picture is at **full brightness** — no overlay,
fog, tint or dimming, ever. Picture frames keep the project's aspect ratio. Selection is shown with an outline
(cream on tiles and timeline) or, for the chosen picture, a 2px coral border plus the coral "★ Best match" badge with
navy text (`.vf-option[data-best='true']`, Plan 2).

## Buttons

| Variant | Look | Rule |
|---|---|---|
| `primary` (`data-variant="primary"`) | Coral fill, navy bold text, full width, 52px tall, 12px radius | Exactly one per screen |
| `secondary` | Transparent, 1.5px cream outline, cream text | Everything else (Pause, Copy Claude Prompt, Open, Try again) |

The five states, for every interactive element:

- **Hover:** primary → `--vf-coral-hover`; secondary and navy controls → `--vf-navy-hover` fill; inputs and choices →
  `--vf-muted` border.
- **Focus (keyboard):** 2px navy gap + 2px cream ring (`--vf-focus`). Never removed without this replacement.
- **Pressed:** 1px down; primary → `--vf-coral-pressed`; secondary → `--vf-navy-pill` fill.
- **Disabled:** primary → navy-pill fill with muted text (a faded coral reads as a new colour, so coral is not dimmed);
  secondary → strong-line outline with muted text; `not-allowed` cursor; a hint nearby says why.
- **Loading:** spinner in the current text colour before the label, label kept, `aria-busy`, repeat presses blocked.

## Motion

Short colour transitions (160ms, ease-out). A scene Flow is working on breathes softly. Everything respects
"reduce motion".

## Copy

- Plain, short sentences. Say what happens and what to do next.
- Every error says what went wrong and the next step ("Flow is signed in to …. Switch Flow to …, then press Resume.").
- Messages from the background (Flow's refusal reasons, pause reasons, account checks) are shown word for word.
- Buttons name their action: "New project", "Copy Claude Prompt", "Continue to Pictures →", "Start making pictures",
  "Pause", "Resume", "Try again".
- Before a picture run, say: how many pictures, that pictures cost 0 Flow credits, that a separate Flow window opens,
  that Chrome shows a "VidFlow started debugging this browser" bar while it runs, and that he can leave the tab.
- No jargon (no "run", "queue", "CSV" in owner-facing text where a plain word works).

## Build check

`node tests/visual/shoot.mjs` renders every studio screen with fixture data and saves screenshots to
`docs/design/build-check/` for comparison with the approved screenshot.
