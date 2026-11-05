import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findTarget, renderHighlight, TAG, tagFor } from '../../src/flow/highlight';
import { SEL } from '../../src/flow/selectors';

const fixture = (name: string) => readFileSync(resolve(__dirname, '../fixtures/flow', name), 'utf8');

/** jsdom has no layout: give an element a box. */
function box(el: Element, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
}
const host = () => document.getElementById('vidflow-highlight');
const rings = () => [...(host()?.shadowRoot?.querySelectorAll<HTMLElement>('.ring') ?? [])];
const liveRings = () => rings().filter((r) => !r.classList.contains('leaving'));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('[id^="vidflow-"]')) el.remove();
});

describe('TAG', () => {
  it('has the plain tag for each kind of target', () => {
    expect(TAG).toEqual({
      project: 'Opening a new project',
      setting: 'Setting this',
      prompt: 'Typing here',
      generate: 'Pressing Generate',
      tile: 'Checking it matches scene N…',
    });
    expect(tagFor('tile', 2)).toBe('Checking it matches scene 2…');
    expect(tagFor('generate', 2)).toBe('Pressing Generate');
  });
});

describe('findTarget', () => {
  it('finds the prompt box, settings, Generate and a tile by its picture', () => {
    document.body.innerHTML = fixture('prompt-bar.html') + fixture('tiles.html');
    expect(findTarget(document, 'prompt')).toBe(document.querySelector(SEL.promptBox));
    expect(findTarget(document, 'setting')).toBe(document.querySelector(SEL.settingsTrigger));
    expect(findTarget(document, 'generate')).toBe(document.querySelector(SEL.generate));
    const tile = findTarget(document, 'tile', '4ca91b00-de41-44e5-ab6c-85c484c751ab')!;
    expect(tile.classList.contains('tile')).toBe(true);
    expect(tile.querySelector('img')!.dataset.mediaId).toBe('4ca91b00-de41-44e5-ab6c-85c484c751ab');
    expect(findTarget(document, 'tile', 'not-there')).toBeNull();
  });

  it('prefers the flow-grid-tile-container around the picture', () => {
    document.body.innerHTML = `<div><flow-grid-tile-container><div><img data-media-id="k1"></div></flow-grid-tile-container></div>`;
    expect(findTarget(document, 'tile', 'k1')!.tagName).toBe('FLOW-GRID-TILE-CONTAINER');
  });
});

describe('renderHighlight', () => {
  it('ring never intercepts pointer events', () => {
    document.body.innerHTML = fixture('prompt-bar.html');
    const generate = document.querySelector(SEL.generate)!;
    box(generate, 900, 700, 30, 30);
    renderHighlight(document, generate, 'Pressing Generate');
    const h = host()!;
    expect(getComputedStyle(h).pointerEvents).toBe('none');
    const drawn = [...h.shadowRoot!.querySelectorAll<HTMLElement>('*')].filter((el) => el.tagName !== 'STYLE');
    expect(drawn.length).toBeGreaterThan(1);
    for (const el of drawn) expect(getComputedStyle(el).pointerEvents).toBe('none');
    // In Chrome the press hit-tests straight through (checked in tests/visual/live-activity.mjs); jsdom has no hit-testing.
    if (typeof document.elementFromPoint === 'function') expect(document.elementFromPoint(915, 715)).toBe(generate);
  });

  it('draws a coral ring around the target and a coral tag with navy text', () => {
    document.body.innerHTML = fixture('prompt-bar.html');
    const generate = document.querySelector(SEL.generate)!;
    box(generate, 900, 700, 30, 30);
    renderHighlight(document, generate, 'Pressing Generate');
    const [ring] = liveRings();
    expect(ring!.style.left).toBe('893px');
    expect(ring!.style.top).toBe('693px');
    expect(ring!.style.width).toBe('44px');
    expect(ring!.style.border).toBe('3px solid rgb(255, 107, 91)');
    const tag = host()!.shadowRoot!.querySelector<HTMLElement>('.tag:not(.leaving)')!;
    expect(tag.textContent).toBe('Pressing Generate');
    expect(tag.style.background).toBe('rgb(255, 107, 91)');
    expect(tag.style.color).toBe('rgb(20, 33, 61)');
  });

  it('ring follows the target and fades', () => {
    document.body.innerHTML = fixture('prompt-bar.html');
    const prompt = document.querySelector(SEL.promptBox)!;
    const generate = document.querySelector(SEL.generate)!;
    box(prompt, 300, 650, 500, 40);
    box(generate, 900, 700, 30, 30);
    renderHighlight(document, prompt, 'Typing here');
    expect(liveRings()).toHaveLength(1);

    // The same step, the target moved (scroll / Flow re-drew it): the ring follows, no fade.
    box(prompt, 300, 600, 500, 40);
    renderHighlight(document, prompt, 'Typing here');
    expect(rings()).toHaveLength(1);
    expect(rings()[0]!.style.top).toBe('593px');

    // The next step: the old ring fades out and goes; the new one is on Generate.
    renderHighlight(document, generate, 'Pressing Generate');
    expect(liveRings()).toHaveLength(1);
    expect(liveRings()[0]!.style.left).toBe('893px');
    vi.advanceTimersByTime(400);
    expect(rings()).toHaveLength(1);
    expect(host()!.shadowRoot!.querySelectorAll('.tag')).toHaveLength(1);

    renderHighlight(document, null, null);
    vi.advanceTimersByTime(400);
    expect(host()).toBeNull();
  });

  it('marks a tile with an inside ring and the tag in its corner', () => {
    document.body.innerHTML = fixture('tiles.html');
    const tile = findTarget(document, 'tile', '4ca91b00-de41-44e5-ab6c-85c484c751ab')!;
    box(tile, 200, 100, 300, 160);
    renderHighlight(document, tile, tagFor('tile', 2));
    const [ring] = liveRings();
    expect(ring!.style.left).toBe('200px');
    expect(ring!.style.width).toBe('300px');
    const tag = host()!.shadowRoot!.querySelector<HTMLElement>('.tag')!;
    expect(tag.textContent).toBe('Checking it matches scene 2…');
    expect(tag.style.left).toBe('208px');
    expect(tag.style.top).toBe('108px');
  });
});
