import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveView, renderLive } from '../../src/flow/live';
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
      scene: 5,
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
