import { describe, expect, it } from 'vitest';
import type { FlowResultCard } from '../../src/flow/driver';
import { matchResults, unverifiedKeys, verifyMatch, type Submission } from '../../src/flow/match';

const BIKE = 'A stickman rides a bicycle up a hill, black ink on white paper';
const WAVE = 'A stickman waves from a window, black ink on white paper';

const sub = (sceneId: string, prompt: string, seq: number): Submission => ({ sceneId, prompt, seq, submittedAt: seq * 1000 });

/** Tiles as Flow lists them: newest first. Each entry is a finished key, or a spec for an in-progress/refused tile. */
type TileSpec = string | { pending: string } | { refusal: string; caption: string };
function tiles(...specs: TileSpec[]): FlowResultCard[] {
  return specs.map((s, domIndex) => {
    if (typeof s === 'string') {
      return { key: s, caption: `Stickman title ${s}`, imageUrl: `https://flow-content.google/image/${s}`, progress: null, refusal: null, domIndex };
    }
    if ('pending' in s) {
      return { key: `pending-${domIndex}`, caption: s.pending, imageUrl: null, progress: 40, refusal: null, domIndex };
    }
    return { key: `pending-${domIndex}`, caption: s.caption, imageUrl: null, progress: null, refusal: s.refusal, domIndex };
  });
}

