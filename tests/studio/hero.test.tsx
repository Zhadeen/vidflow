import 'fake-indexeddb/auto';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { memoryMediaStore, type MediaStore } from '../../src/store/media';
import { createProject, getProject, saveProject, setMediaStore, type Project } from '../../src/store/projects';
import { applyPatch, saveEdits } from '../../src/studio/projectEdits';
import { ScriptStep, type ProjectPatch } from '../../src/studio/ScriptStep';
import { HeroReference, REFERENCE_MAX_BYTES, clearHeroReference, setHeroReference } from '../../src/studio/HeroReference';
import type { RunReply } from '../../src/flow/messages';
import type { RunState } from '../../src/runs/run';
import type { RunClient } from '../../src/studio/runClient';

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

/** Keeps the reference the way the Script step does: onto the project's character, saved through the edit queue. */
function Host({ start }: { start: Project }) {
  const [p, setP] = useState(start);
  return (
    <HeroReference
      project={p}
      onChange={(referenceMediaId) => {
        const patch = { character: { description: p.character?.description ?? '', ...(referenceMediaId && { referenceMediaId }) } };
        setP(applyPatch(p, patch));
        void saveEdits(p.id, patch);
      }}
    />
  );
}

/** What the studio does with a patch: show it at once, save it after the earlier saves. */
let chain = Promise.resolve<unknown>(undefined);
function queued(start: Project) {
  return (patch: ProjectPatch) => {
    chain = chain.then(() => saveEdits(start.id, patch));
  };
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

  it('accepts exactly 10 MB and rejects an empty MIME type', async () => {
    const store2 = memoryMediaStore();
    setMediaStore(store2);
    const p = await createProject('Story');
    const exact = new Blob([new Uint8Array(REFERENCE_MAX_BYTES)], { type: 'image/webp' });
    expect(await setHeroReference(p.id, exact)).toEqual({ ok: true });
    expect(await store2.get(`${p.id}/hero-reference`)).toBeDefined();
    const noType = new Blob([new Uint8Array(3)]);
    expect(await setHeroReference(p.id, noType)).toEqual({ ok: false, message: 'Use a PNG, JPEG or WebP picture under 10 MB.' });
  });

  it('a replaced picture shows, though its media id stays the same', async () => {
    const p = await createProject('Story');
    let n = 0;
    URL.createObjectURL = () => `blob:hero-${++n}`;
    render(<Host start={p} />);
    fireEvent.change(input(), { target: { files: [png()] } });
    expect((await screen.findByRole('img', { name: 'Hero reference picture' })).getAttribute('src')).toBe('blob:hero-1');
    fireEvent.change(input(), { target: { files: [png()] } });
    await waitFor(() => expect(screen.getByRole('img', { name: 'Hero reference picture' }).getAttribute('src')).toBe('blob:hero-2'));
    expect(revoked).toContain('blob:hero-1');
  });

  it('the file input has an accessible label', async () => {
    render(<Host start={await createProject('Story')} />);
    expect(screen.getByLabelText('Hero reference picture file')).toBe(input());
  });

  it('typing while an upload is pending keeps the new description and sets the reference', async () => {
    const real = memoryMediaStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setMediaStore({ ...real, put: async (a, b, c) => (await gate, real.put(a, b, c)) });
    const p = await createProject('Story');
    function Studio() {
      const [cur, setCur] = useState(p);
      const save = queued(p);
      return (
        <ScriptStep
          project={cur}
          locked={false}
          hasPictures={false}
          onChange={(patch) => {
            setCur((c) => applyPatch(c, patch));
            save(patch);
          }}
          onContinue={() => undefined}
        />
      );
    }
    render(<Studio />);
    fireEvent.change(screen.getByLabelText('Hero reference picture file'), { target: { files: [png()] } });
    fireEvent.change(screen.getByRole('textbox', { name: /The hero/ }), { target: { value: 'a tall stickman' } });
    await waitFor(async () => expect((await getProject(p.id))!.character?.description).toBe('a tall stickman'));
    // The background saves scene states meanwhile.
    const mid = (await getProject(p.id))!;
    await saveProject({ ...mid, sceneStates: { s1: { sceneId: 's1', status: 'done', pictureIds: ['x'] } } });
    release();
    await waitFor(async () =>
      expect((await getProject(p.id))!.character).toEqual({ description: 'a tall stickman', referenceMediaId: `${p.id}/hero-reference` }),
    );
    expect((await getProject(p.id))!.sceneStates.s1?.pictureIds).toEqual(['x']);
  });

  it('clearing the reference deletes only hero-reference', async () => {
    const p = await createProject('Story');
    await setHeroReference(p.id, png());
    const other = await store.put(p.id, 'scene-01-option-1', new Blob(['x']));
    await clearHeroReference(p.id);
    expect(await store.get(`${p.id}/hero-reference`)).toBeUndefined();
    expect(await store.get(other)).toBeDefined();
  });
});

function sheetClient(over: Partial<RunClient> = {}): RunClient {
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
    subscribe: () => () => undefined,
    ...over,
  };
}

