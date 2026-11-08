import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { liveView } from '../../src/flow/live';
import { pillLine } from '../../src/flow/pill';
import { CLIP_ASPECT_MESSAGE } from '../../src/flow/messages';
import { Panel } from '../../src/panel/Panel';
import { STEP_KEY, type Step } from '../../src/runs/activity';
import { NOT_AUTO_CHECKED } from '../../src/runs/autopick';
import { BALANCE_NOTE, CREDIT_LIMIT_NOTE, initAutoPickRun, initClipRun, reduceRun, type RunState } from '../../src/runs/run';
import { AUTO_PICK_KEY } from '../../src/settings';
import { getProject, type Project, type SceneState } from '../../src/store/projects';
import { clearProjects, fakeBackground, runningState, sceneId, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => `blob:${b.size}`, revokeObjectURL: () => undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CLIP_UNSURE =
  "VidFlow couldn't tell whether Flow started this clip. Check the Flow window, then press Resume — or Skip this slide.";

const done = (i: number, extra: Partial<SceneState> = {}): SceneState => ({
  sceneId: sceneId(i),
  status: 'done',
  pictureIds: [`p/${i}-1`, `p/${i}-2`],
  ...extra,
});
const clip = (picture: string) => ({ mediaId: `c/${picture}`, sourcePictureId: picture, length: 4, use: [0, 4] as [number, number] });

/** A video of `n` four-second slides, every one with its pictures (each clip: 4 s = 7 credits). */
function withPictures(n: number, edit: (p: Project) => void = () => undefined) {
  return (p: Project) => {
    for (let i = 1; i <= n; i++) p.sceneStates[sceneId(i)] = done(i);
    edit(p);
  };
}

const primaries = () => [...document.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);
const step = (projectId: string, scene: number, text: string): Step => ({ projectId, sceneId: sceneId(scene), text, target: 'generate', at: Date.now() });

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

describe('side panel: Setup · Motion', () => {
  it('Stills only / Clips for the slides I pick / Clips for every slide', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, withPictures(3));
    render(<Panel client={fakeBackground(null).client()} />);

    const group = await screen.findByRole('radiogroup', { name: 'Motion' });
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['Stills only', 'Clips for the slides I pick', 'Clips for every slide']);
    // Stills only by default: nothing spends credits until clips are chosen.
    expect(radios[0]!.checked).toBe(true);
    expect(screen.getByText(/Stills only: every slide uses its picture · 0 credits/)).toBeTruthy();

    fireEvent.click(within(group).getByRole('radio', { name: 'Clips for every slide' }));
    expect((within(group).getByRole('radio', { name: 'Clips for every slide' }) as HTMLInputElement).checked).toBe(true);
    await waitFor(async () => expect((await getProject(p.id))!.motionMode).toBe('all'));
  });

  it('shows clips · credits needed · credits left · limit (defaults to estimate)', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, withPictures(3, (p) => (p.motionMode = 'all')));
    const bg = fakeBackground(null);
    const client = bg.client();
    const view = render(<Panel client={client} />);

    expect(await screen.findByText('3 clips · 21 credits needed · credits left: checked when you start')).toBeTruthy();
    const limit = screen.getByRole('spinbutton', { name: 'Credit limit for this run' }) as HTMLInputElement;
    expect(limit.value).toBe('21');

    // Lowered: the run stops before passing it.
    fireEvent.change(limit, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make clips (21 credits)' }));
    await waitFor(() => expect(client.makeClips).toHaveBeenCalledWith(p.id, 14));

    // Raised past the estimate: it never asks for more than the clips need.
    fireEvent.change(limit, { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make clips (21 credits)' }));
    await waitFor(() => expect(client.makeClips).toHaveBeenLastCalledWith(p.id, 21));
    view.unmount();

    // A clip run read Flow's balance: what is left after what it spent.
    const clipRun: RunState = { ...initClipRun(p, [sceneId(1)], 7), status: 'finished', balance: 100, spent: 14 };
    render(<Panel client={fakeBackground(clipRun).client()} />);
    expect(await screen.findByText('3 clips · 21 credits needed · 86 credits left')).toBeTruthy();
  });

  it('coral "Make clips (N credits)" only when clips are chosen and something is left to make', async () => {
    const cases: { name: string; edit: (p: Project) => void; coral: string }[] = [
      { name: 'stills', edit: withPictures(3), coral: 'Review in the full studio' },
      { name: 'picked, none picked', edit: withPictures(3, (p) => (p.motionMode = 'picked')), coral: 'Review in the full studio' },
      {
        name: 'picked, slide 2',
        edit: withPictures(3, (p) => Object.assign(p, { motionMode: 'picked', clipPicks: [sceneId(2)] })),
        coral: 'Make clips (7 credits)',
      },
      {
        name: 'every slide, all clips made',
        edit: withPictures(3, (p) => {
          p.motionMode = 'all';
          for (let i = 1; i <= 3; i++) p.sceneStates[sceneId(i)] = done(i, { clip: clip(`p/${i}-1`) });
        }),
        coral: 'Review in the full studio',
      },
      {
        name: 'every slide, one clip stale',
        edit: withPictures(3, (p) => {
          p.motionMode = 'all';
          for (let i = 1; i <= 3; i++) p.sceneStates[sceneId(i)] = done(i, { clip: clip(`p/${i}-1`) });
          p.sceneStates[sceneId(3)] = done(3, { clip: clip('p/3-1'), chosenPictureId: 'p/3-2', choiceSource: 'owner' });
        }),
        coral: 'Make clips (7 credits)',
      },
      {
        name: 'pictures still to make',
        edit: (p) => {
          p.motionMode = 'all';
          p.sceneStates[sceneId(1)] = done(1);
        },
        coral: 'Start making pictures',
      },
    ];
    for (const c of cases) {
      await clearProjects();
      stubChrome();
      await seed(c.name, 3, c.edit);
      render(<Panel client={fakeBackground(null).client()} />);
      await screen.findByRole('radiogroup', { name: 'Motion' });
      await waitFor(() => expect(primaries(), c.name).toEqual([c.coral]));
      cleanup();
    }
  });

  it('1:1 greys the clip choices with the reason', async () => {
    stubChrome();
    await seed('Square Story', 3, withPictures(3, (p) => Object.assign(p, { aspect: '1:1', motionMode: 'all' })));
    render(<Panel client={fakeBackground(null).client()} />);

    const group = await screen.findByRole('radiogroup', { name: 'Motion' });
    expect((within(group).getByRole('radio', { name: 'Stills only' }) as HTMLInputElement).disabled).toBe(false);
    for (const name of ['Clips for the slides I pick', 'Clips for every slide']) {
      const radio = within(group).getByRole('radio', { name }) as HTMLInputElement;
      expect(radio.disabled).toBe(true);
      expect(document.getElementById(radio.getAttribute('aria-describedby')!)!.textContent).toBe(CLIP_ASPECT_MESSAGE);
    }
    expect(screen.queryByRole('button', { name: /^Make clips/ })).toBeNull();
    expect(primaries()).toEqual(['Review in the full studio']);
  });
});

