// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { memoryMediaStore } from '../../src/store/media';

describe('memoryMediaStore', () => {
  it('media put/get round-trips a 5 MB blob', async () => {
    const store = memoryMediaStore();
    const bytes = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
    const id = await store.put('p1', 'pic 1.png', new Blob([bytes]));
    expect(id.startsWith('p1/')).toBe(true);
    const back = await store.get(id);
    expect(back).toBeDefined();
    expect(back!.size).toBe(bytes.length);
    const got = new Uint8Array(await new Response(back!).arrayBuffer());
    expect(got[0]).toBe(bytes[0]);
    expect(got[123456]).toBe(bytes[123456]);
    expect(got[got.length - 1]).toBe(bytes[bytes.length - 1]);
  });

  it('get returns undefined for unknown ids and removeProject clears only that project', async () => {
    const store = memoryMediaStore();
    const a = await store.put('a', 'x.png', new Blob(['1']));
    const b = await store.put('b', 'x.png', new Blob(['2']));
    await store.removeProject('a');
    expect(await store.get(a)).toBeUndefined();
    expect(await store.get(b)).toBeDefined();
    expect(await store.get('nope/none')).toBeUndefined();
  });
});
