import { afterEach, describe, expect, it, vi } from 'vitest';
import { pillBottom, pillView, renderPill } from '../../src/flow/pill';
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
    expect(pillView(run('running', ['done', 'submitted', 'pending', 'pending']))).toEqual({
      n: 2,
      total: 4,
      paused: false,
    });
    expect(pillView(run('running', ['pending', 'pending']))).toEqual({ n: 1, total: 2, paused: false });
    expect(pillView(run('paused', ['done', 'refused', 'failed']))).toEqual({ n: 3, total: 3, paused: true });
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

describe('renderPill', () => {
  it('shows the plain copy and a coral Pause button', () => {
    const onToggle = vi.fn();
    const host = renderPill(document, { n: 2, total: 12, paused: false }, onToggle)!;
    const root = host.shadowRoot!;
    expect(root.textContent).toContain('VidFlow · Picture 2 of 12');
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
    const host = renderPill(document, { n: 3, total: 3, paused: true }, onToggle)!;
    host.shadowRoot!.querySelector('button')!.click();
    expect(onToggle).toHaveBeenCalledWith('resume');
    expect(renderPill(document, null, onToggle)).toBeNull();
    expect(document.getElementById('vidflow-pill')).toBeNull();
  });
});
