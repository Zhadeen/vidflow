// Draws VidFlow's Flow-page overlays on the stand-in page for tests/visual/live-activity.mjs.
import { renderLive } from '../../src/flow/live';
import type { LiveView } from '../../src/flow/messages';

const params = new URLSearchParams(location.search);
const target = (params.get('target') ?? 'generate') as 'generate' | 'tile' | 'prompt';
const view: LiveView = {
  n: 4,
  total: 6,
  paused: false,
  step: target === 'tile' ? 'Checking picture 1 of 2 matches its prompt' : target === 'prompt' ? 'Typing the prompt' : 'Pressing Generate',
  scene: target === 'tile' ? 2 : 3,
  saved: 2,
  drawing: 2,
  toGo: 2,
  highlight: target === 'tile' ? { target: 'tile', key: 'k-check', scene: 2 } : { target, scene: 3 },
  savedCards: [
    ['k-saved-1', 1],
    ['k-saved-2', 1],
  ],
};
const w = window as unknown as { presses: number; ready: boolean };
w.presses = 0;
document.getElementById('generate')!.addEventListener('click', () => w.presses++);
await new Promise((r) => setTimeout(r, 50));
renderLive(document, view, params.get('live') !== 'off', () => undefined);
w.ready = true;
