import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openForTab } from '../../src/background/action';

const STUDIO = 'chrome-extension://vidflow/studio.html';
let sidePanelOpen: ReturnType<typeof vi.fn>;
let storageGet: ReturnType<typeof vi.fn>;
let tabs: { query: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let windowsUpdate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sidePanelOpen = vi.fn(async () => undefined);
  // Storage never answers: anything awaited before the panel opens would hold it back.
  storageGet = vi.fn(() => new Promise(() => undefined));
  tabs = { query: vi.fn(async () => []), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
  windowsUpdate = vi.fn(async () => ({}));
  vi.stubGlobal('chrome', {
    runtime: { getURL: (p: string) => `chrome-extension://vidflow${p}` },
    sidePanel: { open: sidePanelOpen },
    storage: { local: { get: storageGet } },
    tabs,
    windows: { update: windowsUpdate },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('toolbar button', () => {
  it('opens the side panel on a Flow tab', async () => {
    const result = openForTab({ id: 3, windowId: 7, url: 'https://labs.google/fx/tools/flow/project/abc' });
    // Synchronously, inside the click's user gesture: Chrome refuses sidePanel.open() after an await.
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 });
    expect(storageGet).not.toHaveBeenCalled();
    expect(await result).toBe('panel');
    expect(tabs.create).not.toHaveBeenCalled();

    sidePanelOpen.mockClear();
    const flowHost = openForTab({ id: 4, windowId: 9, url: 'https://flow.google.com/' });
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 9 });
    expect(await flowHost).toBe('panel');
  });

  it("opens the studio tab when the active tab isn't Flow", async () => {
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://example.com/' })).toBe('studio');
    expect(sidePanelOpen).not.toHaveBeenCalled();
    expect(tabs.create).toHaveBeenCalledWith({ url: STUDIO });

    // A studio tab is already open: it is focused, not opened twice.
    tabs.create.mockClear();
    tabs.query.mockResolvedValue([{ id: 11, windowId: 2, url: STUDIO }]);
    expect(await openForTab({ id: 3, windowId: 7, url: 'chrome://newtab/' })).toBe('studio');
    expect(tabs.create).not.toHaveBeenCalled();
    expect(tabs.update).toHaveBeenCalledWith(11, { active: true });
    expect(windowsUpdate).toHaveBeenCalledWith(2, { focused: true });
  });

  it("opens the studio when Chrome won't open the side panel", async () => {
    sidePanelOpen.mockRejectedValue(new Error('No active side panel'));
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://flow.google.com/project/1' })).toBe('studio');
    expect(tabs.create).toHaveBeenCalledWith({ url: STUDIO });
  });
});