/** The hero section as the Script step shows it, with the model sheet. */
function SheetHost({ start, client, run = null, onRunState = () => undefined }: { start: Project; client: RunClient; run?: RunState | null; onRunState?(s: RunState | null): void }) {
  const [p, setP] = useState(start);
  return (
    <HeroReference
      project={p}
      sheet={{ run, client, onRunState }}
      onChange={(referenceMediaId) => {
        const patch = { character: { description: p.character?.description ?? '', ...(referenceMediaId && { referenceMediaId }) } };
        setP(applyPatch(p, patch));
        void saveEdits(p.id, patch);
      }}
    />
  );
}

describe('the hero model sheet', () => {
  async function withSheet(heroSheet: Project['heroSheet'], description = 'a tall stickman') {
    const p = await createProject('Story');
    p.character = { description };
    p.heroSheet = heroSheet;
    await saveProject(p);
    return p;
  }

  it('"Make a model sheet in Flow" is a secondary button, enabled once the hero is described', async () => {
    const client = sheetClient({ heroSheet: vi.fn(async (): Promise<RunReply> => ({ ok: false, reason: 'busy', message: 'Another project is making pictures right now.' })) });
    const empty = await withSheet(undefined, '');
    const { unmount } = render(<SheetHost start={empty} client={client} />);
    const off = screen.getByRole('button', { name: 'Make a model sheet in Flow' });
    expect(off.hasAttribute('disabled')).toBe(true);
    expect(off.dataset.variant).toBe('secondary');
    unmount();

    const p = await withSheet(undefined);
    render(<SheetHost start={p} client={client} />);
    const make = screen.getByRole('button', { name: 'Make a model sheet in Flow' });
    expect(make.hasAttribute('disabled')).toBe(false);
    fireEvent.click(make);
    await waitFor(() => expect(client.heroSheet).toHaveBeenCalledWith(p.id));
    expect((await screen.findByRole('alert')).textContent).toBe('Another project is making pictures right now.');
  });

  it('"Use as hero reference" on a sheet picture sets the reference', async () => {
    const p = await withSheet({ status: 'pending', pictureIds: [] });
    const one = await store.put(p.id, 'hero-sheet-option-1', new Blob(['sheet-1'], { type: 'image/png' }));
    const two = await store.put(p.id, 'hero-sheet-option-2', new Blob(['sheet-2'], { type: 'image/jpeg' }));
    await store.put(p.id, 'hero-reference', new Blob(['old'], { type: 'image/png' }));
    const saved = (await getProject(p.id))!;
    saved.heroSheet = { status: 'done', pictureIds: [one, two] };
    saved.character = { description: 'a tall stickman', referenceMediaId: `${p.id}/hero-reference` };
    await saveProject(saved);
    render(<SheetHost start={saved} client={sheetClient()} />);

    expect(await screen.findAllByRole('img', { name: /^Model sheet picture/ })).toHaveLength(2);
    const use = screen.getAllByRole('button', { name: 'Use as hero reference' });
    expect(use).toHaveLength(2);
    expect(use[0]!.dataset.variant).toBe('secondary');
    fireEvent.click(use[1]!);

    await waitFor(async () => expect(await (await store.get(`${p.id}/hero-reference`))!.text()).toBe('sheet-2'));
    await waitFor(async () =>
      expect((await getProject(p.id))!.character).toEqual({ description: 'a tall stickman', referenceMediaId: `${p.id}/hero-reference` }),
    );
    // The sheet's pictures are never deleted.
    expect(await store.get(one)).toBeDefined();
    expect(await store.get(two)).toBeDefined();
    expect(await screen.findByRole('img', { name: 'Hero reference picture' })).toBeDefined();
  });

  it('a refused sheet shows Flow\'s reason and "Try again"', async () => {
    const running = { projectId: 'x', status: 'running', inFlight: [], sceneStates: {} } as RunState;
    const client = sheetClient({ heroSheet: vi.fn(async (): Promise<RunReply> => ({ ok: true, state: running })) });
    const onRunState = vi.fn();
    const p = await withSheet({ status: 'refused', pictureIds: [], message: 'Might violate policy' });
    render(<SheetHost start={p} client={client} onRunState={onRunState} />);
    expect(screen.getByText('Might violate policy')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.heroSheet).toHaveBeenCalledWith(p.id));
    await waitFor(() => expect(onRunState).toHaveBeenCalledWith(running));
  });

  it('while Flow draws the sheet it says so, and the button waits', async () => {
    const p = await withSheet({ status: 'pending', pictureIds: [] });
    const run: RunState = {
      projectId: p.id,
      kind: 'hero-sheet',
      status: 'running',
      inFlight: ['hero-sheet'],
      sceneStates: { 'hero-sheet': { sceneId: 'hero-sheet', status: 'submitted', pictureIds: [] } },
    };
    render(<SheetHost start={p} client={sheetClient()} run={run} />);
    expect(screen.getByText(/Flow is drawing the model sheet/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Make a model sheet in Flow' }).hasAttribute('disabled')).toBe(true);
  });
});
