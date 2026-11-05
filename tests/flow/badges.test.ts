import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderSavedBadges } from '../../src/flow/badges';

const fixture = (name: string) => readFileSync(resolve(__dirname, '../fixtures/flow', name), 'utf8');
const host = () => document.getElementById('vidflow-badges');
const badges = () => [...(host()?.shadowRoot?.querySelectorAll<HTMLElement>('.badge') ?? [])];

afterEach(() => {
  document.body.innerHTML = '';
  for (const el of document.querySelectorAll('[id^="vidflow-"]')) el.remove();
});

describe('renderSavedBadges', () => {
  it('badges label saved tiles with their scene', () => {
    document.body.innerHTML = fixture('tiles.html');
    const tiles = [...document.querySelectorAll<HTMLElement>('.tile')];
    tiles.forEach((t, i) => {
      t.getBoundingClientRect = () =>
        ({ left: 100, top: 50 + i * 200, width: 300, height: 160, right: 400, bottom: 210 + i * 200 }) as DOMRect;
    });
    renderSavedBadges(
      document,
      new Map([
        ['5b208a77-5547-4e88-9b51-f74f987f2f0d', 1],
        ['4ca91b00-de41-44e5-ab6c-85c484c751ab', 1],
        ['ab179dfe-f41c-4415-9436-4faadff8fb94', 4],
        ['not-on-the-page', 2],
      ]),
    );
    const shown = badges();
    expect(shown.map((b) => b.textContent)).toEqual(['✓ Saved · scene 1', '✓ Saved · scene 1', '✓ Saved · scene 4']);
    const first = shown[0]!;
    expect(first.style.top).toBe('258px'); // tile 2 (top 250) + 8
    expect(first.style.background).toBe('rgb(20, 33, 61)');
    expect(first.style.color).toBe('rgb(244, 237, 224)');
    expect(first.style.border).toBe('1px solid rgb(244, 237, 224)');
    expect(getComputedStyle(host()!).pointerEvents).toBe('none');
    for (const b of shown) expect(getComputedStyle(b).pointerEvents).toBe('none');
  });

  it('removes badges that are no longer saved, and the host when none are', () => {
    document.body.innerHTML = fixture('tiles.html');
    renderSavedBadges(document, new Map([['5b208a77-5547-4e88-9b51-f74f987f2f0d', 1], ['4ca91b00-de41-44e5-ab6c-85c484c751ab', 2]]));
    renderSavedBadges(document, new Map([['4ca91b00-de41-44e5-ab6c-85c484c751ab', 2]]));
    expect(badges().map((b) => b.textContent)).toEqual(['✓ Saved · scene 2']);
    renderSavedBadges(document, new Map());
    expect(host()).toBeNull();
  });
});
