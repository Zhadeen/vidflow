import { describe, expect, it } from 'vitest';
import { clipIsCurrent, estimate, scenesToClip } from '../../src/motion/clips';
import type { Scene } from '../../src/scenes/types';
import type { Project, SceneState } from '../../src/store/projects';

const scene = (id: string, start: number, end: number): Scene => ({
  id, slide: 1, start, end, sentence: '', concept: '', textOverlay: '', imagePrompt: '', motionPrompt: '', motionPromptIsDefault: false,
});
const st = (id: string, over: Partial<SceneState> = {}): SceneState => ({ sceneId: id, status: 'done', pictureIds: [`${id}/a`, `${id}/b`], ...over });
const project = (over: Partial<Project> = {}): Project => ({
  id: 'p', name: 'n', createdAt: 0, updatedAt: 0, style: 'stickman-whiteboard', character: null, aspect: '16:9', outputsPerPrompt: 2,
  scenes: [scene('a', 0, 2.4), scene('b', 0, 5), scene('c', 0, 14), scene('d', 0, 3)], sceneStates: {}, ...over,
});
const states: Record<string, SceneState> = { a: st('a'), b: st('b'), c: st('c'), d: { ...st('d'), pictureIds: [] } };

describe('clips', () => {
  it('a clip goes stale when the chosen picture changes', () => {
    const clip = { mediaId: 'm', sourcePictureId: 'a/a', length: 4, use: [0, 2.4] as [number, number] };
    expect(clipIsCurrent(st('a', { clip }))).toBe(true);
    expect(clipIsCurrent(st('a', { clip, chosenPictureId: 'a/b' }))).toBe(false);
    expect(clipIsCurrent(st('a'))).toBe(false);
    expect(clipIsCurrent(undefined)).toBe(false);
  });
  it('scenesToClip by mode stills/picked/all, skipping 1:1 and slides without pictures', () => {
    expect(scenesToClip(project(), states)).toEqual([]);
    expect(scenesToClip(project({ motionMode: 'picked', clipPicks: ['b', 'd'] }), states)).toEqual(['b']);
    expect(scenesToClip(project({ motionMode: 'all' }), states)).toEqual(['a', 'b', 'c']);
    expect(scenesToClip(project({ motionMode: 'all', aspect: '1:1' }), states)).toEqual([]);
    const withClip = { ...states, a: st('a', { clip: { mediaId: 'm', sourcePictureId: 'a/a', length: 4, use: [0, 2.4] } }) };
    expect(scenesToClip(project({ motionMode: 'all' }), withClip)).toEqual(['b', 'c']);
  });
  it("estimate sums each clip's cost", () => {
    expect(estimate(project({ motionMode: 'all' }), states)).toEqual({ clips: 3, credits: 7 + 10 + 15 });
    expect(estimate(project(), states)).toEqual({ clips: 0, credits: 0 });
  });
  it('estimate excludes a scene that already has a current clip', () => {
    const withClip = { ...states, a: st('a', { clip: { mediaId: 'm', sourcePictureId: 'a/a', length: 4, use: [0, 2.4] } }) };
    expect(estimate(project({ motionMode: 'all' }), withClip)).toEqual({ clips: 2, credits: 10 + 15 });
  });
});
