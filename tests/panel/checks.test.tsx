import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import type { CheckRow } from '../../src/runs/checks';
import { ACCEPT_NOTICES_KEY, KEEP_AWAKE_KEY } from '../../src/settings';
import { clearProjects, fakeBackground, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ROWS: CheckRow[] = [
  { id: 'account', label: 'Google account', ok: true, detail: 'unscripted4ce@gmail.com' },
  { id: 'page', label: 'Flow page & project', ok: true, detail: 'Flow project open' },
  { id: 'promptBox', label: 'Prompt box', ok: true, detail: 'Found' },
  { id: 'generate', label: 'Generate button', ok: false, detail: 'Not found', fix: 'Reload the Flow window.' },
  { id: 'agentOff', label: 'Agent mode off', ok: true, detail: 'Off' },
  { id: 'settings', label: 'Flow settings', ok: true, detail: 'Nano Banana 2.1 · 16:9 · x2' },
  { id: 'hero', label: 'Hero reference', ok: true, detail: 'Reference picture ready · attached to every scene' },
  { id: 'credits', label: 'Credits', ok: true, detail: '1,043 credits (resets 13 Nov) · 0 needed for pictures' },
];

async function openChecks(rows: CheckRow[] = ROWS, flowOpen = true) {
  const chrome = stubChrome();
  const p = await seed('Phone Bill Story', 6);
  const client = fakeBackground(null).client();
  client.checks = vi.fn(async () => ({ ok: true as const, flowOpen, rows }));
  const view = render(<Panel client={client} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));
  const list = await screen.findByRole('list', { name: 'Checks' });
  return { chrome, p, client, view, list };
}

