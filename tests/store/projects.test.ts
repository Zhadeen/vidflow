import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { createProject, getProject, saveProject, listProjects, deleteProject, setMediaStore } from '../../src/store/projects';
import { memoryMediaStore, type MediaStore } from '../../src/store/media';

let media: MediaStore;
beforeEach(() => {
  media = memoryMediaStore();
  setMediaStore(media);
});

describe('projects store', () => {
  it('create then get returns same project', async () => {
    const p = await createProject('Demo');
    expect(p.scenes).toEqual([]);
    expect(p.style).toBe('stickman-whiteboard');
    expect(p.character).toBeNull();
    expect(p.aspect).toBe('16:9');
    expect(p.outputsPerPrompt).toBe(2);
    expect(p.sceneStates).toEqual({});
    expect(p.createdAt).toBe(p.updatedAt);
    expect(await getProject(p.id)).toEqual(p);
    expect(await getProject('missing')).toBeUndefined();
  });

  it('listProjects sorted by updatedAt desc', async () => {
    const a = await createProject('A');
    const b = await createProject('B');
    await new Promise((r) => setTimeout(r, 5));
    await saveProject(a);
    const list = await listProjects();
    const ids = list.map((x) => x.id);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'name', 'updatedAt']);
  });

  it('deleteProject removes media too', async () => {
    const p = await createProject('Del');
    const id = await media.put(p.id, 'pic.png', new Blob(['x']));
    await deleteProject(p.id);
    expect(await getProject(p.id)).toBeUndefined();
    expect(await media.get(id)).toBeUndefined();
  });
});
