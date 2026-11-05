import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import type { CheckRow } from '../../src/runs/checks';
import { clearProjects, fakeBackground, runningState, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const primaries = (root: HTMLElement) => root.querySelectorAll('[data-variant="primary"]');
const tab = (name: string | RegExp) => screen.findByRole('tab', { name });
const selected = () => screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

const READY: CheckRow[] = [
  { id: 'account', label: 'Google account', ok: true, detail: 'unscripted4ce@gmail.com' },
  { id: 'page', label: 'Flow page & project', ok: true, detail: 'Flow project open' },
  { id: 'promptBox', label: 'Prompt box', ok: true, detail: 'Found' },
  { id: 'generate', label: 'Generate button', ok: true, detail: 'Found' },
  { id: 'hero', label: 'Hero reference', ok: true, detail: 'Reference picture ready · attached to every scene' },
];

describe('side panel: tabs', () => {
  it('opens on Setup when no run is live and on Queue when one is', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const idle = render(<Panel client={fakeBackground(null).client()} />);
    await screen.findByRole('button', { name: 'Start making pictures' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Setup', 'Queue 6', 'Checks', 'Files']);
    expect(selected()).toBe('Setup');
    idle.unmount();

    render(<Panel client={fakeBackground(runningState(p, 2, 1)).client()} />);
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(selected()).toBe('Queue 6');
    // The other tabs stay one press away while it runs.
    fireEvent.click(await tab('Setup'));
    expect(await screen.findByRole('combobox', { name: 'Video' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('follows a run: Queue when one starts, Setup when it stops', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(null);
    render(<Panel client={bg.client()} />);
    const start = await screen.findByRole('button', { name: 'Start making pictures' });
    await act(async () => fireEvent.click(start));
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(selected()).toBe('Queue 6');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })));
    expect(await screen.findByRole('button', { name: 'Start making pictures' })).toBeTruthy();
    expect(selected()).toBe('Setup');
  });

  it('the health line shows on every tab', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    const client = fakeBackground(null).client();
    client.checks = vi.fn(async () => ({ ok: true as const, flowOpen: true, rows: READY }));
    render(<Panel client={client} />);
    const health = await screen.findByRole('status', { name: 'Health' });
    await waitFor(() => expect(within(health).getAllByRole('listitem').map((i) => i.textContent)).toEqual(['✓ Signed in', '✓ Flow ready', '✓ Hero attached']));
    for (const name of [/^Queue/, 'Checks', 'Files', 'Setup']) {
      fireEvent.click(await tab(name));
      expect(within(screen.getByRole('status', { name: 'Health' })).getByText('✓ Signed in')).toBeTruthy();
    }
  });

  it('the health line says "VidFlow\'s Flow window not open" without VidFlow\'s Flow window', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    const health = await screen.findByRole('status', { name: 'Health' });
    await waitFor(() => expect(health.textContent).toBe("VidFlow's Flow window not open"));
  });

  it('the health line refreshes on open, on Checks, after Check again and when the run changes', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(null);
    const client = bg.client();
    render(<Panel client={client} />);
    await waitFor(() => expect(client.checks).toHaveBeenCalledTimes(1));
    expect(client.checks).toHaveBeenCalledWith(p.id);

    fireEvent.click(await tab('Checks'));
    await waitFor(() => expect(client.checks).toHaveBeenCalledTimes(2));
    const again = await screen.findByRole('button', { name: 'Check again' });
    await act(async () => fireEvent.click(again));
    await waitFor(() => expect(client.checks).toHaveBeenCalledTimes(3));

    act(() => void bg.announce(runningState(p, 1, 1)));
    await waitFor(() => expect(client.checks).toHaveBeenCalledTimes(4));
    // A scene finishing within the same run is not a change of the run's state: no new check.
    act(() => void bg.announce(runningState(p, 2, 1)));
    await new Promise((r) => setTimeout(r, 20));
    expect(client.checks).toHaveBeenCalledTimes(4);
  });

  it('Queue tab label shows the scene count', async () => {
    stubChrome();
    await seed('Phone Bill Story', 24);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(await tab('Queue 24')).toBeTruthy();
  });

  it('exactly one coral primary on each tab', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(runningState(p, 2, 1));
    const { container } = render(<Panel client={bg.client()} />);

    await screen.findByRole('button', { name: 'Pause' });
    expect([...primaries(container)].map((b) => b.textContent)).toEqual(['Pause']);

    // Setup while this video runs is locked: its coral is "Go to Queue", never Start.
    fireEvent.click(await tab('Setup'));
    await screen.findByRole('button', { name: 'Go to Queue' });
    expect([...primaries(container)].map((b) => b.textContent)).toEqual(['Go to Queue']);
    expect(screen.queryByRole('button', { name: 'Start making pictures' })).toBeNull();

    fireEvent.click(await tab('Checks'));
    await screen.findByRole('button', { name: 'Check again' });
    expect([...primaries(container)].map((b) => b.textContent)).toEqual(['Check again']);

    // Files: its one coral is Download all (the two saved scenes' chosen pictures).
    fireEvent.click(await tab('Files'));
    await screen.findByRole('button', { name: 'Download all 2 pictures' });
    expect([...primaries(container)].map((b) => b.textContent)).toEqual(['Download all 2 pictures']);
  });

  it('only the selected tab names the panel it controls', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    await tab('Queue 6');
    const controls = screen.getAllByRole('tab').map((t) => t.getAttribute('aria-controls'));
    expect(controls.filter(Boolean)).toHaveLength(1);
    const setup = screen.getByRole('tab', { name: 'Setup' });
    expect(document.getElementById(setup.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('tabpanel');
  });

  it('tabs work from the keyboard', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    await tab('Queue 6');
    const setup = await tab('Setup');
    fireEvent.keyDown(setup, { key: 'ArrowRight' });
    expect(selected()).toBe('Queue 6');
    expect(document.activeElement?.textContent).toBe('Queue 6');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(selected()).toBe('Files');
    expect(screen.getByRole('tabpanel', { name: 'Files' })).toBeTruthy();
  });
});