describe('side panel: Checks tab', () => {
  it('shows each check with a ✓ badge, or the plain problem and what to do', async () => {
    const { list } = await openChecks();
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(8));
    const items = within(list).getAllByRole('listitem');
    expect(items[0]!.textContent).toBe('Google account · unscripted4ce✓ Signed in');
    expect(items[1]!.textContent).toBe('Flow page & project✓ Ready');
    expect(items[2]!.textContent).toBe('Prompt box✓ Found');
    expect(items[3]!.textContent).toBe('Generate buttonNot foundReload the Flow window.Not ready');
    expect(items[4]!.textContent).toBe('Agent mode✓ Off');
    expect(items[5]!.textContent).toBe('Flow settings · Nano Banana 2.1 · 16:9 · x2✓ Match');
    expect(items[6]!.textContent).toBe('Hero reference✓ Ready');
    expect(items[7]!.textContent).toBe('Credits · 1,043 (resets 13 Nov)✓ 0 needed');
    const hhmm = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    expect(screen.getByText(`Before starting — checked ${hhmm}`)).toBeTruthy();
  });

  it('without the Flow window: "Not checked yet" and Open Flow', async () => {
    const rows: CheckRow[] = [
      { id: 'account', label: 'Google account', ok: null, detail: 'Not checked yet' },
      { id: 'page', label: 'Flow page & project', ok: null, detail: 'Not checked yet' },
    ];
    const { client, list } = await openChecks(rows, false);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
    expect(within(list).getAllByText('Not checked yet')).toHaveLength(2);
    const open = screen.getByRole('button', { name: 'Open Flow' });
    expect(open.getAttribute('data-variant')).toBe('secondary');
    const before = vi.mocked(client.checks).mock.calls.length;
    await act(async () => fireEvent.click(open));
    expect(client.openFlow).toHaveBeenCalled();
    await waitFor(() => expect(vi.mocked(client.checks).mock.calls.length).toBe(before + 1));
  });

  it('the two switches are on by default and save to the settings', async () => {
    const { chrome } = await openChecks();
    const notices = await screen.findByRole('switch', { name: "Accept Flow's notices automatically" });
    const awake = screen.getByRole('switch', { name: 'Keep Mac awake while running' });
    await waitFor(() => expect(notices.getAttribute('aria-checked')).toBe('true'));
    expect(awake.getAttribute('aria-checked')).toBe('true');

    await act(async () => fireEvent.click(notices));
    expect(chrome.data[ACCEPT_NOTICES_KEY]).toBe(false);
    expect(notices.getAttribute('aria-checked')).toBe('false');
    await act(async () => fireEvent.click(awake));
    expect(chrome.data[KEEP_AWAKE_KEY]).toBe(false);
    await act(async () => fireEvent.click(awake));
    expect(chrome.data[KEEP_AWAKE_KEY]).toBe(true);
  });

  it('the switches wait for the stored value, and a change from elsewhere wins over a late read', async () => {
    const chrome = stubChrome();
    await seed('Phone Bill Story', 6);
    const local = (globalThis as unknown as { chrome: { storage: { local: { get: Mock; set(i: object): Promise<void> } } } }).chrome.storage.local;
    let release!: () => void;
    const late = new Promise<void>((r) => (release = r));
    let lateReadDone = false;
    const read = local.get.getMockImplementation()!;
    local.get.mockImplementation(async (key: string) => {
      if (key !== ACCEPT_NOTICES_KEY) return read(key);
      await late;
      const got = await read(key);
      lateReadDone = true;
      return got;
    });
    render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));
    const notices = await screen.findByRole('switch', { name: "Accept Flow's notices automatically" });
    // Not loaded yet: no state shown and it can't be flipped.
    expect((notices as HTMLButtonElement).disabled).toBe(true);
    expect(notices.getAttribute('aria-checked')).toBe('false');
    // The switches' effects (their reads and storage listeners) run after the DOM shows them; under load that can be
    // later than findByRole. Keep-awake's read isn't held back, so once it shows, both switches are listening.
    const awake = screen.getByRole('switch', { name: 'Keep Mac awake while running' });
    await waitFor(() => expect((awake as HTMLButtonElement).disabled).toBe(false));
    expect(awake.getAttribute('aria-checked')).toBe('true');
    expect((notices as HTMLButtonElement).disabled).toBe(true);
    // Turned off elsewhere (the studio) before the read arrives …
    await act(async () => {
      chrome.data[ACCEPT_NOTICES_KEY] = false;
      await local.set({ [ACCEPT_NOTICES_KEY]: false });
    });
    expect(notices.getAttribute('aria-checked')).toBe('false');
    expect((notices as HTMLButtonElement).disabled).toBe(false);
    // … then the old read (on) arrives late: it must not win.
    chrome.data[ACCEPT_NOTICES_KEY] = true;
    await act(async () => release());
    await waitFor(() => expect(lateReadDone).toBe(true));
    await act(async () => undefined); // let the late read's result land
    expect(notices.getAttribute('aria-checked')).toBe('false');

    // The other switch follows changes made elsewhere too.
    await act(async () => local.set({ [KEEP_AWAKE_KEY]: false }));
    expect(awake.getAttribute('aria-checked')).toBe('false');
  });

  it('reads switches that were turned off before', async () => {
    stubChrome({ [ACCEPT_NOTICES_KEY]: false });
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));
    const notices = await screen.findByRole('switch', { name: "Accept Flow's notices automatically" });
    await waitFor(() => expect(notices.getAttribute('aria-checked')).toBe('false'));
  });

  it('Show me in Flow says what it could not find', async () => {
    const { client } = await openChecks();
    client.showMe = vi.fn(async () => ({ ok: true as const, missing: ['ingredients button'] }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show me in Flow' })));
    expect(client.showMe).toHaveBeenCalled();
    expect(await screen.findByText("Look at Flow: VidFlow couldn't find the ingredients button.")).toBeTruthy();

    client.showMe = vi.fn(async () => ({ ok: true as const, missing: [] }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show me in Flow' })));
    expect(await screen.findByText('Look at Flow: the prompt box, Generate and the ingredients button are ringed.')).toBeTruthy();

    client.showMe = vi.fn(async () => ({ ok: false as const, message: 'Flow window closed.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show me in Flow' })));
    expect(await screen.findByText('Flow window closed.')).toBeTruthy();
  });

  it('Test one prompt uses this video and shows the answer', async () => {
    const { client, p } = await openChecks();
    client.testPrompt = vi.fn(async () => ({ ok: true, message: 'Flow is ready: settings set, prompt typed and cleared.' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Test one prompt' })));
    expect(client.testPrompt).toHaveBeenCalledWith(p.id);
    expect(await screen.findByText('Flow is ready: settings set, prompt typed and cleared.')).toBeTruthy();
  });

  it('Check again is the coral primary and checks again', async () => {
    const { client } = await openChecks();
    const again = screen.getByRole('button', { name: 'Check again' });
    expect(again.getAttribute('data-variant')).toBe('primary');
    const before = vi.mocked(client.checks).mock.calls.length;
    await act(async () => fireEvent.click(again));
    await waitFor(() => expect(vi.mocked(client.checks).mock.calls.length).toBe(before + 1));
  });

  it('a check that fails outright shows its message', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    const client = fakeBackground(null).client();
    client.checks = vi.fn(async () => ({ ok: false as const, message: "VidFlow's background didn't answer." }));
    render(<Panel client={client} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Checks' }));
    expect(await screen.findByText("VidFlow's background didn't answer.")).toBeTruthy();
  });
});
