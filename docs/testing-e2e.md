# End-to-end test hook (development only)

`npm run build:e2e` builds `.output/chrome-mv3` with a small trigger compiled in (`wxt build --mode e2e`, gated on `import.meta.env.MODE === 'e2e'`). The normal `npm run build` removes it entirely: `npm run build` followed by `npm run check:prod-clean` fails if the marker string `vidflow-e2e` appears anywhere in the output. Never ship the e2e build.

Both builds write to the same folder (`.output/chrome-mv3`), so the VidFlow loaded in Chrome is whichever was built last.

## After testing: put the normal build back

When the end-to-end test is done, always:

1. Run `npm run build` (the normal build, which overwrites the e2e build in `.output/chrome-mv3`).
2. Run `npm run check:prod-clean`. It must pass (it fails if `vidflow-e2e` or `e2e/start` is anywhere in the output).
3. In `chrome://extensions`, press the reload button on VidFlow, so Chrome drops the e2e build it had loaded.

Until you do, the VidFlow in Chrome still has the test trigger in it.

## How the tester drives it

Run in the page console (or via automation) on any `https://flow.google.com/*` tab. Post to the same window; read the answer from a `message` event.

```js
window.addEventListener('message', (e) => { if (e.data?.type === 'vidflow-e2e-result') console.log(e.data); });
window.postMessage({ type: 'vidflow-e2e', action: 'start', name: 'E2E', csv: '<scene file text>', style: 'stickman-whiteboard', aspect: '16:9', outputsPerPrompt: 2 }, '*');
window.postMessage({ type: 'vidflow-e2e', action: 'status' }, '*');
window.postMessage({ type: 'vidflow-e2e', action: 'picture', mediaId: '<id from status>' }, '*');
```

### Requests

- `start`: `{ type:'vidflow-e2e', action:'start', name, csv, style?, aspect?, outputsPerPrompt? }`. Parses the file with `parseSceneFile`, creates the project, then starts the run through the same `startRun` the studio uses.
- `status`: `{ type:'vidflow-e2e', action:'status', projectId? }` (defaults to the current run's project).
- `picture`: `{ type:'vidflow-e2e', action:'picture', mediaId }`.

### Replies

`{ type:'vidflow-e2e-result', action, ok:true, data }` or `{ type:'vidflow-e2e-result', action, ok:false, error }`.

- `start` data: `{ projectId, sceneCount, issues }`
- `status` data: `{ projectId, run /* RunState or null */, runSummary /* {done, refused, failed, pending} or null */, scenes: [{ sceneId, status, message?, pictureCount, pictureIds }] }`
- `picture` data: `{ mediaId, dataUrl }`

Messages are ignored unless `event.source === window`. The background only answers VidFlow's own content script in a Flow tab (`sender.id`, `sender.tab` and a `flow.google.com` / `labs.google` sender URL are checked).
