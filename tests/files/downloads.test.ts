import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoSaveScene, downloadAll, downloadExport } from '../../src/files/downloads';
import { fakeDownloads } from './fakeDownloads';
import { ACTIVITY_KEY } from '../../src/runs/activity';
import { AUTO_SAVE_KEY, NAMING_FORMAT_KEY } from '../../src/settings';
import { memoryMediaStore } from '../../src/store/media';
import { createProject, deleteProject, getProject, listProjects, saveProject, setMediaStore, type Project } from '../../src/store/projects';
import type { Scene } from '../../src/scenes/types';

const scene = (i: number, over: Partial<Scene> = {}): Scene => ({
  id: `scene-0${i}`,
  slide: i,
  start: (i - 1) * 3,
  end: i * 3,
  sentence: `Line ${i}.`,
  concept: '',
  textOverlay: '',
  imagePrompt: '',
  motionPrompt: '',
  motionPromptIsDefault: true,
  ...over,
});

/** chrome.storage.local and a fake chrome.downloads that records every download. */
function stub(data: Record<string, unknown> = {}) {
  const fake = fakeDownloads();
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => (key in data ? { [key]: structuredClone(data[key]) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(data, structuredClone(items))),
        remove: vi.fn(async (key: string) => void delete data[key]),
      },
    },
    downloads: fake.api,
  });
  return { data, download: fake.download, fake };
}

const media = memoryMediaStore();

/** "Phone Bill Story": scene 1 has two PNGs (the second chosen), scene 2 one JPEG, scene 3 nothing yet. */
async function seedVideo(edit: (p: Project) => void = () => undefined): Promise<Project> {
  const p = await createProject('Phone Bill Story');
  p.scenes = [scene(1), scene(2), scene(3)];
  const a = await media.put(p.id, 'scene-01-option-1', new Blob(['a'], { type: 'image/png' }));
  const b = await media.put(p.id, 'scene-01-option-2', new Blob(['b'], { type: 'image/png' }));
  const c = await media.put(p.id, 'scene-02-option-1', new Blob(['c'], { type: 'image/jpeg' }));
  p.sceneStates = {
    'scene-01': { sceneId: 'scene-01', status: 'done', pictureIds: [a, b], chosenPictureId: b },
    'scene-02': { sceneId: 'scene-02', status: 'done', pictureIds: [c] },
    'scene-03': { sceneId: 'scene-03', status: 'pending', pictureIds: [] },
  };
  edit(p);
  await saveProject(p);
  return p;
}

const filenames = (download: ReturnType<typeof stub>['download']) => download.mock.calls.map(([o]) => o.filename);
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 2));
};

beforeEach(async () => {
  setMediaStore(media);
  for (const p of await listProjects()) await deleteProject(p.id);
});
afterEach(() => vi.unstubAllGlobals());

describe('Download all', () => {
  it('saves the chosen pictures into Downloads/<video name>, named by slide and timecode', async () => {
    const { download } = stub();
    const p = await seedVideo();
    expect(await downloadAll(p.id, { both: false })).toEqual({ saved: 2, skipped: 0, failed: 0 });
    expect(filenames(download)).toEqual(['Phone Bill Story/Slide_01_00m00s-00m03s.png', 'Phone Bill Story/Slide_02_00m03s-00m06s.jpg']);
  });

  it('uniquifies, never overwrites', async () => {
    const { download } = stub();
    const p = await seedVideo();
    await downloadAll(p.id, { both: false });
    for (const [o] of download.mock.calls) {
      expect(o.conflictAction).toBe('uniquify');
      expect(o.saveAs).toBe(false);
      expect(o.url).toMatch(/^(blob:|data:image\/)/);
    }
  });

  it('chosen only vs both options', async () => {
    const { download } = stub();
    const p = await seedVideo();
    expect(await downloadAll(p.id, { both: true })).toEqual({ saved: 3, skipped: 0, failed: 0 });
    // The chosen one keeps the plain name; the other gets _option2.
    expect(filenames(download)).toEqual([
      'Phone Bill Story/Slide_01_00m00s-00m03s.png',
      'Phone Bill Story/Slide_01_00m00s-00m03s_option2.png',
      'Phone Bill Story/Slide_02_00m03s-00m06s.jpg',
    ]);
  });

  it('skips files already downloaded for this video (and "again" downloads them again)', async () => {
    const { download } = stub();
    const p = await seedVideo();
    await downloadAll(p.id, { both: false });
    expect((await getProject(p.id))!.downloaded).toEqual({
      [`${p.id}/scene-01-option-2`]: 'Slide_01_00m00s-00m03s.png',
      [`${p.id}/scene-02-option-1`]: 'Slide_02_00m03s-00m06s.jpg',
    });
    download.mockClear();

    expect(await downloadAll(p.id, { both: true })).toEqual({ saved: 1, skipped: 2, failed: 0 });
    expect(filenames(download)).toEqual(['Phone Bill Story/Slide_01_00m00s-00m03s_option2.png']);
    download.mockClear();

    expect(await downloadAll(p.id, { both: true, again: true })).toEqual({ saved: 3, skipped: 0, failed: 0 });
    expect(download).toHaveBeenCalledTimes(3);
  });

  it('uses the video’s own folder and the chosen naming format', async () => {
    const { download } = stub({ [NAMING_FORMAT_KEY]: 'time-slide' });
    const p = await seedVideo((v) => (v.downloadFolder = 'Bills: part 1'));
    await downloadAll(p.id, { both: false });
    expect(filenames(download)).toEqual(['Bills part 1/00m00s-00m03s_Slide_01.png', 'Bills part 1/00m03s-00m06s_Slide_02.jpg']);
  });

  it('a failed download is counted and not marked as downloaded', async () => {
    const { download } = stub();
    download.mockRejectedValueOnce(new Error('Invalid filename'));
    const p = await seedVideo();
    expect(await downloadAll(p.id, { both: false })).toEqual({ saved: 1, skipped: 0, failed: 1 });
    expect(Object.keys((await getProject(p.id))!.downloaded ?? {})).toEqual([`${p.id}/scene-02-option-1`]);
  });
});

