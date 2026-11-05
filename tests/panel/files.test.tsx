import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Panel } from '../../src/panel/Panel';
import { AUTO_SAVE_KEY, NAMING_FORMAT_KEY } from '../../src/settings';
import { getMediaStore, getProject, type Project } from '../../src/store/projects';
import { clearProjects, fakeBackground, sceneId, seed, stubChrome } from './helpers';

beforeEach(async () => {
  await clearProjects();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const primaries = () => [...document.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent);

/** "Phone Bill Story": `n` scenes of 3 s, each saved with two pictures in VidFlow. */
async function openFiles(n = 24, data: Record<string, unknown> = {}) {
  const chrome = stubChrome(data);
  const p = await seed('Phone Bill Story', n, (v: Project) => {
    v.scenes.forEach((s, k) => Object.assign(s, { start: k * 3, end: k * 3 + 3 }));
    for (let i = 1; i <= n; i++) {
      v.sceneStates[sceneId(i)] = {
        sceneId: sceneId(i),
        status: 'done',
        pictureIds: [`${v.id}/${sceneId(i)}-option-1`, `${v.id}/${sceneId(i)}-option-2`],
      };
    }
  });
  for (let i = 1; i <= n; i++) {
    for (const k of [1, 2]) await getMediaStore().put(p.id, `${sceneId(i)}-option-${k}`, new Blob([`${i}${k}`], { type: 'image/png' }));
  }
  render(<Panel client={fakeBackground(null).client()} />);
  fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));
  await screen.findByText(`${n} scenes · ${n * 2} pictures saved in VidFlow`);
  // The stored choices are read (Download all waits for "Chosen picture only / Both options").
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Both options' }).closest('fieldset')!.disabled).toBe(false));
  return { chrome, p };
}

