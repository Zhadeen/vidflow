import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RunReply } from '../../src/flow/messages';
import { logActivity } from '../../src/runs/activity';
import type { Scene } from '../../src/scenes/types';
import type { MediaStore } from '../../src/store/media';
import { createProject, getProject, saveProject, type Project, type SceneState } from '../../src/store/projects';
import { App } from '../../src/studio/App';
import type { RunClient } from '../../src/studio/runClient';

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
let data: Record<string, unknown>;
let listeners: Set<Listener>;
const blobNames = new Map<Blob, string>();

beforeEach(() => {
  data = {};
  listeners = new Set();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(data, structuredClone(items));
          const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { newValue: v }]));
          for (const l of listeners) l(changes, 'local');
        }),
      },
      onChanged: {
        addListener: (l: Listener) => listeners.add(l),
        removeListener: (l: Listener) => listeners.delete(l),
      },
    },
  });
  // Object URLs name the picture they show, so a test can tell which picture an <img> is.
  URL.createObjectURL = (b: Blob | MediaSource) => `blob:${blobNames.get(b as Blob)}`;
  URL.revokeObjectURL = () => undefined;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

/** Every picture loads; its object URL is "blob:<media id>". */
const media: MediaStore = {
  put: async () => '',
  get: async (id) => {
    const blob = new Blob([id]);
    blobNames.set(blob, id);
    return blob;
  },
  remove: async () => undefined,
  removeProject: async () => undefined,
};

function scene(n: number): Scene {
  return {
    id: `s${n}`,
    slide: n,
    start: null,
    end: null,
    sentence: `Sentence ${n}.`,
    concept: 'idea',
    textOverlay: '',
    imagePrompt: `The hero does thing ${n}`,
    motionPrompt: 'The hero moves.',
    motionPromptIsDefault: false,
  };
}

const done = (n: number, over: Partial<SceneState> = {}): SceneState => ({
  sceneId: `s${n}`,
  status: 'done',
  pictureIds: [`m/a${n}`, `m/b${n}`],
  ...over,
});

/** Two finished scenes with two pictures each; the studio shows scene 2 (the last one ready). */
async function stored(states: Record<string, SceneState> = { s1: done(1), s2: done(2) }): Promise<Project> {
  const p = await createProject('Swap Story');
  p.scenes = [scene(1), scene(2)];
  p.outputsPerPrompt = 2;
  p.sceneStates = states;
  await saveProject(p);
  return p;
}

/** Behaves like the background with no run live: saves the choice, logs it, sends no run/state broadcast. */
function backgroundClient(over: Partial<RunClient> = {}): RunClient {
  const ok = async (): Promise<RunReply> => ({ ok: true, state: null });
  return {
    get: ok,
    start: vi.fn(ok),
    pause: vi.fn(ok),
    resume: vi.fn(ok),
    retry: vi.fn(ok),
    stop: vi.fn(ok),
    forget: vi.fn(ok),
    choose: vi.fn(async (projectId: string, sceneId: string, pictureId: string): Promise<RunReply> => {
      const p = (await getProject(projectId))!;
      const s = p.sceneStates[sceneId]!;
      p.sceneStates = { ...p.sceneStates, [sceneId]: { ...s, chosenPictureId: pictureId } };
      await saveProject(p);
      await logActivity({ at: Date.now(), projectId, sceneId, text: `Swapped to picture ${s.pictureIds.indexOf(pictureId) + 1}` });
      return { ok: true, state: null };
    }),
    subscribe: () => () => undefined,
    ...over,
  };
}

async function openStudio(p: Project, client = backgroundClient()) {
  window.location.hash = `#/project/${p.id}`;
  render(<App client={client} media={media} />);
  await screen.findByRole('region', { name: 'Preview' });
  await waitFor(() => expect(screen.getAllByRole('img', { name: /^Option/ })).toHaveLength(2));
  return client;
}

const preview = () => screen.getByRole('region', { name: 'Preview' });
const option = (n: number) => screen.getByRole('figure', { name: new RegExp(`^Option ${n} of`) });
const useButton = (n: number) => within(option(n)).getByRole<HTMLButtonElement>('button', { name: 'Use this picture' });
const tileImg = (n: number) =>
  within(screen.getByRole('list', { name: 'Scenes' })).getByRole('button', { name: new RegExp(`^Scene 0?${n}\\b`) }).querySelector('img');

