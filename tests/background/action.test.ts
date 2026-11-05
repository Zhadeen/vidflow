import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isOwnPage, openForTab, registerToolbar } from '../../src/background/action';

const STUDIO = 'chrome-extension://vidflow/studio.html';
let sidePanelOpen: ReturnType<typeof vi.fn>;
let storageGet: ReturnType<typeof vi.fn>;
let tabs: { query: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
let windowsUpdate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sidePanelOpen = vi.fn(async () => undefined);
  // No Flow window saved yet (the studio opener reads it). The panel test makes storage never answer.
  storageGet = vi.fn(async () => ({}));
  tabs = { query: vi.fn(async () => []), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})) };
  windowsUpdate = vi.fn(async () => ({}));
  vi.stubGlobal('chrome', {
    runtime: { id: 'vidflow', getURL: (p: string) => `chrome-extension://vidflow${p}` },
    action: { onClicked: { addListener: vi.fn() } },
    sidePanel: { open: sidePanelOpen },
    storage: { local: { get: storageGet } },
    tabs,
    windows: { update: windowsUpdate },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('toolbar button', () => {
  it('opens the side panel on a Flow tab', async () => {
    // Storage never answers: anything awaited before the panel opens would hold it back.
    storageGet.mockImplementation(() => new Promise(() => undefined));
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

  it('opens the studio on other labs.google pages, such as Whisk', async () => {
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://labs.google/fx/tools/whisk' })).toBe('studio');
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://labs.google/fx/tools/whisk/project/abc' })).toBe('studio');
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://labs.google/' })).toBe('studio');
    expect(sidePanelOpen).not.toHaveBeenCalled();
    // Flow on labs.google, with or without a locale, still opens the panel.
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://labs.google/fx/en/tools/flow' })).toBe('panel');
    expect(await openForTab({ id: 3, windowId: 7, url: 'https://labs.google/fx/tools/flow/project/abc?x=1' })).toBe('panel');
  });

  it('registers the click listener, which opens the panel on Flow', async () => {
    registerToolbar();
    const addListener = (chrome.action.onClicked.addListener as unknown as ReturnType<typeof vi.fn>);
    expect(addListener).toHaveBeenCalledTimes(1);
    const listener = addListener.mock.calls[0]![0] as (tab: chrome.tabs.Tab) => void;
    listener({ id: 3, windowId: 7, url: 'https://flow.google.com/project/1' } as chrome.tabs.Tab);
    expect(sidePanelOpen).toHaveBeenCalledWith({ windowId: 7 });
    listener({ id: 4, windowId: 7, url: 'https://example.com/' } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(tabs.create).toHaveBeenCalledWith({ url: STUDIO }));
  });
});

describe('isOwnPage', () => {
  it("accepts VidFlow's studio and side panel", () => {
    expect(isOwnPage({ id: 'vidflow', url: 'chrome-extension://vidflow/studio.html#/project/p1' })).toBe(true);
    expect(isOwnPage({ id: 'vidflow', url: 'chrome-extension://vidflow/sidepanel.html' })).toBe(true);
  });

  it('rejects other extensions, Flow tabs and senders without a url', () => {
    expect(isOwnPage({ id: 'someone-else', url: 'chrome-extension://vidflow/studio.html' })).toBe(false);
    expect(isOwnPage({ id: 'vidflow', url: 'https://flow.google.com/project/1' })).toBe(false);
    expect(isOwnPage({ id: 'vidflow', url: 'https://labs.google/fx/tools/flow' })).toBe(false);
    expect(isOwnPage({ id: 'vidflow' })).toBe(false);
    expect(isOwnPage({ id: 'vidflow', url: 'chrome-extension://vidflow/studio.html.evil' })).toBe(false);
  });
});
