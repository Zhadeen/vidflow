import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The coordinator is replaced: these tests are only about who may send studio requests to the background.
vi.mock('../../src/runs/coordinator', () => ({
  RunBlockedError: class extends Error {},
  chooseScenePicture: vi.fn(async () => undefined),
  discardFinishedRun: vi.fn(async () => undefined),
  getRunState: vi.fn(() => null),
  handleFlowEvent: vi.fn(async () => undefined),
  onRunState: vi.fn(),
  handleTiles: vi.fn(async () => undefined),
  isFlowTab: vi.fn(async () => false),
  pauseRun: vi.fn(async () => undefined),
  pillFor: vi.fn(async () => null),
  registerCoordinator: vi.fn(),
  resumeRun: vi.fn(async () => undefined),
  retryScene: vi.fn(async () => undefined),
  setFlowPort: vi.fn(),
  startRun: vi.fn(async () => undefined),
  stopRun: vi.fn(async () => undefined),
}));
vi.mock('../../src/flow/port', () => ({ createFlowPort: vi.fn(() => ({})) }));

type OnMessage = (message: unknown, sender: { id?: string; url?: string; tab?: { id?: number } }, sendResponse: (r: unknown) => void) => unknown;
let onMessage: OnMessage;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('defineBackground', (main: () => void) => main);
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'vidflow',
      getURL: (p: string) => `chrome-extension://vidflow${p}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: (l: OnMessage) => (onMessage = l) },
    },
    action: { onClicked: { addListener: vi.fn() } },
  });
  const main = (await import('../../src/entrypoints/background')).default as unknown as () => void;
  main();
});
afterEach(() => vi.unstubAllGlobals());

const choose = { type: 'run/choose', projectId: 'p1', sceneId: 's1', pictureId: 'p1/b' };

describe('run/choose', () => {
  it('is refused from a sender that is not one of VidFlow\'s own pages', async () => {
    const { chooseScenePicture } = await import('../../src/runs/coordinator');
    const senders = [
      { id: 'vidflow', url: 'https://flow.google.com/project/1', tab: { id: 4 } }, // VidFlow's content script in Flow
      { id: 'other-extension', url: 'chrome-extension://other-extension/studio.html' },
      { id: 'vidflow', url: 'chrome-extension://vidflow/flow-helper.html' },
      { id: 'vidflow' },
    ];
    for (const sender of senders) {
      const sendResponse = vi.fn();
      expect(onMessage(choose, sender, sendResponse)).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(chooseScenePicture).not.toHaveBeenCalled();
  });

  it('is carried out for the studio page', async () => {
    const { chooseScenePicture } = await import('../../src/runs/coordinator');
    const sendResponse = vi.fn();
    expect(onMessage(choose, { id: 'vidflow', url: 'chrome-extension://vidflow/studio.html' }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, state: null }));
    expect(chooseScenePicture).toHaveBeenCalledWith('p1', 's1', 'p1/b');
  });
});
