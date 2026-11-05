import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { RunReply } from '../../src/flow/messages';
import { createProject, saveProject, type SceneState } from '../../src/store/projects';
import { choosePicture, chosenPicture } from '../../src/studio/choice';
import type { RunClient } from '../../src/studio/runClient';
import { SceneGrid } from '../../src/studio/SceneGrid';

afterEach(() => cleanup());

const done = (over: Partial<SceneState> = {}): SceneState => ({
  sceneId: 's1',
  status: 'done',
  pictureIds: ['p/a', 'p/b', 'p/c'],
  ...over,
});

function fakeClient(): RunClient {
  const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
  return {
    get: ok,
    start: vi.fn(ok),
    pause: vi.fn(ok),
    resume: vi.fn(ok),
    retry: vi.fn(ok),
    stop: vi.fn(ok),
    forget: vi.fn(ok),
    choose: vi.fn(ok),
    heroSheet: vi.fn(ok),
    checks: vi.fn(async () => ({ ok: true as const, flowOpen: false, rows: [] })),
    openFlow: vi.fn(async () => ({ ok: true as const })),
    showMe: vi.fn(async () => ({ ok: true as const, missing: [] })),
    testPrompt: vi.fn(async () => ({ ok: true, message: 'Flow is ready.' })),
    subscribe: () => () => undefined,
  };
}

describe('chosenPicture', () => {
  it('uses the chosen picture, else the first', () => {
    expect(chosenPicture(done({ chosenPictureId: 'p/b' }))).toBe('p/b');
    expect(chosenPicture(done())).toBe('p/a');
    expect(chosenPicture(done({ pictureIds: [] }))).toBeUndefined();
    expect(chosenPicture(undefined)).toBeUndefined();
  });

  it('ignores a choice that is no longer one of the pictures', () => {
    expect(chosenPicture(done({ chosenPictureId: 'p/gone' }))).toBe('p/a');
    expect(chosenPicture(done({ pictureIds: [], chosenPictureId: 'p/gone' }))).toBeUndefined();
  });
});

describe('choosePicture', () => {
  async function stored() {
    const p = await createProject('Choice');
    p.sceneStates = { s1: done() };
    await saveProject(p);
    return p;
  }

  it("choosePicture rejects an id that isn't the scene's", async () => {
    const p = await stored();
    const client = fakeClient();
    await expect(choosePicture(p.id, 's1', 'p/other', client)).rejects.toThrow();
    await expect(choosePicture(p.id, 'no-such-scene', 'p/a', client)).rejects.toThrow();
    expect(client.choose).not.toHaveBeenCalled();
  });

  it('sends a valid choice to the background, the single writer', async () => {
    const p = await stored();
    const client = fakeClient();
    await choosePicture(p.id, 's1', 'p/c', client);
    expect(client.choose).toHaveBeenCalledWith(p.id, 's1', 'p/c');
  });

  it("says why when the background refuses the choice", async () => {
    const p = await stored();
    const client = fakeClient();
    vi.mocked(client.choose).mockResolvedValue({ ok: false, reason: 'error', message: 'Nope.' });
    await expect(choosePicture(p.id, 's1', 'p/c', client)).rejects.toThrow('Nope.');
  });
});

describe('scene grid', () => {
  it('the scene grid shows the chosen picture', () => {
    const scene = {
      id: 's1',
      slide: 1,
      start: null,
      end: null,
      sentence: 'Hi.',
      concept: 'hi',
      textOverlay: '',
      imagePrompt: 'A stickman waves',
      motionPrompt: 'Waves',
      motionPromptIsDefault: false,
    };
    render(
      createElement(SceneGrid, {
        scenes: [scene],
        states: { s1: done({ chosenPictureId: 'p/b' }) },
        urls: { 'p/a': 'blob:a', 'p/b': 'blob:b', 'p/c': 'blob:c' },
        aspect: '16:9',
        selected: null,
        onSelect: () => undefined,
      }),
    );
    const img = screen.getByRole('button', { name: /Scene 01/ }).querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:b');
  });
});
