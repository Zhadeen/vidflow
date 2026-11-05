import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRefresher, liveView, placeLive, renderLive } from '../../src/flow/live';
import type { LiveView } from '../../src/flow/messages';
import type { Step } from '../../src/runs/activity';
import type { RunState } from '../../src/runs/run';
import type { Project } from '../../src/store/projects';

const fixture = (name: string) => readFileSync(resolve(__dirname, '../fixtures/flow', name), 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('[id^="vidflow-"]')) el.remove();
});

const project = {
  id: 'p',
  scenes: [
    { id: 's1', slide: 1 },
    { id: 's2', slide: 2 },
    { id: 's3', slide: 5 },
  ],
} as unknown as Project;
const state: RunState = {
  projectId: 'p',
  status: 'running',
  inFlight: ['s2'],
  sceneStates: {
    s1: { sceneId: 's1', status: 'done', pictureIds: ['a', 'b'], cardKeys: ['k1', 'k2'] },
    s2: { sceneId: 's2', status: 'submitted', pictureIds: [] },
    s3: { sceneId: 's3', status: 'pending', pictureIds: [] },
  },
};
const step = (over: Partial<Step> = {}): Step => ({ projectId: 'p', sceneId: 's3', text: 'Pressing Generate', target: 'generate', at: 1, ...over });

describe('liveView', () => {
  it('names the scene by its slide and lists saved pictures with their scene', () => {
    expect(liveView(state, step(), project)).toEqual({
      n: 2,
      total: 3,
      paused: false,
      step: 'Pressing Generate',
      scene: 3, // its place in the run ("Scene 3 of 3"), not its slide number (5)
      saved: 1,
      drawing: 1,
      toGo: 1,
      highlight: { target: 'generate', scene: 5 },
      savedCards: [
        ['k1', 1],
        ['k2', 1],
      ],
    });
    expect(liveView(state, step({ sceneId: null, text: 'Set Flow to Image · 16:9 · 2 pictures', target: 'setting' }), project)).toMatchObject({
      step: 'Set Flow to Image · 16:9 · 2 pictures',
      scene: null,
      highlight: { target: 'setting', scene: null },
    });
    expect(liveView(state, step({ target: 'tile', key: 'k9' }), project)?.highlight).toEqual({ target: 'tile', key: 'k9', scene: 5 });
  });

  it('numbers the pill by place in the run when slide numbers skip (never "Scene 9 of 3")', () => {
    const skipping = { scenes: [{ id: 's1', slide: 1 }, { id: 'gone', slide: 2 }, { id: 's2', slide: 4 }, { id: 's3', slide: 9 }] } as unknown as Project;
    const view = liveView(state, step({ sceneId: 's3' }), skipping)!;
    expect(view.scene).toBe(3);
    expect(view.total).toBe(3);
    const second = liveView(state, step({ sceneId: 's2' }), skipping)!;
    expect(second.scene).toBe(2);
  });

  it("ignores another project's step, and the step while paused", () => {
    expect(liveView(state, step({ projectId: 'other' }), project)).toMatchObject({ step: null, highlight: null });
    expect(liveView({ ...state, status: 'paused' }, step(), project)).toMatchObject({ step: null, highlight: null });
    expect(liveView(null, step(), project)).toBeNull();
  });
});

describe('renderLive', () => {
  const view: LiveView = {
    n: 2,
    total: 3,
    paused: false,
    step: 'Pressing Generate',
    scene: 3,
    saved: 1,
    drawing: 1,
    toGo: 1,
    highlight: { target: 'generate', scene: 3 },
    savedCards: [['4ca91b00-de41-44e5-ab6c-85c484c751ab', 1]],
  };

  it('switching live activity off removes ring and badges but keeps the pill', () => {
    vi.useFakeTimers();
    document.body.innerHTML = fixture('prompt-bar.html') + fixture('tiles.html');
    renderLive(document, view, true, vi.fn());
    expect(document.getElementById('vidflow-pill')).not.toBeNull();
    expect(document.getElementById('vidflow-highlight')).not.toBeNull();
    expect(document.getElementById('vidflow-badges')).not.toBeNull();

    renderLive(document, view, false, vi.fn());
    vi.advanceTimersByTime(400);
    expect(document.getElementById('vidflow-pill')).not.toBeNull();
    expect(document.getElementById('vidflow-highlight')).toBeNull();
    expect(document.getElementById('vidflow-badges')).toBeNull();

    renderLive(document, null, true, vi.fn());
    expect(document.getElementById('vidflow-pill')).toBeNull();
    vi.useRealTimers();
  });
});

describe('placeLive with live activity off', () => {
  it('still re-places the pill (resize / page changes) though ring and badges stay off', () => {
    renderLive(document, { n: 1, total: 3, paused: false, step: null, scene: null, saved: 0, drawing: 0, toGo: 3, highlight: null, savedCards: [] }, false, vi.fn());
    const host = document.getElementById('vidflow-pill')!;
    expect(host.style.bottom).toBe('16px');
    // Flow's prompt bar now sits under the pill (e.g. after a resize).
    const bar = document.createElement('flow-base-prompt-box');
    bar.getBoundingClientRect = () => ({ left: 0, right: 1000, top: window.innerHeight - 100, bottom: window.innerHeight, width: 1000, height: 100, x: 0, y: 0, toJSON: () => ({}) });
    document.body.append(bar);
    placeLive(document, { n: 1, total: 3, paused: false, step: null, scene: null, saved: 0, drawing: 0, toGo: 3, highlight: null, savedCards: [] }, false);
    expect(host.style.bottom).toBe('108px');
    expect(document.getElementById('vidflow-highlight')).toBeNull();
  });
});

describe('createRefresher', () => {
  const deferred = <T>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const pill = (n: number) => ({ n }) as unknown as LiveView;

  it('ignores a reply that arrives after a newer one', async () => {
    const asks = [deferred<LiveView | null>(), deferred<LiveView | null>()];
    let i = 0;
    const apply = vi.fn();
    const refresh = createRefresher(() => asks[i++]!.promise, async () => true, apply);
    const first = refresh();
    const second = refresh();
    asks[1]!.resolve(pill(2));
    await second;
    asks[0]!.resolve(pill(1)); // the older reply comes in last
    await first;
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(pill(2), true);
  });

  it('ignores an older reply whose switch read finishes last', async () => {
    const settings = [deferred<boolean>(), deferred<boolean>()];
    let i = 0;
    const apply = vi.fn();
    const refresh = createRefresher(async () => pill(1), () => settings[i++]!.promise, apply);
    const first = refresh();
    await Promise.resolve();
    await Promise.resolve();
    const second = refresh();
    await Promise.resolve();
    await Promise.resolve();
    settings[1]!.resolve(false);
    await second;
    settings[0]!.resolve(true);
    await first;
    expect(apply.mock.calls).toEqual([[pill(1), false]]);
  });

  it('a failed ask counts as no run', async () => {
    const apply = vi.fn();
    await createRefresher(async () => Promise.reject(new Error('reloaded')), async () => true, apply)();
    expect(apply).toHaveBeenCalledWith(null, true);
  });
});
