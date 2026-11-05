import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memoryMediaStore, type MediaStore } from '../../src/store/media';
import { createProject, getProject, saveProject, setMediaStore, type Project } from '../../src/store/projects';
import { HeroReference, REFERENCE_MAX_BYTES, clearHeroReference, setHeroReference } from '../../src/studio/HeroReference';

let store: MediaStore;
let revoked: string[];
beforeEach(() => {
  store = memoryMediaStore();
  setMediaStore(store);
  revoked = [];
  URL.createObjectURL = () => 'blob:hero';
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
});
afterEach(cleanup);

function Host({ start }: { start: Project }) {
  const [p, setP] = useState(start);
  return <HeroReference project={p} onChange={setP} />;
}

const png = () => new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' });
const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;

describe('hero reference', () => {
  it('uploads a PNG and shows it as the hero reference', async () => {
    const p = await createProject('Story');
    p.character = { description: 'a tall stickman' };
    await saveProject(p);
    render(<Host start={p} />);
    expect(input().accept).toBe('image/png,image/jpeg,image/webp');
    fireEvent.change(input(), { target: { files: [png()] } });
    const img = await screen.findByRole('img', { name: 'Hero reference picture' });
    expect(img.getAttribute('src')).toBe('blob:hero');
    const saved = (await getProject(p.id))!;
    expect(saved.character).toEqual({ description: 'a tall stickman', referenceMediaId: `${p.id}/hero-reference` });
    expect(await store.get(`${p.id}/hero-reference`)).toBeDefined();
  });

  it('rejects a 12 MB file and a .gif with a plain message', async () => {
    const p = await createProject('Story');
    render(<Host start={p} />);
    const big = new File([new Uint8Array(12 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    fireEvent.change(input(), { target: { files: [big] } });
    expect((await screen.findByRole('alert')).textContent).toBe('Use a PNG, JPEG or WebP picture under 10 MB.');
    fireEvent.change(input(), { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Use a PNG, JPEG or WebP picture under 10 MB.'));
    expect(screen.queryByRole('img')).toBeNull();
    expect(await store.get(`${p.id}/hero-reference`)).toBeUndefined();
    expect(REFERENCE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('removing the reference keeps the description', async () => {
    const p = await createProject('Story');
    p.character = { description: 'a tall stickman' };
    await saveProject(p);
    render(<Host start={p} />);
    fireEvent.change(input(), { target: { files: [png()] } });
    await screen.findByRole('img', { name: 'Hero reference picture' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    await waitFor(() => expect(revoked).toContain('blob:hero'));
    expect((await getProject(p.id))!.character).toEqual({ description: 'a tall stickman' });
  });

  it('clearing the reference deletes only hero-reference', async () => {
    const p = await createProject('Story');
    await setHeroReference(p.id, png());
    const other = await store.put(p.id, 'scene-01-option-1', new Blob(['x']));
    await clearHeroReference(p.id);
    expect(await store.get(`${p.id}/hero-reference`)).toBeUndefined();
    expect(await store.get(other)).toBeDefined();
    expect((await getProject(p.id))!.character).toBeNull();
  });
});
