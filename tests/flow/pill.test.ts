import { afterEach, describe, expect, it, vi } from 'vitest';
import { pillBottom, pillView, renderPill, type PillView } from '../../src/flow/pill';
import type { RunState } from '../../src/runs/run';

const run = (status: RunState['status'], statuses: string[]): RunState => ({
  projectId: 'p',
  status,
  inFlight: [],
  sceneStates: Object.fromEntries(
    statuses.map((s, i) => [`s${i}`, { sceneId: `s${i}`, status: s as never, pictureIds: [] }]),
  ),
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('pillView', () => {
  it('counts the picture being worked on', () => {
    expect(pillView(run('running', ['done', 'submitted', 'pending', 'pending']))).toMatchObject({
      n: 2,
      total: 4,
      paused: false,
    });
    expect(pillView(run('running', ['pending', 'pending']))).toMatchObject({ n: 1, total: 2, paused: false });
    expect(pillView(run('paused', ['done', 'refused', 'failed']))).toMatchObject({ n: 3, total: 3, paused: true });
  });

  it('carries the step and the saved / being drawn / to go counts', () => {
    const state = run('running', ['done', 'done', 'submitted', 'submitted', 'pending', 'pending']);
    expect(pillView(state, { text: 'Pressing Generate', scene: 3 })).toEqual({
      n: 4,
      total: 6,
      paused: false,
      step: 'Pressing Generate',
      scene: 3,
      saved: 2,
      drawing: 2,
      toGo: 2,
    });
    expect(pillView(state)).toMatchObject({ step: null, scene: null });
  });

  it('hides when nothing is running', () => {
    expect(pillView(null)).toBeNull();
    expect(pillView(run('finished', ['done']))).toBeNull();
    expect(pillView(run('idle', ['pending']))).toBeNull();
  });
});

describe('pillBottom', () => {
  it('sits 16px from the bottom when the prompt bar is elsewhere', () => {
    expect(pillBottom({ left: 400, right: 1000, top: 700 }, 800, { left: 16, width: 220 })).toBe(16);
  });

  it('moves above the prompt bar when they would overlap', () => {
    expect(pillBottom({ left: 100, right: 1000, top: 700 }, 800, { left: 16, width: 220 })).toBe(108);
  });

  it('stays at the bottom when there is no prompt bar', () => {
    expect(pillBottom(null, 800, { left: 16, width: 220 })).toBe(16);
  });
});

const view = (over: Partial<PillView> = {}): PillView => ({
  n: 2,
  total: 12,
  paused: false,
  step: null,
  scene: null,
  saved: 0,
  drawing: 0,
  toGo: 12,
  ...over,
});
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('renderPill', () => {
  it('pill shows the step, progress and saved/drawing/to-go counts', () => {
    const host = renderPill(
      document,
      view({ n: 4, total: 6, step: 'Pressing Generate', scene: 3, saved: 2, drawing: 2, toGo: 2 }),
      vi.fn(),
    )!;
    const root = host.shadowRoot!;
    expect(text(root.querySelector('.title'))).toBe('VidFlow');
    expect(text(root.querySelector('.step'))).toBe('Scene 3 of 6 · Pressing Generate');
    expect(text(root.querySelector('.step b'))).toBe('Pressing Generate');
    expect(text(root.querySelector('.counts'))).toBe('2 saved · 2 being drawn · 2 to go');
    const track = root.querySelector<HTMLElement>('.track')!;
    expect(track.style.background).toBe('rgb(36, 52, 90)');
    const fill = root.querySelector<HTMLElement>('.fill')!;
    expect(fill.style.width).toBe('50%'); // (2 saved + half of the 2 being drawn) of 6
    expect(fill.style.background).toBe('rgb(244, 237, 224)');
  });

  it('shows a step that is not about one scene as it is', () => {
    const host = renderPill(document, view({ step: 'Set Flow to Image · 16:9 · 2 pictures' }), vi.fn())!;
    expect(text(host.shadowRoot!.querySelector('.step'))).toBe('Set Flow to Image · 16:9 · 2 pictures');
  });

  it('only the Pause button takes clicks', () => {
    const host = renderPill(document, view(), vi.fn())!;
    expect(host.style.pointerEvents).toBe('none');
    expect(host.shadowRoot!.querySelector('button')!.style.pointerEvents).toBe('auto');
  });

  it('shows the plain copy and a coral Pause button', () => {
    const onToggle = vi.fn();
    const host = renderPill(document, view(), onToggle)!;
    const root = host.shadowRoot!;
    expect(text(root.querySelector('.step'))).toBe('Picture 2 of 12');
    const button = root.querySelector('button')!;
    expect(button.textContent).toBe('Pause');
    expect(button.style.background).toBe('rgb(255, 107, 91)');
    expect(button.style.color).toBe('rgb(20, 33, 61)');
    const pill = root.querySelector<HTMLElement>('.pill')!;
    expect(pill.style.background).toBe('rgb(20, 33, 61)');
    expect(pill.style.color).toBe('rgb(244, 237, 224)');
    button.click();
    expect(onToggle).toHaveBeenCalledWith('pause');
  });

  it('offers Resume when paused, and removes itself when hidden', () => {
    const onToggle = vi.fn();
    const host = renderPill(document, view({ n: 3, total: 3, paused: true }), onToggle)!;
    host.shadowRoot!.querySelector('button')!.click();
    expect(onToggle).toHaveBeenCalledWith('resume');
    expect(renderPill(document, null, onToggle)).toBeNull();
    expect(document.getElementById('vidflow-pill')).toBeNull();
  });
});