describe('side panel: Files tab', () => {
  it('shows count, grid, folder, naming, the switch, exports, "Coming next: Clips · Voice · Finished video" and coral "Download all 24 pictures"', async () => {
    await openFiles();
    expect(screen.getByText('24 scenes · 48 pictures saved in VidFlow')).toBeTruthy();
    const grid = screen.getByRole('list', { name: 'Chosen pictures' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(8);
    expect(grid.textContent).toContain('+16');

    expect(screen.getByText('Download to your Mac')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Download folder' }) as HTMLInputElement).value).toBe('Phone Bill Story');
    expect(screen.getByText('Folder: Downloads /')).toBeTruthy();
    const names = screen.getByRole('combobox', { name: 'Names' }) as HTMLSelectElement;
    await waitFor(() => expect(names.value).toBe('slide-time'));
    expect(screen.getByText('Names: Slide_01_00m00s-00m03s.png ▾')).toBeTruthy();
    expect([...names.options].map((o) => o.textContent)).toEqual([
      'Slide_01_00m00s-00m03s.png',
      'Slide_01_00-00_to_00-03.png',
      'Slide_01_00s-03s.png',
      '00m00s-00m03s_Slide_01.png',
      'Slide_01.png',
    ]);
    await waitFor(() => expect((screen.getByRole('radio', { name: 'Chosen picture only' }) as HTMLInputElement).checked).toBe(true));
    expect((screen.getByRole('radio', { name: 'Both options' }) as HTMLInputElement).checked).toBe(false);

    const autoSave = screen.getByRole('switch', { name: 'Save automatically as each scene finishes' });
    await waitFor(() => expect(autoSave.getAttribute('aria-checked')).toBe('false'));
    expect(screen.getByRole('button', { name: 'Slide list (CSV)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Timing file' })).toBeTruthy();
    expect(screen.getByText('Coming next')).toBeTruthy();
    expect(screen.getByText('Clips · Voice · Finished video (MP4)')).toBeTruthy();
    expect(primaries()).toEqual(['Download all 24 pictures']);
  });

  it('Download all saves each chosen picture once; pressing it again asks "Download them again?"', async () => {
    const { chrome } = await openFiles(3);
    fireEvent.click(screen.getByRole('button', { name: 'Download all 3 pictures' }));
    expect(await screen.findByText('Saved 3 pictures to Downloads/Phone Bill Story.')).toBeTruthy();
    expect(chrome.downloads.download.mock.calls.map(([o]) => o.filename)).toEqual([
      'Phone Bill Story/Slide_01_00m00s-00m03s.png',
      'Phone Bill Story/Slide_02_00m03s-00m06s.png',
      'Phone Bill Story/Slide_03_00m06s-00m09s.png',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Download all 3 pictures' }));
    expect(await screen.findByText('All 3 are already in Downloads/Phone Bill Story. Download them again?')).toBeTruthy();
    expect(chrome.downloads.download).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Download again' }));
    await waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(6));
    expect(await screen.findByText('Saved 3 pictures to Downloads/Phone Bill Story.')).toBeTruthy();
  });

  it('shows progress while it saves: "Saving 2 of 3…"', async () => {
    const { chrome } = await openFiles(3);
    chrome.fakeDownloads.hold();
    fireEvent.click(screen.getByRole('button', { name: 'Download all 3 pictures' }));
    expect(await screen.findByText('Saving 3 of 3…')).toBeTruthy();
    await waitFor(() => expect(chrome.fakeDownloads.listeners.size).toBe(3));
    for (const id of [1, 2, 3]) chrome.fakeDownloads.finish(id);
    expect(await screen.findByText('Saved 3 pictures to Downloads/Phone Bill Story.')).toBeTruthy();
    expect(screen.queryByText(/^Saving \d+ of/)).toBeNull();
  });

  it('Both options doubles the count and is remembered for every video', async () => {
    const { chrome } = await openFiles(3);
    fireEvent.click(screen.getByRole('radio', { name: 'Both options' }));
    expect(await screen.findByRole('button', { name: 'Download all 6 pictures' })).toBeTruthy();
    await waitFor(() => expect(chrome.data['vidflow.downloadBoth']).toBe(true));
  });

  it('the switch, the naming format and the folder are saved', async () => {
    const { chrome, p } = await openFiles(3);
    const autoSave = screen.getByRole('switch', { name: 'Save automatically as each scene finishes' });
    await waitFor(() => expect(autoSave.getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(autoSave);
    await waitFor(() => expect(chrome.data[AUTO_SAVE_KEY]).toBe(true));
    expect(autoSave.getAttribute('aria-checked')).toBe('true');

    fireEvent.change(screen.getByRole('combobox', { name: 'Names' }), { target: { value: 'slide' } });
    await waitFor(() => expect(chrome.data[NAMING_FORMAT_KEY]).toBe('slide'));
    expect(screen.getByText('Names: Slide_01.png ▾')).toBeTruthy();

    const folder = screen.getByRole('textbox', { name: 'Download folder' });
    fireEvent.change(folder, { target: { value: 'Bills / part 1' } });
    fireEvent.blur(folder);
    // Saved as it will be used: made safe for a folder name.
    await waitFor(async () => expect((await getProject(p.id))!.downloadFolder).toBe('Bills part 1'));
    expect((folder as HTMLInputElement).value).toBe('Bills part 1');
    fireEvent.click(screen.getByRole('button', { name: 'Download all 3 pictures' }));
    await waitFor(() => expect(chrome.downloads.download).toHaveBeenCalledTimes(3));
    expect(chrome.downloads.download.mock.calls[0]![0].filename).toBe('Bills part 1/Slide_01.png');
  });

  it('exports the slide list and the timing file', async () => {
    const { chrome } = await openFiles(2);
    fireEvent.click(screen.getByRole('button', { name: 'Slide list (CSV)' }));
    expect(await screen.findByText('Saved Phone Bill Story slides.csv to Downloads/Phone Bill Story.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Timing file' }));
    expect(await screen.findByText('Saved Phone Bill Story timing.json to Downloads/Phone Bill Story.')).toBeTruthy();
    expect(chrome.downloads.download.mock.calls.map(([o]) => o.filename)).toEqual([
      'Phone Bill Story/Phone Bill Story slides.csv',
      'Phone Bill Story/Phone Bill Story timing.json',
    ]);
  });

  it('with no pictures yet, Download all is not offered', async () => {
    stubChrome();
    await seed('Empty', 4);
    render(<Panel client={fakeBackground(null).client()} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));
    expect(await screen.findByText('0 scenes · 0 pictures saved in VidFlow')).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Download all pictures' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
