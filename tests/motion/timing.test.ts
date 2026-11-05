import { describe, expect, it } from 'vitest';
import { CLIP_COST, clipLengthFor, slideSeconds, useRange } from '../../src/motion/timing';
import type { Scene } from '../../src/scenes/types';

const sc = (start: number | null, end: number | null): Scene => ({
  id: 's', slide: 1, start, end, sentence: '', concept: '', textOverlay: '', imagePrompt: '', motionPrompt: '', motionPromptIsDefault: false,
});

describe('timing', () => {
  it('rapid-beat slide gets a 4 s clip used for its own length', () => {
    const s = slideSeconds(sc(0, 2.4));
    expect(clipLengthFor(s)).toBe(4);
    expect(useRange(s, 4)).toEqual([0, 2.4]);
    expect(CLIP_COST[4]).toBe(7);
  });
  it('5 s → 6, 9 s → 10, 14 s → 10 with use [0, 10]', () => {
    expect(clipLengthFor(5)).toBe(6);
    expect(clipLengthFor(9)).toBe(10);
    expect(clipLengthFor(14)).toBe(10);
    expect(useRange(14, 10)).toEqual([0, 10]);
    expect(CLIP_COST).toEqual({ 4: 7, 6: 10, 8: 12, 10: 15 });
  });
  it('missing timecode counts 3 s', () => {
    expect(slideSeconds(sc(null, null))).toBe(3);
    expect(slideSeconds(sc(2, null))).toBe(3);
  });
});
