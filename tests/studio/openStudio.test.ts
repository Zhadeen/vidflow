import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openStudio } from '../../src/studio/openStudio';

const STUDIO = 'chrome-extension://vidflow/studio.html';
const FLOW_WINDOW = 3;
const FLOW_TAB = 7;

interface FakeTab {
  id: number;
  windowId: number;
  url: string;
  active: boolean;
}

/**
 * A small Chrome: windows with tabs, one active tab per window. VidFlow's Flow window (3) holds its Flow tab (7) and
 * the side panel the owner clicks from.
 */
function fakeChrome(opts: { tabs?: FakeTab[]; otherWindows?: number[]; flowWindowSaved?: boolean } = {}) {
  const tabs: FakeTab[] = [
    { id: FLOW_TAB, windowId: FLOW_WINDOW, url: 'https://flow.google.com/project/1', active: true },
    ...(opts.tabs ?? []),
  ];
  const windowIds = new Set<number>([FLOW_WINDOW, ...(opts.otherWindows ?? [])]);
  let nextId = 100;
  const activate = (tab: FakeTab) => {
    for (const t of tabs) if (t.windowId === tab.windowId) t.active = t === tab;
  };
  const storage: Record<string, unknown> =
    opts.flowWindowSaved === false ? {} : { 'vidflow.flowWindow': { windowId: FLOW_WINDOW, tabId: FLOW_TAB } };
  const api = {
    runtime: { id: 'vidflow', getURL: (p: string) => `chrome-extension://vidflow${p}` },
    storage: { local: { get: vi.fn(async (key: string) => (key in storage ? { [key]: storage[key] } : {})) } },
    tabs: {
      query: vi.fn(async (q: { url?: string }) => tabs.filter((t) => !q.url || t.url.split('#')[0] === q.url).map((t) => ({ ...t }))),
      create: vi.fn(async (p: { url: string; windowId?: number; active?: boolean }) => {
        // Chrome's default is the current window: the one the side panel is in (VidFlow's Flow window).
        const t: FakeTab = { id: nextId++, windowId: p.windowId ?? FLOW_WINDOW, url: p.url, active: false };
        tabs.push(t);
        if (p.active !== false) activate(t);
        return { ...t };
      }),
      update: vi.fn(async (id: number, p: { url?: string; active?: boolean }) => {
        const t = tabs.find((x) => x.id === id)!;
        if (p.url) t.url = p.url;
        if (p.active) activate(t);
        return { ...t };
      }),
      move: vi.fn(async (id: number, p: { windowId: number; index: number }) => {
        const t = tabs.find((x) => x.id === id)!;
        const wasActive = t.active;
        const from = t.windowId;
        t.windowId = p.windowId;
        t.active = false;
        if (wasActive) {
          const left = tabs.find((x) => x.windowId === from);
          if (left) left.active = true;
        }
        return { ...t };
      }),
    },
    windows: {
      update: vi.fn(async () => ({})),
      getAll: vi.fn(async () => [...windowIds].map((id) => ({ id, type: 'normal' }))),
      create: vi.fn(async (p: { url?: string; tabId?: number; focused?: boolean }) => {
        const id = nextId++;
        windowIds.add(id);
        if (p.tabId !== undefined) await api.tabs.move(p.tabId, { windowId: id, index: -1 });
        else tabs.push({ id: nextId++, windowId: id, url: p.url!, active: true });
        return { id };
      }),
    },
  };
  vi.stubGlobal('chrome', api);
  const activeIn = (windowId: number) => tabs.find((t) => t.windowId === windowId && t.active)?.id;
  return { api, tabs, activeIn };
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("openStudio never hides VidFlow's Flow tab", () => {
  it('with no studio tab, opens one in another normal window and focuses it', async () => {
    const { api, tabs, activeIn } = fakeChrome({ otherWindows: [9] });
    await openStudio('p1');
    expect(activeIn(FLOW_WINDOW)).toBe(FLOW_TAB);
    const studio = tabs.find((t) => t.url === `${STUDIO}#/project/p1`)!;
    expect(studio.windowId).toBe(9);
    expect(api.windows.update).toHaveBeenCalledWith(9, { focused: true });
  });

  it('with no studio tab and no other normal window, opens a new window', async () => {
    const { api, activeIn } = fakeChrome();
    await openStudio('p1');
    expect(activeIn(FLOW_WINDOW)).toBe(FLOW_TAB);
    expect(api.windows.create).toHaveBeenCalledWith({ url: `${STUDIO}#/project/p1`, focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('an existing studio tab in another window is updated and its window focused', async () => {
    const { api, activeIn } = fakeChrome({ otherWindows: [9], tabs: [{ id: 5, windowId: 9, url: STUDIO, active: false }] });
    await openStudio('p1');
    expect(api.tabs.update).toHaveBeenCalledWith(5, { active: true, url: `${STUDIO}#/project/p1` });
    expect(api.windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(activeIn(FLOW_WINDOW)).toBe(FLOW_TAB);
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it("a studio tab inside VidFlow's Flow window is moved out, not shown there", async () => {
    const { api, tabs, activeIn } = fakeChrome({
      otherWindows: [9],
      tabs: [{ id: 5, windowId: FLOW_WINDOW, url: STUDIO, active: false }],
    });
    await openStudio('p1');
    expect(activeIn(FLOW_WINDOW)).toBe(FLOW_TAB);
    expect(tabs.find((t) => t.id === 5)!.windowId).toBe(9);
    expect(activeIn(9)).toBe(5);
    expect(api.windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(api.windows.update).not.toHaveBeenCalledWith(FLOW_WINDOW, expect.anything());
  });

  it("a studio tab inside VidFlow's Flow window with no other window gets a window of its own", async () => {
    const { tabs, activeIn } = fakeChrome({ tabs: [{ id: 5, windowId: FLOW_WINDOW, url: STUDIO, active: false }] });
    await openStudio('p1');
    expect(activeIn(FLOW_WINDOW)).toBe(FLOW_TAB);
    const studio = tabs.find((t) => t.id === 5)!;
    expect(studio.windowId).not.toBe(FLOW_WINDOW);
    expect(studio.url).toBe(`${STUDIO}#/project/p1`);
  });

  it('with no Flow window saved, behaves as before (current window)', async () => {
    const { api } = fakeChrome({ flowWindowSaved: false });
    await openStudio();
    expect(api.tabs.create).toHaveBeenCalledWith({ url: STUDIO });
  });
});
