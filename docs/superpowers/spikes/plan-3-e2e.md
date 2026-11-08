# Plan 3 live check (8 Nov 2026) — in progress

Owner's Flow Pro (unscripted4ce), e2e build of feat/plan-3. Driven through the e2e hook, which now also has `make-clips`
(picks + limit, the panel's Make clips path), `auto-pick` (the panel's Auto-pick path), and per-slide clip / Auto-pick
fields plus the last 25 activity lines in `status`.

## Step 2: pictures → Auto-pick (3 slides, 16:9, 2 pictures each, hero described)

| Check | Result |
|---|---|
| Pictures | ✅ 3/3 slides, 6 pictures; Auto-pick started by itself after the run (switch on by default). |
| Auto-pick | ✅ After four fixes (below): **slide 1 auto-picked (picture 1), slide 2 auto-picked (picture 1, "kitchen table setting…"), slide 3 "not auto-checked"** (an answer that didn't name one picture). "Finished: auto-picked 2 of 3 slides". |
| Agent mode off after | ✅ No "Flow's Agent panel didn't close" line: `finishAgent` confirmed the panel closed and Agent mode off. |
| Credits | 0 (pictures and Agent text answers are free; balance stayed 1,050). |

Fixes found on the way (each test-first):

1. `00127ed` — Auto-pick uploaded its pictures through the clip **Start slot**, which only exists in Video · Frames; after a
   picture run Flow is in Image mode, so every Auto-pick paused. Now through the ingredients picker.
2. `1925c2d` — Flow's **"Add to prompt" adds the highlighted asset**, not the last one clicked, and the list can redraw
   after opening with the newest upload highlighted again: the first slot got the wrong picture (a silent wrong pick).
   Add is now pressed only once every picture still to attach is listed, Add is enabled, and the wanted one is the
   highlighted one. The hero reference attach uses the same check.
3. `230a57c` — Flow draws the answer "2. reason" as a **numbered list** (`<ol start="2"><li>reason</li></ol>`; no
   `start` = 1), whose number isn't text, so every answer read as unusable ("didn't answer three times in a row").
   Also, **Flow keeps the Agent conversation** and shows earlier answers again when the panel opens: the reply is now the
   first Agent row after the row that asked this exact question (never a row count), and a new session is started before
   the panel closes. A list of several items never reads as a pick.
4. Live items from §5 settled: the Agent's send is only pressed after `agentReady` (it passed every time); its panel
   prompt is the page's prompt box until the first send.

## Step 3: clips for 2 picked slides (limit 14)

| Check | Result |
|---|---|
| Credits read | First paused "can't read your Flow credits": the balance was read right after a **new Flow project** opened, before its header was drawn. Fixed in `3508aec` (waits for Account details). Then read 1,050. |
| Start picture | Paused "couldn't attach the start picture": the clips run's new Flow project was in **Image mode** (left by Auto-pick), which has no Start slot. Fixed in `66b0278` (switches to Video · Frames first when no Start slot shows). Not proven live: I had switched Flow to Video · Frames by hand in a second tab just before, which Flow may remember. |
| Clips | ❌ **Both clips were refused by Flow**: each tile shows "Failed — We noticed some unusual activity. Note that browser extensions that modify the page may cause issues. Please visit the Help Centre for more information." (`e2e/plan-3-clips-unusual-activity.jpg`). **No credits spent** (balance still 1,050 after). The run was stopped. |
| VidFlow noticed | ❌ No: Flow's "Failed" tile isn't in `REFUSAL_PATTERN`, so the run kept waiting ("0 made · 2 being made"). Its run counter says 14 spent (Flow charged nothing). Needs a fix once the failed tile's markup is captured (it only shows in the tab that pressed Generate). |

Not done yet: clip lengths ≈ 4 s, use range = slide length, "picture changed" after a swap; Download / "720p Original
size" clicks; the multiple-downloads bar.
