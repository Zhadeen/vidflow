# Panel upgrade live check (5 Nov 2026)

Owner's Flow Pro (unscripted4ce), e2e build of feat/panel-upgrade at 29f868c (Start checks now installed in the e2e build too).

| Check | Result |
|---|---|
| Start goes through the new checks (account, page, Agent off, hero reference) | ✅ The 3-scene start passed its checks and ran. |
| 3 scenes × 2 with the hero reference | ✅ 3/3 done, 6 pictures, red-capped hero in every one, each matches its scene (laptop, surprised by the email, phone by the window) — `e2e/panel-upgrade-run-pictures.jpg`. |
| Agent mode | Stayed off. |

**Not driven by me** (the side panel is an extension page Chrome won't let automation click): the Setup, Queue, Checks and Files buttons themselves — Skip, ▶ Run, Retry failed, Download all, exports, Open Flow, Show me in Flow, Test one prompt, the switches. They are covered by 596 unit tests and the build-check screenshots; the owner tries them by hand on the normal build. Flow's real usage notice didn't appear in this run, so auto-accept on the real notice is still unconfirmed live (fixtures only); billing is never clicked by design.
