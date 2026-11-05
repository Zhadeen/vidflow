import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { ACTIVITY_KEY, STEP_KEY, type ActivityEntry, type Step } from '../../src/runs/activity';
import { memoryMediaStore } from '../../src/store/media';
import { App } from '../../src/studio/App';
import { readFileSync } from 'node:fs';
import { saveEdits } from '../../src/studio/projectEdits';
import { clearProjects, fakeBackground, runningState, scenes, sceneId, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = '';
});

const panelCss = readFileSync('src/panel/panel.css', 'utf8');

const step = (projectId: string, scene: number, text: string): Step => ({
  projectId,
  sceneId: sceneId(scene),
  text,
  target: 'generate',
  at: Date.now(),
});

describe('side panel: while it runs', () => {
  it('shows step, progress, counts and the scene strip (saved ✓ cream, current coral outline, upcoming navy)', async () => {
    const p = await seed('Phone Bill Story', 6);
    const entries: ActivityEntry[] = Array.from({ length: 7 }, (_, i) => ({ at: 1000 * i, projectId: p.id, sceneId: null, text: `Line ${i}` }));
    stubChrome({ [STEP_KEY]: step(p.id, 3, 'Pressing Generate'), [ACTIVITY_KEY]: entries });
    render(<Panel client={fakeBackground(runningState(p, 2, 2)).client()} />);

    expect(await screen.findByText('Phone Bill Story')).toBeTruthy();
    expect(await screen.findByText('Scene 3 of 6 · Pressing Generate')).toBeTruthy();
    // The same progress as the Flow pill: saved, plus half for those being drawn.
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText('2 saved · 2 being drawn · 2 to go')).toBeTruthy();

    const strip = within(screen.getByRole('list', { name: 'Scenes' })).getAllByRole('listitem');
    expect(strip.map((s) => s.textContent)).toEqual(['✓1', '✓2', '3', '4', '5', '6']);
    // Scene 4 is with Flow too but isn't the one being worked on: navy like the upcoming ones.
    expect(strip.map((s) => s.getAttribute('data-state'))).toEqual(['saved', 'saved', 'current', 'drawing', 'upcoming', 'upcoming']);

    // Saved = cream, the one being worked on = coral outline, the rest navy.
    const rule = (state: string) => new RegExp(`li\\[data-state='${state}'\\]\\s*\\{([^}]*)\\}`).exec(panelCss)?.[1] ?? '';
    expect(rule('saved')).toContain('background: var(--vf-cream)');
    expect(rule('current')).toContain('border: 2px solid var(--vf-coral)');
    expect(rule('upcoming')).toBe('');
    expect(/\.vf-pn-strip li \{[^}]*background: var\(--vf-navy-line\)/.test(panelCss)).toBe(true);

    // The newest five activity lines; no switch here (the approved panel has one coral element: the primary).
    const activity = screen.getByRole('region', { name: 'Activity' });
    await waitFor(() => expect(within(activity).getAllByRole('listitem')).toHaveLength(5));
    expect(within(activity).getByText('Line 6')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('follows the step as it changes', async () => {
    const p = await seed('Phone Bill Story', 6);
    const chrome = stubChrome({ [STEP_KEY]: step(p.id, 3, 'Typing the prompt') });
    render(<Panel client={fakeBackground(runningState(p, 2, 1)).client()} />);
    expect(await screen.findByText('Scene 3 of 6 · Typing the prompt')).toBeTruthy();
    await act(async () => {
      await (globalThis as unknown as { chrome: typeof chrome & { storage: { local: { set(i: object): Promise<void> } } } }).chrome.storage.local.set({
        [STEP_KEY]: step(p.id, 3, 'Pressing Generate'),
      });
    });
    expect(await screen.findByText('Scene 3 of 6 · Pressing Generate')).toBeTruthy();
  });

  it("scrolls the current scene's strip tile into view when the scene changes", async () => {
    const scrolled: Array<{ text: string | null; opts: unknown }> = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: (o?: unknown) => void };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement, opts?: unknown) {
      scrolled.push({ text: this.textContent, opts });
    };
    try {
      const p = await seed('Phone Bill Story', 6);
      stubChrome({ [STEP_KEY]: step(p.id, 3, 'Typing the prompt') });
      render(<Panel client={fakeBackground(runningState(p, 2, 1)).client()} />);
      await screen.findByText('Scene 3 of 6 · Typing the prompt');
      await waitFor(() => expect(scrolled).toEqual([{ text: '3', opts: { block: 'nearest' } }]));

      // Another step on the same scene: no scroll (the owner may have scrolled the strip themselves).
      await act(async () => {
        await (globalThis as unknown as { chrome: { storage: { local: { set(i: object): Promise<void> } } } }).chrome.storage.local.set({
          [STEP_KEY]: step(p.id, 3, 'Pressing Generate'),
        });
      });
      await screen.findByText('Scene 3 of 6 · Pressing Generate');
      expect(scrolled).toHaveLength(1);

      await act(async () => {
        await (globalThis as unknown as { chrome: { storage: { local: { set(i: object): Promise<void> } } } }).chrome.storage.local.set({
          [STEP_KEY]: step(p.id, 4, 'Typing the prompt'),
        });
      });
      await waitFor(() => expect(scrolled.at(-1)).toEqual({ text: '4', opts: { block: 'nearest' } }));
      expect(scrolled).toHaveLength(2);
    } finally {
      if (had) proto.scrollIntoView = had;
      else delete proto.scrollIntoView;
    }
  });

  it('a strip without scrollIntoView (jsdom) still renders the current scene', async () => {
    const proto = HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    expect(proto.scrollIntoView).toBeUndefined();
    const p = await seed('Phone Bill Story', 6);
    stubChrome({ [STEP_KEY]: step(p.id, 3, 'Typing the prompt') });
    render(<Panel client={fakeBackground(runningState(p, 2, 1)).client()} />);
    expect(await screen.findByText('Scene 3 of 6 · Typing the prompt')).toBeTruthy();
  });

  it('Pause/Resume and Stop call the run client', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(runningState(p, 2, 1));
    const client = bg.client();
    render(<Panel client={client} />);

    const pause = await screen.findByRole('button', { name: 'Pause' });
    expect(pause.getAttribute('data-variant')).toBe('primary');
    expect(screen.getByRole('button', { name: 'Stop' }).getAttribute('data-variant')).toBe('secondary');
    await act(async () => fireEvent.click(pause));
    expect(client.pause).toHaveBeenCalled();

    const resume = await screen.findByRole('button', { name: 'Resume' });
    expect(resume.getAttribute('data-variant')).toBe('primary');
    await act(async () => fireEvent.click(resume));
    expect(client.resume).toHaveBeenCalled();

    const stop = await screen.findByRole('button', { name: 'Stop' });
    await act(async () => fireEvent.click(stop));
    expect(client.stop).toHaveBeenCalled();
    // Stopped: back to before starting, pictures kept.
    expect(await screen.findByRole('button', { name: 'Start making pictures' })).toBeTruthy();
  });

  it('follows a run started from the studio for another video', async () => {
    stubChrome();
    const other = await seed('Older Story', 6);
    await seed('Phone Bill Story', 2);
    const bg = fakeBackground(null);
    render(<Panel client={bg.client()} />);
    await screen.findByText(/4 pictures · 0 Flow credits/);
    act(() => void bg.announce(runningState(other, 1)));
    expect(await screen.findByText('Older Story')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it('panel and studio show the same run after a pause from the studio', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(runningState(p, 2, 1));
    window.location.hash = `#/project/${p.id}`;
    const studio = render(<App client={bg.client()} media={memoryMediaStore()} />);
    const panel = render(<Panel client={bg.client()} />);

    const studioPause = await within(studio.container).findByRole('button', { name: 'Pause' });
    expect(await within(panel.container).findByRole('button', { name: 'Pause' })).toBeTruthy();

    await act(async () => fireEvent.click(studioPause));
    expect(await within(studio.container).findByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(await within(panel.container).findByRole('button', { name: 'Resume' })).toBeTruthy();
    expect(within(panel.container).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(within(panel.container).getByText(/Paused/)).toBeTruthy();
    // The studio keeps its live-activity switch; the panel leaves it out.
    expect(within(studio.container).getByRole('switch', { name: 'Show live activity in Flow' })).toBeTruthy();
    expect(within(panel.container).queryByRole('switch')).toBeNull();
  });
});

describe('studio after edits in the panel', () => {
  async function editedInPanel(fire: () => void) {
    stubChrome();
    const p = await seed('Phone Bill Story', 0);
    window.location.hash = `#/project/${p.id}`;
    render(<App client={fakeBackground(null).client()} media={memoryMediaStore()} />);
    expect(((await screen.findByRole('radio', { name: '16:9' })) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole('heading', { name: '3 scenes' })).toBeNull();

    // The panel saves its edits straight to the store, as Panel.tsx does.
    await saveEdits(p.id, { scenes: scenes(3), aspect: '9:16', style: 'custom', customStyle: 'Blue ballpoint' });
    await act(async () => fire());

    expect(await screen.findByRole('heading', { name: '3 scenes' })).toBeTruthy();
    expect((screen.getByRole('radio', { name: '9:16' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Your own style/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Your own style' }) as HTMLTextAreaElement).value).toBe('Blue ballpoint');
  }

  it('re-reads the shown video when the studio tab regains focus', async () => {
    await editedInPanel(() => window.dispatchEvent(new Event('focus')));
  });

  it('re-reads the shown video when the studio tab becomes visible again', async () => {
    await editedInPanel(() => document.dispatchEvent(new Event('visibilitychange')));
  });
});
