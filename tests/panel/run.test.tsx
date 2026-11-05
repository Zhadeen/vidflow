import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { ACTIVITY_KEY, STEP_KEY, type ActivityEntry, type Step } from '../../src/runs/activity';
import { memoryMediaStore } from '../../src/store/media';
import { App } from '../../src/studio/App';
import { readFileSync } from 'node:fs';
import { clearProjects, fakeBackground, runningState, sceneId, seed, stubChrome } from './helpers';

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

    // The newest five activity lines, with the switch for the Flow page.
    const activity = screen.getByRole('region', { name: 'Activity' });
    await waitFor(() => expect(within(activity).getAllByRole('listitem')).toHaveLength(5));
    expect(within(activity).getByText('Line 6')).toBeTruthy();
    expect(within(activity).getByRole('switch', { name: 'Show live activity in Flow' })).toBeTruthy();
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
  });
});
