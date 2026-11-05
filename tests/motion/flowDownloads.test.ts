import { describe, expect, it, vi } from 'vitest';
import { createFlowDownloadGuard, FLOW_DOWNLOAD_WINDOW_MS } from '../../src/motion/flowDownloads';

/** A fake chrome.downloads: items by id, with the calls the guard may make. */
function fakeDownloads(states: Record<number, 'in_progress' | 'complete' | 'interrupted'> = {}) {
  return {
    cancel: vi.fn(async (_id: number) => undefined),
    search: vi.fn(async ({ id }: { id: number }) => (id in states ? [{ id, state: states[id]! }] : [])),
    removeFile: vi.fn(async (_id: number) => undefined),
    erase: vi.fn(async ({ id }: { id: number }) => [id]),
  };
}

type Item = Parameters<ReturnType<typeof createFlowDownloadGuard>['onCreated']>[0];
const item = (over: Partial<Item> = {}): Item => ({
  id: 41,
  url: 'https://flow-content.google/video/1fc37838?Expires=1&Signature=x',
  finalUrl: 'https://flow-content.google/video/1fc37838?Expires=1&Signature=x',
  referrer: 'https://flow.google.com/u/0/project/p1/edit/e1',
  filename: '',
  mime: 'video/mp4',
  state: 'in_progress',
  ...over,
});

describe("Flow's own clip download (after VidFlow pressed 720p Original size)", () => {
  it('cancels and erases a Flow .mp4 download that starts within the window', async () => {
    let now = 1_000;
    const api = fakeDownloads({ 41: 'interrupted' });
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => now);
    guard.expect();
    now += 4_000;
    expect(await guard.onCreated(item())).toBe(true);
    expect(api.cancel).toHaveBeenCalledWith(41);
    expect(api.removeFile).not.toHaveBeenCalled();
    expect(api.erase).toHaveBeenCalledWith({ id: 41 });
  });

  it('removes the file too when the download had already finished', async () => {
    const api = fakeDownloads({ 42: 'complete' });
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => 0);
    guard.expect();
    expect(await guard.onCreated(item({ id: 42, state: 'complete', filename: '/Users/x/Downloads/Stickman waving_1fc37838.mp4', mime: '' }))).toBe(true);
    expect(api.removeFile).toHaveBeenCalledWith(42);
    expect(api.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('recognises a blob: download made by the Flow page', async () => {
    const api = fakeDownloads({ 43: 'interrupted' });
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => 0);
    guard.expect();
    expect(await guard.onCreated(item({ id: 43, url: 'blob:https://flow.google.com/9b1c', finalUrl: 'blob:https://flow.google.com/9b1c', filename: 'Stickman.mp4', mime: '' }))).toBe(true);
    expect(api.cancel).toHaveBeenCalledWith(43);
  });

  it('never touches other downloads', async () => {
    let now = 0;
    const api = fakeDownloads({ 50: 'in_progress' });
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => now);
    // Nothing expected: VidFlow didn't press Download.
    expect(await guard.onCreated(item())).toBe(false);
    guard.expect();
    // Another site's video, a Flow picture, VidFlow's own download, and a non-video file from Flow.
    expect(await guard.onCreated(item({ url: 'https://example.com/a.mp4', finalUrl: 'https://example.com/a.mp4', referrer: 'https://example.com/' }))).toBe(false);
    expect(await guard.onCreated(item({ url: 'https://flow-content.google/image/abc', finalUrl: 'https://flow-content.google/image/abc', mime: 'image/png', filename: 'a.png' }))).toBe(false);
    expect(await guard.onCreated(item({ byExtensionId: 'vidflow-ext' }))).toBe(false);
    // Too late: the window after the press is over.
    now += FLOW_DOWNLOAD_WINDOW_MS + 1;
    expect(await guard.onCreated(item())).toBe(false);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(api.removeFile).not.toHaveBeenCalled();
    expect(api.erase).not.toHaveBeenCalled();
  });

  it('cancels each Flow clip download in the window (a retried press can start two)', async () => {
    const api = fakeDownloads({ 41: 'interrupted', 44: 'interrupted' });
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => 0);
    guard.expect();
    expect(await guard.onCreated(item())).toBe(true);
    expect(await guard.onCreated(item({ id: 44 }))).toBe(true);
    expect(api.cancel.mock.calls).toEqual([[41], [44]]);
  });

  it('never throws when chrome refuses a step', async () => {
    const api = fakeDownloads({ 41: 'complete' });
    api.cancel.mockRejectedValue(new Error('Download must be in progress'));
    api.removeFile.mockRejectedValue(new Error('gone'));
    const guard = createFlowDownloadGuard(api, 'vidflow-ext', () => 0);
    guard.expect();
    expect(await guard.onCreated(item())).toBe(true);
    expect(api.erase).toHaveBeenCalledWith({ id: 41 });
  });
});
