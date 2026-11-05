import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';

it('a stored-project swap (no live run) sets choiceSource owner', async () => {
  vi.resetModules();
  const area = () => {
    const data: Record<string, unknown> = {};
    return {
      get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, items)),
      remove: vi.fn(async (key: string) => void delete data[key]),
    };
  };
  const listener = () => ({ addListener: vi.fn() });
  vi.stubGlobal('chrome', {
    storage: { local: area(), session: area(), onChanged: listener() },
    alarms: { create: vi.fn(), clear: vi.fn(async () => true), onAlarm: listener() },
    runtime: { onStartup: listener(), getURL: (p: string) => p },
    windows: { onRemoved: listener() },
  });
  const store = await import('../../src/store/projects');
  store.setMediaStore(memoryMediaStore());
  const { chooseScenePicture } = await import('../../src/runs/coordinator');
  const p = await store.createProject('Demo');
  p.sceneStates = { s1: { sceneId: 's1', status: 'done', pictureIds: ['m/a', 'm/b'], chosenPictureId: 'm/a', choiceSource: 'auto' } };
  await store.saveProject(p);
  await chooseScenePicture(p.id, 's1', 'm/b');
  const after = (await store.getProject(p.id))!.sceneStates.s1!;
  expect(after.chosenPictureId).toBe('m/b');
  expect(after.choiceSource).toBe('owner');
});