describe('Download all: what Chrome really saved', () => {
  it('records the real file name Chrome chose (uniquify), from the finished download', async () => {
    const { fake } = stub();
    fake.rename('Phone Bill Story/Slide_01_00m00s-00m03s.png', 'Phone Bill Story/Slide_01_00m00s-00m03s (1).png');
    const p = await seedVideo();
    await downloadAll(p.id, { both: false });
    expect((await getProject(p.id))!.downloaded).toEqual({
      [`${p.id}/scene-01-option-2`]: 'Slide_01_00m00s-00m03s (1).png',
      [`${p.id}/scene-02-option-1`]: 'Slide_02_00m03s-00m06s.jpg',
    });
  });

  it('waits for onChanged "complete" when the download is still running, and an interrupted one is not marked', async () => {
    const { fake } = stub();
    fake.hold();
    const p = await seedVideo();
    const result = downloadAll(p.id, { both: false });
    await until(() => fake.download.mock.calls.length === 2 && fake.listeners.size === 2);
    expect((await getProject(p.id))!.downloaded).toBeUndefined();
    fake.finish(1);
    fake.interrupt(2);
    expect(await result).toEqual({ saved: 1, skipped: 0, failed: 1 });
    expect((await getProject(p.id))!.downloaded).toEqual({ [`${p.id}/scene-01-option-2`]: 'Slide_01_00m00s-00m03s.png' });
    expect(fake.listeners.size).toBe(0);
  });

  it('revokes each object URL when its download completes', async () => {
    const { fake } = stub();
    fake.hold();
    let n = 0;
    const create = vi.fn(() => `blob:vidflow/${++n}`);
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }));
    const p = await seedVideo();
    const result = downloadAll(p.id, { both: false });
    await until(() => fake.listeners.size === 2);
    expect(fake.download.mock.calls.map(([o]) => o.url)).toEqual(['blob:vidflow/1', 'blob:vidflow/2']);
    expect(revoke).not.toHaveBeenCalled();
    fake.finish(1);
    fake.finish(2);
    await result;
    expect(revoke.mock.calls.map(([u]) => u)).toEqual(['blob:vidflow/1', 'blob:vidflow/2']);
  });

  it('reports progress: "Saving 1 of 2", "Saving 2 of 2"', async () => {
    stub();
    const p = await seedVideo();
    const progress: [number, number][] = [];
    await downloadAll(p.id, { both: false, onProgress: (done, total) => progress.push([done, total]) });
    expect(progress).toEqual([[1, 2], [2, 2]]);
  });
});

