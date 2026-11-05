import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pdfText = vi.fn(async (_data: Uint8Array) => '');
vi.mock('../../src/scenes/pdfText', () => ({ pdfText: (data: Uint8Array) => pdfText(data) }));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { buildClaudePrompt, buildRapidBeatPrompt } from '../../src/prompts/claude';
import { getProject, listProjects, saveProject } from '../../src/store/projects';
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

  it('a paused run with nothing left to make is not live: the panel opens on the newest video', async () => {
    stubChrome();
    const finished = await seed('Paused Story', 2);
    await seed('Newest Story', 2);
    // Paused after every scene got its pictures: nothing still to make, so no run blocks and none is followed.
    render(<Panel client={fakeBackground({ ...runningState(finished, 2), status: 'paused' }).client()} />);
    await waitFor(async () => expect((await video()).selectedOptions[0]?.textContent).toBe('Newest Story'));
  });

  it('paste shows "✓ 6 scenes found" and applies only on Use these scenes', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 0);
    const bg = fakeBackground(null);
    const client = bg.client();
    const { container } = render(<Panel client={client} />);
    fireEvent.change(await screen.findByRole('textbox', { name: "Paste Claude's reply" }), { target: { value: REPLY_6 } });

    expect(screen.getByText('✓ 6 scenes found · no problems')).toBeTruthy();
    // As in the approved panel: "Use these scenes" is a link beside the count; the coral Start waits for it.
    const use = screen.getByRole('button', { name: 'Use these scenes' });
    expect(use.getAttribute('data-variant')).toBeNull();
    expect(primaries(container)).toHaveLength(1);
    expect((screen.getByRole('button', { name: 'Start making pictures' }) as HTMLButtonElement).disabled).toBe(true);
    // Pasting only previews: nothing is saved yet.
    await new Promise((r) => setTimeout(r, 20));
    expect((await getProject(p.id))!.scenes).toHaveLength(0);

    fireEvent.click(use);
    await waitFor(async () => expect((await getProject(p.id))!.scenes).toHaveLength(6));
    expect(client.forget).toHaveBeenCalledWith(p.id);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start making pictures' }) as HTMLButtonElement).disabled).toBe(false));
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

  it('shows whether the hero has a reference picture, and keeps it while the description changes', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6);
    p.character = { description: 'a cap', referenceMediaId: `${p.id}/hero-reference` };
    await saveProject(p);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(await screen.findByText('Reference picture ✓ · attached to every scene')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Hero' }), { target: { value: 'a red cap' } });
    await waitFor(async () =>
      expect((await getProject(p.id))!.character).toEqual({ description: 'a red cap', referenceMediaId: `${p.id}/hero-reference` }),
    );
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
      expect(saved.character).toEqual({ description: 'a short stickman with a red cap' });
    });
    expect((screen.getByRole('radio', { name: '9:16' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/24 pictures · 0 Flow credits/)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), { target: { value: 'custom' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your own style' }), { target: { value: 'Blue ballpoint' } });
    await waitFor(async () => expect((await getProject(p.id))!.customStyle).toBe('Blue ballpoint'));
  });

  it('summary reads "48 pictures · 0 Flow credits · ~8 min"', async () => {
    stubChrome();
    await seed('Phone Bill Story', 24);
    render(<Panel client={fakeBackground(null).client()} />);
    // 24 scenes × 2 pictures; about 20 s per scene.
    expect(await screen.findByText('48 pictures · 0 Flow credits · ~8 min')).toBeTruthy();
  });

  it('a short video still reads at least "~1 min"', async () => {
    stubChrome();
    await seed('Phone Bill Story', 1);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(await screen.findByText('2 pictures · 0 Flow credits · ~1 min')).toBeTruthy();
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

    // Done: every scene has pictures (the finished run's states are saved in the project).
    const done = runningState(p, 6);
    await saveProject({ ...(await getProject(p.id))!, sceneStates: done.sceneStates });
    act(() => void bg.announce(done));
    await screen.findByRole('button', { name: 'Review in the full studio' });
    expect(primaries(container)).toHaveLength(1);
    expect(screen.getByText('All 6 scenes have pictures.')).toBeTruthy();
  });

  it('a request that fails outright shows a plain message', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    const client = fakeBackground(null).client();
    client.start = vi.fn(async () => {
      throw new Error('Extension context invalidated.');
    });
    render(<Panel client={client} />);
    const start = await screen.findByRole('button', { name: 'Start making pictures' });
    await act(async () => fireEvent.click(start));
    expect(await screen.findByText('Something went wrong — try again.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start making pictures' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("with a run live and the panel in VidFlow's Flow window, Open full studio ↗ never shows a tab there", async () => {
    const FLOW_WINDOW = 3;
    const chrome = stubChrome({ 'vidflow.flowWindow': { windowId: FLOW_WINDOW, tabId: 7 } });
    chrome.windows.getAll.mockResolvedValue([
      { id: FLOW_WINDOW, type: 'normal', focused: true },
      { id: 9, type: 'normal', focused: false },
    ]);
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(runningState(p, 1));
    render(<Panel client={bg.client()} />);
    await screen.findByRole('button', { name: 'Pause' });

    // No studio tab yet: it opens in the other window, not the current one (VidFlow's).
    fireEvent.click(screen.getByRole('button', { name: 'Open full studio ↗' }));
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/${p.id}`, windowId: 9, active: true }));

    // A studio tab left inside VidFlow's window is moved out before it is shown.
    chrome.tabs.query.mockResolvedValue([{ id: 5, windowId: FLOW_WINDOW, url: STUDIO }]);
    fireEvent.click(screen.getByRole('button', { name: 'Open full studio ↗' }));
    await waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true, url: `${STUDIO}#/project/${p.id}` }));
    expect(chrome.tabs.move).toHaveBeenCalledWith(5, { windowId: 9, index: -1 });
    expect(chrome.tabs.move.mock.invocationCallOrder[0]!).toBeLessThan(chrome.tabs.update.mock.invocationCallOrder[0]!);
    expect(chrome.windows.update).not.toHaveBeenCalledWith(FLOW_WINDOW, expect.anything());
    expect(chrome.tabs.update).not.toHaveBeenCalledWith(7, expect.anything());
  });

  it("Review in the full studio never shows a tab in VidFlow's Flow window", async () => {
    const FLOW_WINDOW = 3;
    const chrome = stubChrome({ 'vidflow.flowWindow': { windowId: FLOW_WINDOW, tabId: 7 } });
    // VidFlow's window is the only one: the studio gets a window of its own.
    chrome.windows.getAll.mockResolvedValue([{ id: FLOW_WINDOW, type: 'normal', focused: true }]);
    const p = await seed('Phone Bill Story', 6, (x) => {
      x.sceneStates = runningState(x, 6).sceneStates;
    });
    render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review in the full studio' }));
    await waitFor(() => expect(chrome.windows.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/${p.id}`, focused: true }));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.windows.update).not.toHaveBeenCalledWith(FLOW_WINDOW, expect.anything());
  });

  it('Open full studio ↗ opens or focuses the studio tab on this project', async () => {
    const chrome = stubChrome();
    const p = await seed('Phone Bill Story', 6);
    const bg = fakeBackground(null);
    render(<Panel client={bg.client()} />);

    // Before starting: no studio tab yet, so one opens on this video.
    await screen.findByRole('button', { name: 'Start making pictures' });
    fireEvent.click(screen.getByRole('button', { name: 'Open full studio ↗' }));
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/${p.id}` }));

    // While it runs: the open studio tab is brought forward and moved to this video.
    act(() => void bg.announce(runningState(p, 1)));
    await screen.findByRole('button', { name: 'Pause' });
    chrome.tabs.query.mockResolvedValue([{ id: 5, windowId: 2, url: STUDIO }]);
    fireEvent.click(screen.getByRole('button', { name: 'Open full studio ↗' }));
    await waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledWith(5, { active: true, url: `${STUDIO}#/project/${p.id}` }));
    expect(chrome.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });
});

describe('side panel: Setup tab', () => {
  function stubClipboard() {
    const writeText = vi.fn(async (_t: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    return writeText;
  }

  it("copies the Claude prompt and the rapid-beat prompt with the video's script", async () => {
    stubChrome();
    const writeText = stubClipboard();
    await seed('Phone Bill Story', 0, (x) => (x.script = 'My phone bill went up every month.'));
    render(<Panel client={fakeBackground(null).client()} />);

    const copyClaude = await screen.findByRole('button', { name: 'Copy Claude prompt' });
    await act(async () => fireEvent.click(copyClaude));
    expect(writeText).toHaveBeenLastCalledWith(buildClaudePrompt('My phone bill went up every month.'));
    expect(await screen.findByText('Copied')).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy rapid-beat prompt' })));
    expect(writeText).toHaveBeenLastCalledWith(buildRapidBeatPrompt('My phone bill went up every month.'));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('says so when the clipboard refuses', async () => {
    stubChrome();
    const writeText = stubClipboard();
    writeText.mockRejectedValueOnce(new Error('denied'));
    await seed('Phone Bill Story', 0, (x) => (x.script = 'A script.'));
    render(<Panel client={fakeBackground(null).client()} />);
    const copyClaude = await screen.findByRole('button', { name: 'Copy Claude prompt' });
    await act(async () => fireEvent.click(copyClaude));
    expect(await screen.findByText("VidFlow couldn't copy the prompt. Try again.")).toBeTruthy();
  });

  it('asks to add the script in the full studio when there is none', async () => {
    const chrome = stubChrome();
    const writeText = stubClipboard();
    const p = await seed('Phone Bill Story', 0);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(await screen.findByText('Add your script in the full studio first')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy Claude prompt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy rapid-beat prompt' })).toBeNull();
    expect(writeText).not.toHaveBeenCalled();
    // No script box in the panel: the link opens the full studio on this video.
    fireEvent.click(screen.getByRole('button', { name: 'Open full studio' }));
    await waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/${p.id}` }));
  });

  it('an uploaded CSV fills the paste box and still needs Use these scenes', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 0);
    render(<Panel client={fakeBackground(null).client()} />);
    const file = await screen.findByLabelText('Upload a scene file');
    expect((file as HTMLInputElement).accept).toBe('.csv,.tsv,.txt,.pdf,text/csv,text/tab-separated-values,text/plain,application/pdf');
    await act(async () => {
      fireEvent.change(file, { target: { files: [new File([REPLY_6], 'scenes.csv', { type: 'text/csv' })] } });
    });
    const paste = screen.getByRole('textbox', { name: "Paste Claude's reply" }) as HTMLTextAreaElement;
    await waitFor(() => expect(paste.value).toBe(REPLY_6));
    expect(screen.getByText('✓ 6 scenes found · no problems')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect((await getProject(p.id))!.scenes).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Use these scenes' }));
    await waitFor(async () => expect((await getProject(p.id))!.scenes).toHaveLength(6));
  });

  it('a scanned PDF shows the plain message', async () => {
    stubChrome();
    pdfText.mockResolvedValueOnce('');
    await seed('Phone Bill Story', 0);
    render(<Panel client={fakeBackground(null).client()} />);
    const file = await screen.findByLabelText('Upload a scene file');
    await act(async () => {
      fireEvent.change(file, { target: { files: [new File([new Uint8Array([1, 2])], 'scan.pdf', { type: 'application/pdf' })] } });
    });
    expect(await screen.findByText('This PDF has no text VidFlow can read. Paste the scenes instead.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: "Paste Claude's reply" }) as HTMLTextAreaElement).value).toBe('');
  });

  it('hero shows "Reference picture ✓ · attached to every scene" or "No reference picture" with Upload', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6, (x) => (x.character = { description: 'a short stickman with a red cap' }));
    const view = render(<Panel client={fakeBackground(null).client()} />);
    expect(await screen.findByText('No reference picture')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeTruthy();
    expect(screen.queryByText(/Add one in the full studio/)).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Hero' }) as HTMLInputElement).value).toBe('a short stickman with a red cap');

    // Upload a picture: it becomes the hero reference (as in the studio's hero section).
    URL.createObjectURL = () => 'blob:hero';
    URL.revokeObjectURL = () => undefined;
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Hero reference picture file'), {
        target: { files: [new File([new Uint8Array([1, 2, 3])], 'hero.png', { type: 'image/png' })] },
      });
    });
    expect(await screen.findByText('Reference picture ✓ · attached to every scene')).toBeTruthy();
    await waitFor(async () =>
      expect((await getProject(p.id))!.character).toEqual({
        description: 'a short stickman with a red cap',
        referenceMediaId: `${p.id}/hero-reference`,
      }),
    );
    expect(await screen.findByRole('img', { name: 'Hero reference picture' })).toBeTruthy();

    // Remove takes it off again.
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove picture' })));
    expect(await screen.findByText('No reference picture')).toBeTruthy();
    await waitFor(async () => expect((await getProject(p.id))!.character).toEqual({ description: 'a short stickman with a red cap' }));
    view.unmount();
  });

  it('Make model sheet starts the model-sheet run', async () => {
    stubChrome();
    const p = await seed('Phone Bill Story', 6, (x) => (x.character = { description: 'a tall stickman' }));
    const client = fakeBackground(null).client();
    render(<Panel client={client} />);
    const make = await screen.findByRole('button', { name: 'Make model sheet' });
    expect(make.getAttribute('data-variant')).toBe('secondary');
    await act(async () => fireEvent.click(make));
    expect(client.heroSheet).toHaveBeenCalledWith(p.id);
  });

  it('Make model sheet waits for a hero description', async () => {
    stubChrome();
    await seed('Phone Bill Story', 6);
    render(<Panel client={fakeBackground(null).client()} />);
    expect(((await screen.findByRole('button', { name: 'Make model sheet' })) as HTMLButtonElement).disabled).toBe(true);
  });
});
