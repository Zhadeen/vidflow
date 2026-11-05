import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createProject, getProject, saveProject, setMediaStore } from '../../src/store/projects';
import { memoryMediaStore } from '../../src/store/media';
import { saveEdits } from '../../src/studio/projectEdits';
import type { Scene } from '../../src/scenes/types';

setMediaStore(memoryMediaStore());

const scene = (id: string): Scene => ({
  id, slide: 1, start: null, end: null, sentence: '', concept: '', textOverlay: '', imagePrompt: 'p', motionPrompt: '', motionPromptIsDefault: true,
});

describe('studio edits', () => {
  it('keeps scene states the background saved meanwhile', async () => {
    const p = await createProject('A');
    p.scenes = [scene('scene-01')];
    await saveProject(p);
    // The background saves a finished scene after the studio loaded the project.
    const bg = (await getProject(p.id))!;
    bg.sceneStates = { 'scene-01': { sceneId: 'scene-01', status: 'done', pictureIds: ['x'] } };
    await saveProject(bg);
    await saveEdits(p.id, { aspect: '9:16' });
    const saved = (await getProject(p.id))!;
    expect(saved.aspect).toBe('9:16');
    expect(saved.sceneStates['scene-01']?.status).toBe('done');
  });

  it('a new scene file starts the pictures again', async () => {
    const p = await createProject('B');
    p.sceneStates = { 'scene-01': { sceneId: 'scene-01', status: 'done', pictureIds: ['x'] } };
    await saveProject(p);
    await saveEdits(p.id, { scenes: [scene('scene-01')] });
    expect((await getProject(p.id))!.sceneStates).toEqual({});
  });
});