describe('auto-save', () => {
  it('does nothing while the switch is off', async () => {
    const { download } = stub();
    const p = await seedVideo();
    await autoSaveScene(p.id, 'scene-01');
    expect(download).not.toHaveBeenCalled();
  });

  it('saves that scene’s chosen picture (or both) once, and marks it downloaded', async () => {
    const { download, data } = stub({ [AUTO_SAVE_KEY]: true });
    const p = await seedVideo();
    await autoSaveScene(p.id, 'scene-01');
    expect(filenames(download)).toEqual(['Phone Bill Story/Slide_01_00m00s-00m03s.png']);
    await autoSaveScene(p.id, 'scene-01');
    expect(download).toHaveBeenCalledTimes(1);

    data['vidflow.downloadBoth'] = true;
    await autoSaveScene(p.id, 'scene-01');
    expect(filenames(download)).toEqual(['Phone Bill Story/Slide_01_00m00s-00m03s.png', 'Phone Bill Story/Slide_01_00m00s-00m03s_option2.png']);
    expect(Object.keys((await getProject(p.id))!.downloaded ?? {})).toHaveLength(2);
  });

  it('uses the signed Flow address it was saved from (any size), not a data: URL', async () => {
    const { download } = stub({ [AUTO_SAVE_KEY]: true });
    const p = await seedVideo();
    await autoSaveScene(p.id, 'scene-01', { urls: { [`${p.id}/scene-01-option-2`]: 'https://flow-content.google/image/k2?sig=abc' } });
    expect(download.mock.calls.map(([o]) => o)).toEqual([
      { url: 'https://flow-content.google/image/k2?sig=abc', filename: 'Phone Bill Story/Slide_01_00m00s-00m03s.png', conflictAction: 'uniquify', saveAs: false },
    ]);
  });

  it('without an address: a small picture goes as a data: URL; a big one is not tried and the problem is logged', async () => {
    const { download, data } = stub({ [AUTO_SAVE_KEY]: true });
    const p = await seedVideo();
    await autoSaveScene(p.id, 'scene-02');
    expect(download.mock.calls[0]![0].url).toMatch(/^data:image\/jpeg;base64,/);

    const big = await media.put(p.id, 'scene-03-option-1', new Blob([new Uint8Array(1_500_000)], { type: 'image/png' }));
    const stored = (await getProject(p.id))!;
    stored.sceneStates['scene-03'] = { sceneId: 'scene-03', status: 'done', pictureIds: [big] };
    await saveProject(stored);
    await autoSaveScene(p.id, 'scene-03');
    expect(download).toHaveBeenCalledTimes(1);
    expect((data[ACTIVITY_KEY] as { text: string }[]).map((e) => e.text)).toEqual(["Couldn't save scene 3 to your Mac"]);
  });

  it('never throws on a download error: it logs "Couldn’t save scene N to your Mac"', async () => {
    const { download, data } = stub({ [AUTO_SAVE_KEY]: true });
    download.mockRejectedValue(new Error('disk full'));
    const p = await seedVideo();
    await expect(autoSaveScene(p.id, 'scene-02')).resolves.toBeUndefined();
    const log = data[ACTIVITY_KEY] as { projectId: string; text: string }[];
    expect(log.map((e) => e.text)).toEqual(["Couldn't save scene 2 to your Mac"]);
    expect(log[0]!.projectId).toBe(p.id);
  });
});

describe('exports', () => {
  it('the File column names only pictures that were downloaded, as Chrome saved them', async () => {
    const { download } = stub();
    const p = await seedVideo((v) => (v.downloaded = { [`${v.id}/scene-01-option-2`]: 'Slide_01 (1).png' }));
    await downloadExport(p.id, 'csv');
    const url = download.mock.calls[0]![0].url;
    const body = url.slice(url.indexOf(',') + 1);
    const csv = url.includes(';base64,') ? new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))) : decodeURIComponent(body);
    expect(csv.split('\r\n').slice(1)).toEqual(['1,00:00 - 00:03,Line 1.,Saved,Slide_01 (1).png', '2,00:03 - 00:06,Line 2.,Saved,', '3,00:06 - 00:09,Line 3.,To go,']);
  });

  it('downloads "<video name> slides.csv" and "<video name> timing.json" into the video’s folder', async () => {
    const { download } = stub();
    const p = await seedVideo();
    await downloadExport(p.id, 'csv');
    await downloadExport(p.id, 'json');
    expect(filenames(download)).toEqual(['Phone Bill Story/Phone Bill Story slides.csv', 'Phone Bill Story/Phone Bill Story timing.json']);
    for (const [o] of download.mock.calls) expect(o.conflictAction).toBe('uniquify');
    const url = download.mock.calls[0]![0].url;
    const body = url.slice(url.indexOf(',') + 1);
    const csv = url.includes(';base64,') ? new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0))) : decodeURIComponent(body);
    expect(csv.startsWith('Slide,Timecode,Sentence,Status,File\r\n1,00:00 - 00:03,Line 1.,Saved,\r\n')).toBe(true);
  });
});