describe('one-click picture swap', () => {
  it('the chosen option has the "★ Using this" pill and coral border', async () => {
    const p = await stored({ s1: done(1), s2: done(2, { chosenPictureId: 'm/b2' }) });
    await openStudio(p);
    expect(option(2).getAttribute('data-best')).toBe('true');
    expect(within(option(2)).getByText('★ Using this')).toBeTruthy();
    expect(option(1).getAttribute('data-best')).toBeNull();
    expect(within(option(1)).queryByText('★ Using this')).toBeNull();
    // The chosen card has nothing to press; the other one says what pressing does.
    expect(within(option(2)).queryByRole('button', { name: 'Use this picture' })).toBeNull();
    expect(within(option(1)).getByRole('button', { name: 'Use this picture' })).toBeTruthy();
    // With no choice, Flow's first picture is the one in use.
    cleanup();
    await openStudio(await stored());
    expect(option(1).getAttribute('data-best')).toBe('true');
    expect(within(option(1)).getByText('★ Using this')).toBeTruthy();
  });

  it(`clicking another option's "Use this picture" swaps in one click and moves the pill`, async () => {
    const p = await stored();
    const client = await openStudio(p);
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    // At once (before the background answers) the pill moves.
    expect(option(2).getAttribute('data-best')).toBe('true');
    expect(within(option(2)).getByText('★ Using this')).toBeTruthy();
    expect(within(option(1)).queryByText('★ Using this')).toBeNull();
    await waitFor(() => expect(client.choose).toHaveBeenCalledTimes(1));
    expect(client.choose).toHaveBeenCalledWith(p.id, 's2', 'm/b2');
    // The background saved it with no broadcast: the studio read it back and keeps it.
    await waitFor(async () => expect((await getProject(p.id))!.sceneStates.s2?.chosenPictureId).toBe('m/b2'));
    await waitFor(() => expect(useButton(1).disabled).toBe(false)); // the swap finished saving
    expect(option(2).getAttribute('data-best')).toBe('true');
    expect(within(option(1)).getByRole('button', { name: 'Use this picture' })).toBeTruthy();
  });

  it("a click anywhere on another card also swaps; the keyboard uses the card's real button", async () => {
    const p = await stored();
    const client = await openStudio(p);
    fireEvent.click(within(option(2)).getByRole('img'));
    await waitFor(() => expect(option(2).getAttribute('data-best')).toBe('true'));
    expect(client.choose).toHaveBeenCalledTimes(1);
    expect(client.choose).toHaveBeenLastCalledWith(p.id, 's2', 'm/b2');
    await waitFor(async () => expect((await getProject(p.id))!.sceneStates.s2?.chosenPictureId).toBe('m/b2'));
    await waitFor(() => expect(useButton(1).disabled).toBe(false)); // the swap finished saving
    // Enter and Space work because it is a native button in the tab order (one stop per card).
    const use = within(option(1)).getByRole('button', { name: 'Use this picture' });
    expect(use.tagName).toBe('BUTTON');
    expect(use.getAttribute('type')).toBe('button');
    expect(option(1).getAttribute('tabindex')).toBeNull();
    fireEvent.click(use);
    await waitFor(() => expect(option(1).getAttribute('data-best')).toBe('true'));
    expect(client.choose).toHaveBeenCalledTimes(2);
    // Pressing the card already in use does nothing.
    await waitFor(async () => expect((await getProject(p.id))!.sceneStates.s2?.chosenPictureId).toBe('m/a2'));
    await waitFor(() => expect(useButton(2).disabled).toBe(false));
    fireEvent.click(within(option(1)).getByRole('img'));
    expect(client.choose).toHaveBeenCalledTimes(2);
  });

  it('the swap shows in the scene grid at once', async () => {
    const p = await stored();
    await openStudio(p);
    await waitFor(() => expect(tileImg(2)?.getAttribute('src')).toBe('blob:m/a2'));
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    await waitFor(() => expect(tileImg(2)?.getAttribute('src')).toBe('blob:m/b2'));
    expect(tileImg(1)?.getAttribute('src')).toBe('blob:m/a1');
  });

  it('swapping logs "Scene N · Swapped to picture K" in the activity list', async () => {
    const p = await stored();
    await openStudio(p);
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    const activity = screen.getByRole('region', { name: 'Activity' });
    await waitFor(() => expect(within(activity).getByRole('listitem').textContent).toMatch(/Scene 2 · Swapped to picture 2$/));
  });

  it(`the status line reads "VidFlow uses Flow's first picture. Click another to swap." when no scene has a choice yet`, async () => {
    const line = "VidFlow uses Flow's first picture. Click another to swap.";
    const p = await stored();
    await openStudio(p);
    expect(within(preview()).getByText(line)).toBeTruthy();
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    await waitFor(() => expect(within(preview()).queryByText(line)).toBeNull());
    // A choice on any scene means the owner knows: the line stays away on the other scenes too.
    cleanup();
    await openStudio(await stored({ s1: done(1, { chosenPictureId: 'm/b1' }), s2: done(2) }));
    expect(within(preview()).queryByText(line)).toBeNull();
  });

  it('still exactly one coral primary on the screen', async () => {
    const p = await stored();
    await openStudio(p);
    const primaries = () => document.querySelectorAll('[data-variant="primary"]');
    expect(primaries()).toHaveLength(1);
    // The pill is a label, not a button; "Use this picture" is the cream outlined secondary.
    const pill = within(option(1)).getByText('★ Using this');
    expect(pill.closest('button')).toBeNull();
    expect(within(option(2)).getByRole('button', { name: 'Use this picture' }).getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    await waitFor(() => expect(option(2).getAttribute('data-best')).toBe('true'));
    expect(primaries()).toHaveLength(1);
  });

  it('each "Use this picture" button is described by its card\'s "Option K of N" title', async () => {
    const p = await stored({ s1: done(1), s2: done(2, { pictureIds: ['m/a2', 'm/b2', 'm/c2'] }) });
    window.location.hash = `#/project/${p.id}`;
    render(<App client={backgroundClient()} media={media} />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Use this picture' })).toHaveLength(2));
    const descriptions = screen.getAllByRole('button', { name: 'Use this picture' }).map((b) => {
      const ids = b.getAttribute('aria-describedby')!.split(' ');
      return ids.map((id) => document.getElementById(id)?.textContent).join(' ');
    });
    expect(descriptions).toEqual(['Option 2 of 3', 'Option 3 of 3']);
  });

  it('after a swap, focus moves to the newly chosen card; after a refusal it stays on the pressed button', async () => {
    const p = await stored();
    await openStudio(p);
    expect(option(1).getAttribute('tabindex')).toBe('-1'); // focusable by script, not a tab stop
    const use = within(option(2)).getByRole('button', { name: 'Use this picture' });
    use.focus();
    fireEvent.click(use);
    await waitFor(() => expect(document.activeElement).toBe(option(2)));
    expect(option(2).getAttribute('tabindex')).toBe('-1');
    expect(option(1).getAttribute('tabindex')).toBeNull();

    cleanup();
    const refused = backgroundClient({ choose: vi.fn(async (): Promise<RunReply> => ({ ok: false, reason: 'error', message: 'No.' })) });
    await openStudio(await stored(), refused);
    const again = within(option(2)).getByRole('button', { name: 'Use this picture' });
    again.focus();
    fireEvent.click(again);
    await screen.findByText('No.');
    await waitFor(() => expect(document.activeElement).toBe(within(option(2)).getByRole('button', { name: 'Use this picture' })));
  });

  it('says which option is in use: a status line and aria-current on the chosen card', async () => {
    const p = await stored();
    await openStudio(p);
    const status = () => within(preview()).getByRole('status');
    expect(status().textContent).toBe('Using option 1 of 2');
    expect(status().className).toContain('vf-visually-hidden');
    expect(option(1).getAttribute('aria-current')).toBe('true');
    expect(option(2).getAttribute('aria-current')).toBeNull();
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    await waitFor(() => expect(status().textContent).toBe('Using option 2 of 2'));
    expect(option(2).getAttribute('aria-current')).toBe('true');
    expect(option(1).getAttribute('aria-current')).toBeNull();
  });

  it('the read-back after a swap takes only the swapped scene, not the whole saved project', async () => {
    const p = await stored();
    // Meanwhile something else saved scene 1 as failed; only scene 2 may come from the read-back.
    const client = backgroundClient();
    const choose = client.choose;
    client.choose = vi.fn(async (projectId: string, sceneId: string, pictureId: string) => {
      const reply = await choose(projectId, sceneId, pictureId);
      const q = (await getProject(projectId))!;
      q.sceneStates = { ...q.sceneStates, s1: { sceneId: 's1', status: 'failed', pictureIds: [], message: 'x' } };
      await saveProject(q);
      return reply;
    });
    await openStudio(p, client);
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    await waitFor(async () => expect((await getProject(p.id))!.sceneStates.s1?.status).toBe('failed'));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(option(2).getAttribute('data-best')).toBe('true');
    expect(tileImg(1)?.getAttribute('src')).toBe('blob:m/a1'); // scene 1 still shown as it was
    expect(screen.queryByRole('heading', { name: /needs a look/ })).toBeNull();
  });

  it('puts the pill back and says why when the background refuses the swap', async () => {
    const p = await stored();
    const client = backgroundClient({
      choose: vi.fn(async (): Promise<RunReply> => ({ ok: false, reason: 'error', message: "That picture isn't one of this scene's." })),
    });
    await openStudio(p, client);
    fireEvent.click(within(option(2)).getByRole('button', { name: 'Use this picture' }));
    expect(await screen.findByText("That picture isn't one of this scene's.")).toBeTruthy();
    expect(option(1).getAttribute('data-best')).toBe('true');
    expect(option(2).getAttribute('data-best')).toBeNull();
    expect((await getProject(p.id))!.sceneStates.s2?.chosenPictureId).toBeUndefined();
  });
});
