import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { getProject, listProjects } from '../../src/store/projects';
import { clearProjects, fakeBackground, REPLY_6, runningState, seed, STUDIO, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const primaries = (root: HTMLElement) => root.querySelectorAll('[data-variant="primary"]');
const video = () => screen.findByRole('combobox', { name: 'Video' }) as Promise<HTMLSelectElement>;

describe('side panel: before starting', () => {
  it('pick or create a video', async () => {
    stubChrome();
    const older = await seed('Older Story', 6);
    const newest = await seed('Phone Bill Story', 3);
    render(<Panel client={fakeBackground(null).client()} />);

    // The most recently opened video first.
    expect((await video()).value).toBe(newest.id);
    expect(await screen.findByText(/6 pictures · 0 Flow credits/)).toBeTruthy();

    fireEvent.change(await video(), { target: { value: older.id } });
    expect(await screen.findByText(/12 pictures · 0 Flow credits/)).toBeTruthy();

    fireEvent.change(await video(), { target: { value: 'new' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new video' }), { target: { value: 'Rent Story' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Make video' }));
    });
    const made = (await listProjects()).find((p) => p.name === 'Rent Story');
    expect(made).toBeTruthy();
    await waitFor(async () => expect((await video()).value).toBe(made!.id));
    expect(within(await video()).getByRole('option', { name: 'Rent Story' })).toBeTruthy();
  });

  it("opens on the live run's video rather than the newest", async () => {
    stubChrome();
    const running = await seed('Running Story', 6);
    await seed('Newest Story', 2);
    render(<Panel client={fakeBackground({ ...runningState(running, 1), status: 'paused' }).client()} />);
    expect(await screen.findByText('Running Story')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('paste shows "✓ 6 scenes found" and applies only on Use these scenes', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 0);
    const bg = fakeBackground(null);
    const client = bg.client();
    const { container } = render(<Panel client={client} />);
    fireEvent.change(await screen.findByRole('textbox', { name: "Paste Claude's reply" }), { target: { value: REPLY_6 } });

    expect(screen.getByText('✓ 6 scenes found · no problems')).toBeTruthy();
    const use = screen.getByRole('button', { name: 'Use these scenes' });
    expect(primaries(container)).toHaveLength(1);
    expect(use.getAttribute('data-variant')).toBe('primary');
    // Pasting only previews: nothing is saved yet.
    await new Promise((r) => setTimeout(r, 20));
    expect((await getProject(p.id))!.scenes).toHaveLength(0);

    fireEvent.click(use);
    await waitFor(async () => expect((await getProject(p.id))!.scenes).toHaveLength(6));
    expect(client.forget).toHaveBeenCalledWith(p.id);
    expect(screen.getByRole('button', { name: 'Start making pictures' })).toBeTruthy();
  });

  it('a new paste asks before replacing scenes that have pictures', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 3, (x) => {
      x.sceneStates = { 'scene-01': { sceneId: 'scene-01', status: 'done', pictureIds: ['a'] } };
    });
    const { container } = render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.change(await screen.findByRole('textbox', { name: "Paste Claude's reply" }), { target: { value: REPLY_6 } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    expect(screen.getByText('This replaces 3 scenes and their pictures. Continue?')).toBeTruthy();
    expect(primaries(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the old scenes' }));
    expect((await getProject(p.id))!.scenes).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, replace them' }));
    await waitFor(async () => expect((await getProject(p.id))!.scenes).toHaveLength(6));
  });

  it('aspect, per-scene, style and hero choices save to the project', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);

    const sixteen = (await screen.findByRole('radio', { name: '16:9' })) as HTMLInputElement;
    expect(sixteen.checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Pictures per scene' }), { target: { value: '4' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'stickman-colour' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Hero' }), { target: { value: 'a short stickman with a red cap' } });

    await waitFor(async () => {
      const saved = (await getProject(p.id))!;
      expect(saved.aspect).toBe('9:16');
      expect(saved.outputsPerPrompt).toBe(4);
      expect(saved.style).toBe('stickman-colour');
      expect(saved.character).toEqual({ description: 'a short stickman with a red cap', hasReferenceImage: false });
    });
    expect((screen.getByRole('radio', { name: '9:16' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/24 pictures · 0 Flow credits/)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'custom' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own style' }), { target: { value: 'Blue ballpoint' } });
    await waitFor(async () => expect((await getProject(p.id))!.customStyle).toBe('Blue ballpoint'));
  });

  it('summary reads "12 pictures · 0 Flow credits"', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(await screen.findByText('12 pictures · 0 Flow credits · Chrome shows a “debugging” bar while it runs')).toBeTruthy();
  });

  it('Start uses the run client, then shows the run', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const client = fakeBackground(null).client();
    render(<Panel client={client} />);
    const start = await screen.findByRole('button', { name: 'Start making pictures' });
    await act(async () => fireEvent.click(start));
    expect(client.start).toHaveBeenCalledWith(p.id);
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeTruthy();
  });

  it("shows the background's reason when Start is refused", async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    const client = fakeBackground(null).client();
    const message = 'Another project is making pictures right now. Pause it or wait for it to finish, then try again.';
    client.start = vi.fn(async () => ({ ok: false as const, reason: 'busy' as const, message }));
    render(<Panel client={client} />);
    const start = await screen.findByRole('button', { name: 'Start making pictures' });
    await act(async () => fireEvent.click(start));
    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('exactly one coral primary', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(null);
    const { container } = render(<Panel client={bg.client()} />);
    await screen.findByRole('button', { name: 'Start making pictures' });
    expect(primaries(container)).toHaveLength(1); // before starting

    act(() => void bg.announce(runningState(p, 2, 1)));
    await screen.findByRole('button', { name: 'Pause' });
    expect(primaries(container)).toHaveLength(1); // running
    expect(primaries(container)[0]!.textContent).toBe('Pause');

    act(() => void bg.announce({ ...runningState(p, 2, 1), status: 'paused' }));
    await screen.findByRole('button', { name: 'Resume' });
    expect(primaries(container)).toHaveLength(1); // paused
    expect(primaries(container)[0]!.textContent).toBe('Resume');
  });

  it('Open full studio ↗ opens or focuses the studio tab on this project', async () => {
    const chrome = stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(null);
    render(<Panel client={bg.client()} />);

    // Before starting: no studio tab yet, so one opens on this video.
    await screen.findByRole('button', { name: 'Start making pictures' });
    fireEvent.click(screen.getByRole('button', { name: /Open full studio/ }));
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/${p.id}` }));

    // While it runs: the open studio tab is brought forward and moved to this video.
    act(() => void bg.announce(runningState(p, 1)));
    await screen.findByRole('button', { name: 'Pause' });
    chrome.tabs.query.mockResolvedValue([{ id: 5, windowId: 2, url: STUDIO }]);
    fireEvent.click(screen.getByRole('button', { name: /Open full studio/ }));
    await waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true, url: `${STUDIO}#/project/${p.id}` }));
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
});