describe('matchResults', () => {
  it('matches each card to its own prompt', () => {
    // The 5 Nov failure: scene-02 finished before scene-01. Its cards must not be saved under scene-01.
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    const early = tiles('w2', 'w1', { pending: BIKE }, { pending: BIKE });
    expect(matchResults(subs, early, new Set(), 2)).toEqual([{ kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] }]);

    const later = tiles('w2', 'w1', 'b2', 'b1');
    expect(matchResults(subs, later, new Set(), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['b1', 'b2'] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
  });

  it('matches duplicate prompts by submission order', () => {
    const subs = [sub('scene-07', WAVE, 2), sub('scene-03', WAVE, 1)];
    expect(matchResults(subs, tiles('d4', 'd3', 'd2', 'd1'), new Set(), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-03', cardKeys: ['d1', 'd2'] },
      { kind: 'pictures', sceneId: 'scene-07', cardKeys: ['d3', 'd4'] },
    ]);
  });

  it('ignores cards seen before the run', () => {
    const subs = [sub('scene-01', BIKE, 1)];
    expect(matchResults(subs, tiles('n2', 'n1', 'old2', 'old1'), new Set(['old1', 'old2']), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['n1', 'n2'] },
    ]);
    expect(matchResults(subs, tiles('old2', 'old1'), new Set(['old1', 'old2']), 2)).toEqual([]);
  });

  it('waits for all outputs', () => {
    const subs = [sub('scene-01', BIKE, 1)];
    expect(matchResults(subs, tiles({ pending: BIKE }, 'b1'), new Set(), 2)).toEqual([]);
  });

  it('refusal completes a scene with no pictures', () => {
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    const cards = tiles('w2', 'w1', { refusal: 'This prompt might violate our policies', caption: BIKE });
    expect(matchResults(subs, cards, new Set(), 2)).toEqual([
      { kind: 'refused', sceneId: 'scene-01', cardKeys: [], message: 'This prompt might violate our policies' },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
    // Flow showing one refused tile per output still refuses only that scene.
    const twice = tiles('w2', 'w1', { refusal: 'Might violate', caption: BIKE }, { refusal: 'Might violate', caption: BIKE });
    expect(matchResults(subs, twice, new Set(), 2).map((m) => [m.kind, m.sceneId])).toEqual([
      ['refused', 'scene-01'],
      ['pictures', 'scene-02'],
    ]);
  });

  it("never marks a scene refused from a refused tile that isn't its prompt", () => {
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    // A refused tile for some other prompt sits where scene-01's pictures should be: unconfirmed, not refused.
    const foreign = tiles('w1', { refusal: 'Might violate', caption: 'A stickman in a fight' });
    expect(matchResults(subs, foreign, new Set(), 1)).toEqual([
      { kind: 'unconfirmed', sceneId: 'scene-01', cardKeys: [] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1'] },
    ]);
    // scene-02's refusal where scene-01's pictures should be: scene-02 is refused, scene-01 is not.
    const later = tiles({ refusal: 'Might violate', caption: WAVE });
    expect(matchResults(subs, later, new Set(), 1)).toEqual([
      { kind: 'unconfirmed', sceneId: 'scene-01', cardKeys: [] },
      { kind: 'refused', sceneId: 'scene-02', cardKeys: [], message: 'Might violate' },
    ]);
  });

  it('does not use finished captions', () => {
    // Flow renames finished tiles; a title that happens to equal the other scene's prompt must not move a card.
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    const cards = tiles('w2', 'w1', 'b2', 'b1').map((c) => ({ ...c, caption: c.key.startsWith('b') ? WAVE : BIKE }));
    expect(matchResults(subs, cards, new Set(), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['b1', 'b2'] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
  });

  it('leaves surplus cards unassigned', () => {
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    // More new cards than owed: the extras belong to nobody.
    expect(matchResults(subs, tiles('x2', 'x1', 'w2', 'w1', 'b2', 'b1'), new Set(), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['b1', 'b2'] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
    // A second batch of scene-01 (Resume re-pressed it) sits between the two scenes: it must not shift onto scene-02.
    const details = { s1: BIKE, s2: BIKE };
    expect(matchResults(subs, tiles('w2', 'w1', 's2', 's1', 'b2', 'b1'), new Set(), 2, details)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['b1', 'b2'] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
    // Still generating, the surplus batch is recognised by its prompt caption and does not hold scene-02's places.
    const generating = tiles('w2', 'w1', { pending: BIKE }, { pending: BIKE }, 'b2', 'b1');
    expect(matchResults(subs, generating, new Set(), 2)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['b1', 'b2'] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1', 'w2'] },
    ]);
  });

  it('rejects a card whose detail prompt differs', () => {
    const subs = [sub('scene-01', BIKE, 1)];
    const details = { a1: 'A stickman reads a book' };
    expect(matchResults(subs, tiles('a3', 'a2', 'a1'), new Set(), 2, details)).toEqual([
      { kind: 'pictures', sceneId: 'scene-01', cardKeys: ['a2', 'a3'] },
    ]);
  });

  it("gives up on a scene whose place holds a later scene's verified picture", () => {
    // scene-01's pictures aren't where they must be; never guess: scene-01 is unconfirmed, scene-02 still gets its own.
    const subs = [sub('scene-01', BIKE, 1), sub('scene-02', WAVE, 2)];
    expect(matchResults(subs, tiles('w1'), new Set(), 1, { w1: WAVE })).toEqual([
      { kind: 'unconfirmed', sceneId: 'scene-01', cardKeys: [] },
      { kind: 'pictures', sceneId: 'scene-02', cardKeys: ['w1'] },
    ]);
  });
});

describe('verification', () => {
  it('verifyMatch normalises whitespace and case', () => {
    expect(verifyMatch(BIKE, `  ${BIKE.toUpperCase().replace(/ /g, '\n  ')} `)).toBe(true);
    expect(verifyMatch(BIKE, `${BIKE}.`)).toBe(false);
    expect(verifyMatch(BIKE, '')).toBe(false);
  });

  it('lists the cards of a match that still need their detail prompt checked', () => {
    const match = { kind: 'pictures' as const, sceneId: 'scene-01', cardKeys: ['a1', 'a2'] };
    expect(unverifiedKeys(match, { a1: BIKE })).toEqual(['a2']);
    expect(unverifiedKeys(match, { a1: BIKE, a2: BIKE })).toEqual([]);
  });
});
