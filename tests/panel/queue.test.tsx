import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { sceneMarks } from '../../src/panel/PanelQueue';
import { STEP_KEY, type Step } from '../../src/runs/activity';
import { reduceRun, SKIPPED_MESSAGE, type RunState } from '../../src/runs/run';
import { getMediaStore, saveProject, type Project, type SceneState } from '../../src/store/projects';
import { clearProjects, fakeBackground, runningState, sceneId, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.size}`, revokeObjectURL: () => undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const step = (projectId: string, scene: number, text: string, target: Step['target'] = 'generate'): Step => ({
  projectId,
  sceneId: sceneId(scene),
  text,
  target,
  at: Date.now(),
});

const done = (i: number, pictures = 2): SceneState => ({
  sceneId: sceneId(i),
  status: 'done',
  pictureIds: Array.from({ length: pictures }, (_, k) => `p/${i}-${k + 1}`),
  cardKeys: Array.from({ length: pictures }, (_, k) => `k${i}-${k + 1}`),
});

/** The Queue tab's rows, by scene number. */
function row(n: number): HTMLElement {
  const rows = within(screen.getByRole('list', { name: 'Scenes' })).getAllByRole('listitem');
  const found = rows.find((r) => r.getAttribute('data-scene') === sceneId(n));
  if (!found) throw new Error(`no row for scene ${n}`);
  return found;
}

async function openQueue() {
  fireEvent.click(await screen.findByRole('tab', { name: /^Queue/ }));
  return screen.findByRole('list', { name: 'Scenes' });
}

describe('side panel: the Queue tab', () => {
  it('shows step, progress and "8 saved · 2 being drawn · 14 to go · 0 failed"', async () => {
    const p = await seed('Phone Bill Story', 24);
    stubChrome({ [STEP_KEY]: step(p.id, 9, 'Checking picture 2 of 2 matches its prompt', 'tile') });
    render(<Panel client={fakeBackground(runningState(p, 8, 2)).client()} />);

    // A live run opens on Queue.
    expect((await screen.findByRole('tab', { name: 'Queue 24' })).getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Phone Bill Story')).toBeTruthy();
    expect(await screen.findByText('Scene 9 of 24 · Checking picture 2 of 2 matches its prompt')).toBeTruthy();
    // Saved, plus half for those being drawn: (8 + 1) / 24.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('38');
    expect(screen.getByText('8 saved · 2 being drawn · 14 to go · 0 failed')).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Scenes' })).getAllByRole('listitem')).toHaveLength(24);
    // One coral primary: Pause.
    const primaries = document.querySelectorAll('[data-variant="primary"]');
    expect([...primaries].map((b) => b.textContent)).toEqual(['Pause']);
  });

  it('filters All / Drawing / To go / Failed / Done with counts', async () => {
    const p = await seed('Phone Bill Story', 6);
    stubChrome();
    let run = runningState(p, 2, 2);
    run = reduceRun(run, { type: 'failed', sceneId: sceneId(4), message: 'Flow took too long.' });
    render(<Panel client={fakeBackground(run).client()} />);
    await openQueue();

    const names = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['All 6', 'Drawing 1', 'To go 2', 'Failed 1', 'Done 2']);
    expect(screen.getByRole('button', { name: 'All 6' }).getAttribute('aria-pressed')).toBe('true');

    const shown = () => within(screen.getByRole('list', { name: 'Scenes' })).queryAllByRole('listitem').map((r) => r.getAttribute('data-scene'));
    fireEvent.click(screen.getByRole('button', { name: 'Drawing 1' }));
    expect(shown()).toEqual([sceneId(3)]);
    expect(screen.getByRole('button', { name: 'Drawing 1' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'To go 2' }));
    expect(shown()).toEqual([sceneId(5), sceneId(6)]);
    fireEvent.click(screen.getByRole('button', { name: 'Failed 1' }));
    expect(shown()).toEqual([sceneId(4)]);
    fireEvent.click(screen.getByRole('button', { name: 'Done 2' }));
    expect(shown()).toEqual([sceneId(1), sceneId(2)]);
    fireEvent.click(screen.getByRole('button', { name: 'All 6' }));
    expect(shown()).toHaveLength(6);
  });

  it('each row shows thumbnail, number, sentence, timecode and only the true marks "✓ checked · hero ✓ · 2 options"', async () => {
    const p = await seed('Phone Bill Story', 3, (x) => {
      x.character = { description: 'A stickman', referenceMediaId: 'hero/ref' };
      // Both made with the hero reference attached in Flow.
      x.sceneStates = { [sceneId(1)]: { ...done(1), withHero: true }, [sceneId(2)]: { ...done(2, 1), withHero: true } };
    });
    await getMediaStore().put(p.id, '1-1', new Blob(['one']));
    stubChrome();
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();

    const first = row(1);
    expect(first.textContent).toContain('01 · "Sentence 1."');
    expect(first.textContent).toContain('00:00–00:04 · ✓ checked · hero ✓ · 2 options');
    // The chosen picture's thumbnail (Flow's first, as nothing was chosen).
    expect(within(first).getByText('✓ Saved')).toBeTruthy();
    // One picture: no "options" mark.
    expect(row(2).textContent).toContain('00:04–00:08 · ✓ checked · hero ✓');
    expect(row(2).textContent).not.toContain('option');
    // Not made yet: an empty frame and no marks at all.
    expect(row(3).textContent).toContain('03 · "Sentence 3."');
    expect(row(3).textContent).toContain('00:08–00:12');
    expect(row(3).textContent).not.toContain('checked');
    expect(row(3).querySelector('img')).toBeNull();

    expect(sceneMarks({ ...done(1), withHero: true }, p)).toEqual({ checked: true, hero: true, options: 2 });
    expect(sceneMarks(undefined, p)).toEqual({ checked: false, hero: false, options: 0 });
    expect(sceneMarks({ ...done(1), cardKeys: undefined, pictureIds: [] }, p)).toEqual({ checked: false, hero: false, options: 0 });
  });

  it('"hero ✓" is true for that scene: made with the reference attached, whatever the hero is now', async () => {
    const p = await seed('Phone Bill Story', 2, (x) => {
      // Scene 1 was made without a reference; the hero's reference was added afterwards.
      x.character = { description: 'A stickman', referenceMediaId: 'hero/ref' };
      x.sceneStates = { [sceneId(1)]: { ...done(1), withHero: false }, [sceneId(2)]: done(2) };
    });
    stubChrome();
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    expect(row(1).textContent).not.toContain('hero ✓');
    // Saved before VidFlow recorded it: no mark rather than a guess.
    expect(row(2).textContent).not.toContain('hero ✓');
    expect(sceneMarks({ ...done(1), withHero: false }, p).hero).toBe(false);
    // Made with the reference, then the reference was removed: the scene's pictures still have the hero.
    expect(sceneMarks({ ...done(1), withHero: true }, { ...p, character: null }).hero).toBe(true);
    expect(sceneMarks({ sceneId: sceneId(1), status: 'failed', pictureIds: [], withHero: true }, p).hero).toBe(false);
  });

  it('shows the thumbnail of the chosen picture', async () => {
    const p = await seed('Phone Bill Story', 1, (x) => (x.sceneStates = { [sceneId(1)]: { ...done(1), chosenPictureId: 'p/1-2' } }));
    const media = getMediaStore();
    const get = vi.spyOn(media, 'get').mockImplementation(async (id: string) => new Blob([id]));
    stubChrome();
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    await waitFor(() => expect(row(1).querySelector('img')?.getAttribute('src')).toBe(`blob:${'p/1-2'.length}`));
    expect(get.mock.calls.map((c) => c[0])).toEqual(['p/1-2']);
  });

  it("status tags: ✓ Saved, Checking, Drawing, Failed with reason, Refused with Flow's reason", async () => {
    const p = await seed('Phone Bill Story', 6);
    stubChrome({ [STEP_KEY]: step(p.id, 2, 'Checking picture 1 of 2 matches its prompt', 'tile') });
    let run = runningState(p, 1, 2);
    run = reduceRun(reduceRun(run, { type: 'submitted', sceneId: sceneId(4) }), { type: 'failed', sceneId: sceneId(4), message: "Flow didn't finish this picture in 10 minutes." });
    run = reduceRun(reduceRun(run, { type: 'submitted', sceneId: sceneId(5) }), { type: 'refused', sceneId: sceneId(5), message: 'This prompt might violate our policies.' });
    render(<Panel client={fakeBackground(run).client()} />);
    await screen.findByRole('list', { name: 'Scenes' });

    expect(within(row(1)).getByText('✓ Saved').getAttribute('data-tone')).toBe('done');
    // The scene being worked on: coral outline, its step in the second line.
    await waitFor(() => expect(within(row(2)).getByText('Checking')).toBeTruthy());
    expect(row(2).getAttribute('aria-current')).toBe('step');
    expect(row(2).textContent).toContain('checking picture 1 of 2 matches its prompt');
    expect(within(row(3)).getByText('Drawing')).toBeTruthy();
    expect(row(3).textContent).toContain('sent to Flow');
    expect(within(row(4)).getByText('Failed')).toBeTruthy();
    expect(row(4).textContent).toContain("Flow didn't finish this picture in 10 minutes.");
    expect(within(row(5)).getByText('Refused')).toBeTruthy();
    expect(row(5).textContent).toContain('This prompt might violate our policies.');
    // Waiting its turn: no tag, only ▶ Run.
    expect(row(6).querySelector('.vf-pn-tag')).toBeNull();
    expect(within(row(6)).getByRole('button', { name: 'Run scene 6' })).toBeTruthy();
    expect(within(row(1)).queryByRole('button', { name: /^Run scene/ })).toBeNull();
    expect(within(row(3)).queryByRole('button', { name: /^Run scene/ })).toBeNull();
  });

  it('▶ Run makes just that scene and is disabled while a run is live (says why)', async () => {
    const p = await seed('Phone Bill Story', 4);
    stubChrome();
    const bg = fakeBackground(runningState(p, 1, 1));
    const client = bg.client();
    render(<Panel client={client} />);
    await screen.findByRole('list', { name: 'Scenes' });

    const run4 = within(row(4)).getByRole('button', { name: 'Run scene 4' }) as HTMLButtonElement;
    expect(run4.disabled).toBe(true);
    const why = document.getElementById(run4.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe('▶ Run and Retry failed work once this run has finished or you stop it.');
    expect(screen.getByText('▶ Run and Retry failed work once this run has finished or you stop it.')).toBeTruthy();

    // Stopped: ▶ Run works and asks for just that scene.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
    await openQueue();
    const again = within(row(4)).getByRole('button', { name: 'Run scene 4' }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    expect(screen.queryByText(/work once this run has finished/)).toBeNull();
    await act(async () => fireEvent.click(again));
    expect(client.retry).toHaveBeenCalledWith(p.id, sceneId(4));
    expect(client.retry).toHaveBeenCalledTimes(1);
    expect(client.start).not.toHaveBeenCalled();
  });

  it('Retry failed appears only when something failed', async () => {
    const p = await seed('Phone Bill Story', 4, (x) => {
      x.sceneStates = {
        [sceneId(1)]: done(1),
        [sceneId(2)]: { sceneId: sceneId(2), status: 'failed', message: SKIPPED_MESSAGE, pictureIds: [] },
        [sceneId(3)]: { sceneId: sceneId(3), status: 'refused', message: 'No.', pictureIds: [] },
        [sceneId(4)]: done(4),
      };
    });
    stubChrome();
    const client = fakeBackground(null).client();
    render(<Panel client={client} />);
    await openQueue();
    // A skipped scene shows why.
    expect(row(2).textContent).toContain('Skipped by you');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry failed' })));
    expect(vi.mocked(client.retry).mock.calls).toEqual([
      [p.id, sceneId(2)],
      [p.id, sceneId(3)],
    ]);
    // Setup would allow Start (the failed scene is still to make): the Queue's coral is Start, as there.
    expect([...document.querySelectorAll('[data-variant="primary"]')].map((x) => x.textContent)).toEqual(['Start making pictures']);

    cleanup();
    const ok = await seed('All done', 2, (x) => (x.sceneStates = { [sceneId(1)]: done(1), [sceneId(2)]: done(2) }));
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    expect(screen.queryByRole('button', { name: 'Retry failed' })).toBeNull();
    expect(screen.getByText('All 2 scenes have pictures.')).toBeTruthy();
    // Nothing to make: no coral at all (the full studio is one link away in the header).
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(0);
    expect(ok.name).toBe('All done');
  });

  it('with nothing live, the coral primary is Start making pictures when there is something to make', async () => {
    const p = await seed('Phone Bill Story', 3, (x) => (x.sceneStates = { [sceneId(1)]: done(1) }));
    stubChrome();
    const client = fakeBackground(null).client();
    render(<Panel client={client} />);
    await openQueue();
    expect(screen.getByText('1 of 3 scenes have pictures.')).toBeTruthy();
    const primaries = [...document.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);
    expect(primaries).toEqual(['Start making pictures']);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start making pictures' })));
    expect(client.start).toHaveBeenCalledWith(p.id);
  });

  it('clicking a done row shows its options with the one-click swap', async () => {
    const p = await seed('Phone Bill Story', 2, (x) => (x.sceneStates = { [sceneId(1)]: done(1) }));
    const media = getMediaStore();
    vi.spyOn(media, 'get').mockImplementation(async (id: string) => new Blob([id]));
    stubChrome();
    const client = fakeBackground(null).client();
    vi.mocked(client.choose).mockImplementation(async (projectId, sid, pictureId) => {
      // The background saves the choice in the project, as chooseScenePicture does with no run live.
      const fresh = { ...p, sceneStates: { [sid]: { ...done(1), chosenPictureId: pictureId } } } as Project;
      await saveProject(fresh);
      expect(projectId).toBe(p.id);
      return { ok: true, state: null };
    });
    render(<Panel client={client} />);
    await openQueue();

    // A row without pictures doesn't open.
    expect(within(row(2)).queryByRole('button', { expanded: false })).toBeNull();
    const opener = within(row(1)).getByRole('button', { expanded: false });
    fireEvent.click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    const options = await screen.findByRole('region', { name: 'Scene 01 options' });
    expect(within(options).getByText('★ Using this')).toBeTruthy();
    expect(within(options).getByText('Option 1 of 2')).toBeTruthy();

    await act(async () => fireEvent.click(within(options).getByRole('button', { name: 'Use this picture' })));
    expect(client.choose).toHaveBeenCalledWith(p.id, sceneId(1), 'p/1-2');
    await waitFor(() => {
      const using = within(options).getByText('★ Using this').closest('figure');
      expect(using?.getAttribute('data-picture-id')).toBe('p/1-2');
    });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-picture-id')).toBe('p/1-2'));
  });

  it('a refused swap puts the picture back and says why', async () => {
    await seed('Phone Bill Story', 1, (x) => (x.sceneStates = { [sceneId(1)]: done(1) }));
    stubChrome();
    const client = fakeBackground(null).client();
    vi.mocked(client.choose).mockResolvedValue({ ok: false, message: "That picture isn't one of this scene's pictures any more." });
    render(<Panel client={client} />);
    await openQueue();
    fireEvent.click(within(row(1)).getByRole('button', { expanded: false }));
    const options = await screen.findByRole('region', { name: 'Scene 01 options' });
    await act(async () => fireEvent.click(within(options).getByRole('button', { name: 'Use this picture' })));
    expect((await screen.findByRole('alert')).textContent).toBe("That picture isn't one of this scene's pictures any more.");
    expect(within(options).getByText('★ Using this').closest('figure')?.getAttribute('data-picture-id')).toBe('p/1-1');
  });

  it('Pause/Resume, Stop, Skip call the client', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const client = fakeBackground(runningState(p, 2, 1)).client();
    render(<Panel client={client} />);

    const pause = await screen.findByRole('button', { name: 'Pause' });
    expect(pause.getAttribute('data-variant')).toBe('primary');
    expect(screen.getByRole('button', { name: 'Skip' }).getAttribute('data-variant')).toBe('secondary');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Skip' })));
    expect(client.skip).toHaveBeenCalledTimes(1);

    await act(async () => fireEvent.click(pause));
    expect(client.pause).toHaveBeenCalled();
    const resume = await screen.findByRole('button', { name: 'Resume' });
    // Paused: nothing is being worked on, so there is nothing to skip; it says why.
    const skip = screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement;
    expect(skip.disabled).toBe(true);
    expect(document.getElementById(skip.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Skip works while VidFlow is making pictures.');
    expect(resume.getAttribute('data-variant')).toBe('primary');
    expect(screen.getByText('Paused · press Resume to carry on')).toBeTruthy();
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    await act(async () => fireEvent.click(resume));
    expect(client.resume).toHaveBeenCalled();

    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Stop' })));
    expect(client.stop).toHaveBeenCalled();
  });

  it('a refused request shows its plain reason', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, (x) => (x.sceneStates = { [sceneId(1)]: { sceneId: sceneId(1), status: 'failed', message: 'x', pictureIds: [] } }));
    const client = fakeBackground(null).client();
    vi.mocked(client.retry).mockResolvedValue({ ok: false, message: 'Another project is making pictures right now.' });
    render(<Panel client={client} />);
    await openQueue();
    await act(async () => fireEvent.click(within(row(2)).getByRole('button', { name: 'Run scene 2' })));
    expect((await screen.findByRole('alert')).textContent).toBe('Another project is making pictures right now.');
    expect(p.scenes).toHaveLength(3);
  });

  it('renders 200 rows and filters them', async () => {
    const p = await seed('Long Story', 200);
    const media = getMediaStore();
    const get = vi.spyOn(media, 'get').mockImplementation(async (id: string) => new Blob([id]));
    stubChrome();
    const run: RunState = runningState(p, 50, 2);
    const started = performance.now();
    render(<Panel client={fakeBackground(run).client()} />);
    const list = await screen.findByRole('list', { name: 'Scenes' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(200);
    expect(screen.getByRole('tab', { name: 'Queue 200' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Done 50' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'To go 148' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(148);
    expect(performance.now() - started).toBeLessThan(5_000);
    // Thumbnails are read only for rows on screen, never all 200 scenes' pictures.
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(get.mock.calls.length).toBeLessThanOrEqual(30);
  });
});