describe('side panel: Queue · clips and Auto-pick', () => {
  it('Clip tick per slide in "picked" mode, pick all / pick none', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, withPictures(3, (p) => Object.assign(p, { motionMode: 'picked', clipPicks: [sceneId(2)] })));
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();

    const tick = (n: number) => within(row(n)).getByRole('checkbox', { name: `Clip for slide ${n}` }) as HTMLInputElement;
    expect([1, 2, 3].map((n) => tick(n).checked)).toEqual([false, true, false]);

    fireEvent.click(tick(1));
    await waitFor(async () => expect((await getProject(p.id))!.clipPicks).toEqual([sceneId(1), sceneId(2)]));
    fireEvent.click(screen.getByRole('button', { name: 'Pick all' }));
    await waitFor(async () => expect((await getProject(p.id))!.clipPicks).toEqual([sceneId(1), sceneId(2), sceneId(3)]));
    expect([1, 2, 3].map((n) => tick(n).checked)).toEqual([true, true, true]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick none' }));
    await waitFor(async () => expect((await getProject(p.id))!.clipPicks).toEqual([]));
  });

  it('no Clip ticks outside "picked" mode', async () => {
    stubChrome();
    await seed('Phone Bill Story', 3, withPictures(3, (p) => (p.motionMode = 'all')));
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    expect(screen.queryByRole('checkbox', { name: /Clip for slide/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pick all' })).toBeNull();
  });

  it('🎬 clip ✓ / picture changed — make again / Not made — credit limit', async () => {
    stubChrome();
    await seed(
      'Phone Bill Story',
      4,
      withPictures(4, (p) => {
        p.motionMode = 'all';
        p.sceneStates[sceneId(1)] = done(1, { clip: clip('p/1-1') });
        p.sceneStates[sceneId(2)] = done(2, { clip: clip('p/2-1'), chosenPictureId: 'p/2-2', choiceSource: 'owner' });
        p.sceneStates[sceneId(3)] = done(3, { clipNote: CREDIT_LIMIT_NOTE });
        p.sceneStates[sceneId(4)] = done(4, { clipNote: BALANCE_NOTE });
      }),
    );
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    expect(row(1).textContent).toContain('🎬 clip ✓');
    expect(row(2).textContent).toContain('picture changed — make again');
    expect(row(2).textContent).not.toContain('🎬 clip ✓');
    expect(row(3).textContent).toContain('Not made — credit limit');
    expect(row(4).textContent).toContain('Not made — not enough Flow credits');
  });

  it('Auto-picked: <reason> / not auto-checked marks', async () => {
    stubChrome();
    await seed(
      'Phone Bill Story',
      3,
      withPictures(3, (p) => {
        p.sceneStates[sceneId(1)] = done(1, { chosenPictureId: 'p/1-2', choiceSource: 'auto', autoReason: 'shows the shoulder bag', autoChecked: true });
        p.sceneStates[sceneId(2)] = done(2, { autoReason: NOT_AUTO_CHECKED, autoChecked: true });
      }),
    );
    render(<Panel client={fakeBackground(null).client()} />);
    await openQueue();
    expect(row(1).textContent).toContain('Auto-picked: shows the shoulder bag');
    expect(row(2).textContent).toContain('Not auto-checked');
    expect(row(3).textContent).not.toMatch(/auto-picked|auto-checked/i);
  });

  it('shows a clip run: "Clip N of M", credits, Pause/Stop/Skip, and "Skip slide N" in the unsure pause', async () => {
    const p = await seed('Phone Bill Story', 3, withPictures(3, (p) => (p.motionMode = 'all')));
    stubChrome({ [STEP_KEY]: step(p.id, 2, 'Pressing Generate') });
    let run = reduceRun(initClipRun(p, [sceneId(1), sceneId(2), sceneId(3)], 21), { type: 'start' });
    run = reduceRun(run, { type: 'submitted', sceneId: sceneId(1) });
    run = reduceRun(run, { type: 'clip', sceneId: sceneId(1), clip: clip('p/1-1'), cardKey: 'c1' });
    run = reduceRun(run, { type: 'submitted', sceneId: sceneId(2) });
    run = { ...run, spent: 14 };
    const bg = fakeBackground(run);
    const client = bg.client();
    const view = render(<Panel client={client} />);

    // A live clip run opens on Queue.
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Queue/ }).getAttribute('aria-selected')).toBe('true'));
    expect(await screen.findByText('Clip 2 of 3 · Pressing Generate')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Clips made' }).getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText('1 made · 1 being made · 1 to go · 0 not made · 14 of 21 credits used')).toBeTruthy();
    expect(within(row(2)).getByText('Making clip')).toBeTruthy();
    expect(row(2).getAttribute('aria-current')).toBe('step');
    expect(primaries()).toEqual(['Pause']);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(false);
    view.unmount();

    // Paused: VidFlow couldn't tell whether Flow started slide 3's clip. Skip means that slide.
    let unsure = reduceRun(run, { type: 'clip', sceneId: sceneId(2), clip: clip('p/2-1'), cardKey: 'c2' });
    unsure = reduceRun(unsure, { type: 'needsOwner', reason: 'page-not-recognised', message: CLIP_UNSURE, sceneId: sceneId(3) });
    const paused = fakeBackground(unsure);
    const pausedClient = paused.client();
    render(<Panel client={pausedClient} />);
    expect(await screen.findByText(CLIP_UNSURE)).toBeTruthy();
    expect(primaries()).toEqual(['Resume']);
    const skip = screen.getByRole('button', { name: 'Skip slide 3' }) as HTMLButtonElement;
    expect(skip.disabled).toBe(false);
    fireEvent.click(skip);
    await waitFor(() => expect(pausedClient.skip).toHaveBeenCalled());
  });

  it('shows an Auto-pick run: "Auto-picking slide N of M" with Pause/Stop/Skip', async () => {
    const p = await seed('Phone Bill Story', 3, withPictures(3));
    stubChrome();
    let run = reduceRun(initAutoPickRun(p, [sceneId(1), sceneId(2), sceneId(3)]), { type: 'start' });
    run = reduceRun(run, { type: 'autoPicked', sceneId: sceneId(1), pictureId: 'p/1-2', reason: 'shows the bag', miss: false });
    render(<Panel client={fakeBackground(run).client()} />);

    await waitFor(() => expect(screen.getByRole('tab', { name: /^Queue/ }).getAttribute('aria-selected')).toBe('true'));
    expect(await screen.findByText('Auto-picking slide 2 of 3')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Slides auto-picked' }).getAttribute('aria-valuenow')).toBe('33');
    expect(screen.getByText('1 checked · 2 to go')).toBeTruthy();
    expect(primaries()).toEqual(['Pause']);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('the Flow pill reads "Clip N of M · <step>" and "Auto-picking slide N of M"', async () => {
    const p = await seed('Phone Bill Story', 3, withPictures(3));
    let clips = reduceRun(initClipRun(p, [sceneId(1), sceneId(2), sceneId(3)], 21), { type: 'start' });
    clips = reduceRun(clips, { type: 'submitted', sceneId: sceneId(1) });
    expect(pillLine(liveView(clips, step(p.id, 1, 'Pressing Generate'), p)!)).toBe('Clip 1 of 3 · Pressing Generate');
    expect(pillLine(liveView(clips, null, p)!)).toBe('Making clip 1 of 3');

    let pick = reduceRun(initAutoPickRun(p, [sceneId(1), sceneId(2), sceneId(3)]), { type: 'start' });
    pick = reduceRun(pick, { type: 'autoPicked', sceneId: sceneId(1), pictureId: 'p/1-1', reason: 'r', miss: false });
    expect(pillLine(liveView(pick, null, p)!)).toBe('Auto-picking slide 2 of 3');
    expect(pillLine(liveView(pick, step(p.id, 2, 'Asking Flow’s Agent'), p)!)).toBe('Auto-picking slide 2 of 3 · Asking Flow’s Agent');

    // A picture run reads as before.
    expect(pillLine(liveView(runningState({ ...p, sceneStates: {} }, 1, 1), null, p)!)).toBe('Picture 2 of 3');
  });
});

describe('side panel: Checks · Auto-pick', () => {
  it('Auto-pick the better picture switch (on)', async () => {
    const chrome = stubChrome();
    await seed('Phone Bill Story', 3, withPictures(3));
    render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));

    const toggle = await screen.findByRole('switch', { name: 'Auto-pick the better picture' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(chrome.data[AUTO_PICK_KEY]).toBe(false));
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('Auto-pick now', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, withPictures(3));
    const client = fakeBackground(null).client();
    const view = render(<Panel client={client} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));

    const now = await screen.findByRole('button', { name: 'Auto-pick now' });
    expect(now.getAttribute('data-variant')).toBe('secondary');
    fireEvent.click(now);
    await waitFor(() => expect(client.autoPick).toHaveBeenCalledWith(p.id));
    // Still one coral on Checks.
    expect(primaries()).toEqual(['Check again']);
    view.unmount();

    // While a run is live it waits, and says why.
    const live = fakeBackground(runningState({ ...p, sceneStates: {} }, 1, 1)).client();
    render(<Panel client={live} />);
    // A live run opens the panel on Queue; then Checks.
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Queue/ }).getAttribute('aria-selected')).toBe('true'));
    fireEvent.click(screen.getByRole('tab', { name: 'Checks' }));
    const waiting = (await screen.findByRole('button', { name: 'Auto-pick now' })) as HTMLButtonElement;
    await waitFor(() => expect(waiting.disabled).toBe(true));
    const why = document.getElementById(waiting.getAttribute('aria-describedby')!)!;
    expect(why.textContent).toBe('Auto-pick now works once the current run has finished or is stopped.');
  });
});
